import 'server-only';
import { createHash, randomBytes } from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  readDiscovery, checkClaims, type OidcConfig, type Discovery, type Identity,
} from './oidc';

/**
 * The half of OpenID Connect that talks to the provider.
 *
 * Signature verification is `jose`'s, against the provider's published keys.
 * Everything that remains -- what the token says, and whether it was meant
 * for this sign-in -- is in lib/oidc.ts, where it can be tested without a
 * network.
 */

/** Configured by environment, because an identity provider is deployment, not data. */
export function configured(): OidcConfig | null {
  const issuer = (process.env.OIDC_ISSUER ?? '').trim();
  const clientId = (process.env.OIDC_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.OIDC_CLIENT_SECRET ?? '').trim();
  const redirectUri = (process.env.OIDC_REDIRECT_URI ?? '').trim();
  if (!issuer || !clientId || !redirectUri) return null;

  return {
    issuer,
    // Filled by discovery; these are placeholders until then.
    authorizationEndpoint: '', tokenEndpoint: '', jwksUri: '',
    clientId,
    clientSecret: clientSecret || undefined,
    redirectUri,
    scopes: (process.env.OIDC_SCOPES ?? '').split(/[\s,]+/).filter(Boolean),
  };
}

export const ssoEnabled = () => configured() !== null;

/** Whether an account may be made for somebody the lab has never seen. */
export const ssoMayCreateAccounts = () => process.env.OIDC_CREATE_ACCOUNTS === '1';

export const ssoLabel = () => (process.env.OIDC_LABEL ?? '').trim() || 'your institution';

/*
 * Discovery is cached for an hour. It changes rarely, and fetching it on
 * every sign-in makes the provider's availability a dependency of every
 * login rather than of the first one each hour.
 */
let cached: { at: number; discovery: Discovery } | null = null;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

export async function discover(config: OidcConfig): Promise<Discovery | { error: string }> {
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.discovery;

  const url = `${config.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return { error: `The provider answered ${res.status} when asked how to talk to it.` };
    const discovery = readDiscovery(await res.json(), config.issuer);
    if ('error' in discovery) return discovery;
    cached = { at: Date.now(), discovery };
    return discovery;
  } catch (e) {
    return { error: `Could not reach the identity provider: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    clearTimeout(timer);
  }
}

/** state, nonce and a PKCE verifier, each from the system's own randomness. */
export function newSecrets() {
  const state = randomBytes(24).toString('base64url');
  const nonce = randomBytes(24).toString('base64url');
  const codeVerifier = randomBytes(48).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { state, nonce, codeVerifier, codeChallenge };
}

export interface Exchanged {
  identity: Identity;
}

/**
 * Trade the code for tokens, and check the one that matters.
 *
 * Only the id token is used. An access token from this exchange would let the
 * application act as the person at the provider, which it has no business
 * doing: all it needs is to be told, reliably, who they are.
 */
export async function exchange(
  config: OidcConfig,
  discovery: Discovery,
  args: { code: string; codeVerifier: string; nonce: string },
): Promise<Exchanged | { error: string }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: args.codeVerifier,
  });

  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  /*
   * A confidential client authenticates with Basic, which keeps the secret
   * out of the request body and so out of any proxy log that records bodies.
   * A public client has no secret and relies on PKCE, which is why PKCE is
   * not optional here.
   */
  if (config.clientSecret) {
    headers.Authorization = 'Basic '
      + Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString('base64');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let payload: { id_token?: unknown; error?: unknown; error_description?: unknown };
  try {
    const res = await fetch(discovery.token_endpoint, { method: 'POST', headers, body, signal: controller.signal });
    payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = typeof payload.error_description === 'string' ? payload.error_description
        : typeof payload.error === 'string' ? payload.error : `status ${res.status}`;
      return { error: `The provider refused the sign-in: ${detail}` };
    }
  } catch (e) {
    return { error: `Could not reach the identity provider: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    clearTimeout(timer);
  }

  if (typeof payload.id_token !== 'string') return { error: 'The provider returned no id token.' };

  let claims;
  try {
    const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
    /*
     * jose checks the signature, and issuer and audience as well. Those two
     * are checked again in checkClaims, which is not redundant: that function
     * is what the tests exercise, and a check that only ever runs inside a
     * library is a check nobody here can demonstrate.
     */
    const verified = await jwtVerify(payload.id_token, jwks, {
      issuer: discovery.issuer,
      audience: config.clientId,
    });
    claims = verified.payload;
  } catch (e) {
    return { error: `The provider's token did not verify: ${e instanceof Error ? e.message : String(e)}` };
  }

  const identity = checkClaims(claims, {
    issuer: discovery.issuer,
    clientId: config.clientId,
    nonce: args.nonce,
  });
  if ('error' in identity) return identity;
  return { identity };
}
