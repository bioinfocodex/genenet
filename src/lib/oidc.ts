/**
 * Signing in with the institution's own identity provider.
 *
 * A lab inside a university or a company does not want a second password.
 * More to the point, the institution does not want one either: when somebody
 * leaves, IT disables one account and expects every system to follow, and a
 * local password here is a door that stays open.
 *
 * OpenID Connect, authorization code flow with PKCE. The plumbing is routine.
 * The parts that are not are all about trusting what comes back, and they are
 * the reason this is a module with tests rather than forty lines in a route
 * handler.
 */

export interface OidcConfig {
  /** The issuer, as it appears in the discovery document and in tokens. */
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  clientId: string;
  clientSecret?: string;
  /** Where the provider sends the browser back to. */
  redirectUri: string;
  /** Extra scopes beyond openid, email and profile. */
  scopes?: string[];
}

/** What a discovery document has to contain before it is usable. */
export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export function readDiscovery(raw: unknown, expectedIssuer: string): Discovery | { error: string } {
  const d = raw as Partial<Discovery> | null;
  if (!d || typeof d !== 'object') return { error: 'The provider did not return a discovery document.' };

  for (const field of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    if (typeof d[field] !== 'string' || !d[field]) {
      return { error: `The discovery document has no ${field}.` };
    }
  }

  /*
   * The issuer in the document must be the one that was asked for. A
   * discovery document is fetched from a URL somebody configured, and if it
   * is allowed to name a different issuer then an attacker who can get their
   * URL configured can have tokens accepted that were issued elsewhere.
   */
  if (!sameIssuer(d.issuer!, expectedIssuer)) {
    return { error: `The provider calls itself ${d.issuer}, not ${expectedIssuer}.` };
  }

  for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    const problem = problemWithHttpsUrl(d[field]!);
    if (problem) return { error: `${field}: ${problem}` };
  }

  return d as Discovery;
}

/** Issuers compare exactly, except for a trailing slash nobody agrees about. */
export const sameIssuer = (a: string, b: string) =>
  a.replace(/\/$/, '') === b.replace(/\/$/, '');

/**
 * Endpoints must be https, and must not be inside this network.
 *
 * Same reasoning as the webhook guard: these are URLs a person configures and
 * this server then fetches. http is refused outright because the tokens and
 * the client secret travel over them.
 */
export function problemWithHttpsUrl(raw: string, opts: { allowHttp?: boolean } = {}): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'that is not a URL';
  }
  if (url.protocol !== 'https:' && !(opts.allowHttp && url.protocol === 'http:')) {
    return 'it has to be https — tokens and the client secret travel over it';
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1') {
    return 'that address is on this machine';
  }
  if (/^(127|10|0)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) {
    return 'that address is on this machine or this network';
  }
  const v4 = /^172\.(\d{1,3})\./.exec(host);
  if (v4 && Number(v4[1]) >= 16 && Number(v4[1]) <= 31) return 'that address is on this network';
  return null;
}

// ─── Starting a sign-in ──────────────────────────────────────────────────────

export interface Started {
  /** Where to send the browser. */
  url: string;
  /** Kept in a cookie and checked when the browser comes back. */
  state: string;
  nonce: string;
  codeVerifier: string;
}

/**
 * The URL that starts a sign-in, and the three secrets that go with it.
 *
 * Each of the three defends against something different, which is why all
 * three are here and none is optional:
 *
 *   state   — the browser comes back to a URL anybody can call. Without a
 *             state bound to this browser's own cookie, somebody can send a
 *             victim a callback URL carrying their own code and have the
 *             victim's session silently become the attacker's account.
 *   nonce   — goes into the id token and is checked on the way back, so a
 *             token captured from another sign-in cannot be replayed here.
 *   PKCE    — the code is useless to anybody who intercepts it without the
 *             verifier, which matters because the code travels through the
 *             browser's address bar and into its history.
 */
export function startUrl(
  config: OidcConfig,
  secrets: { state: string; nonce: string; codeChallenge: string },
): string {
  const scopes = ['openid', 'email', 'profile', ...(config.scopes ?? [])];
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: [...new Set(scopes)].join(' '),
    state: secrets.state,
    nonce: secrets.nonce,
    code_challenge: secrets.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${config.authorizationEndpoint}?${params}`;
}

// ─── What comes back ─────────────────────────────────────────────────────────

export interface Claims {
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  exp?: unknown;
  iat?: unknown;
  nonce?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  preferred_username?: unknown;
  [k: string]: unknown;
}

export interface Identity {
  /** The provider's own stable identifier for this person. */
  subject: string;
  email: string;
  name: string;
}

/**
 * Check an id token's claims, once its signature is already verified.
 *
 * Signature verification is somebody else's job -- `jose` does it, against the
 * provider's JWKS -- and a verified signature only says the token is genuine.
 * It says nothing about whether it was meant for this application, whether it
 * is still valid, or whether it belongs to the sign-in that is in progress.
 * Those are these checks.
 */
export function checkClaims(
  claims: Claims,
  expect: { issuer: string; clientId: string; nonce: string },
  now = Date.now(),
): Identity | { error: string } {
  if (typeof claims.iss !== 'string' || !sameIssuer(claims.iss, expect.issuer)) {
    return { error: 'The token was issued by somebody else.' };
  }

  /*
   * `aud` may be a string or a list. A token meant for another client of the
   * same provider is genuine, correctly signed, and not for us -- accepting
   * it would let any other application at that provider sign people in here.
   */
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.some(a => a === expect.clientId)) {
    return { error: 'The token was issued for a different application.' };
  }

  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) {
    return { error: 'The token has expired.' };
  }
  /*
   * A token issued in the future is a clock that disagrees, and a minute of
   * tolerance is the usual allowance. More than that and a token could be
   * minted ahead of time and held.
   */
  if (typeof claims.iat === 'number' && claims.iat * 1000 > now + 60_000) {
    return { error: "The token was issued in the future; check the provider's clock." };
  }

  if (claims.nonce !== expect.nonce) {
    return { error: 'This token belongs to a different sign-in.' };
  }

  if (typeof claims.sub !== 'string' || !claims.sub) {
    return { error: 'The token identifies nobody.' };
  }

  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  if (!email) return { error: 'The provider did not say who this is. Ask for the email scope.' };

  /*
   * This is the check that matters most, and the one most often skipped.
   *
   * An email address is how an account here is matched. A provider that lets
   * somebody set an unverified address -- and several do, including on free
   * tiers of well-known ones -- would let anybody type a colleague's address
   * and be signed into their account. An unverified address is not an
   * identity, so it is refused rather than trusted.
   */
  if (claims.email_verified !== true) {
    return {
      error: 'The provider has not verified that address, so it cannot be used to sign in. '
        + 'Verify it with the provider first.',
    };
  }

  const name = [claims.name, claims.preferred_username]
    .find(v => typeof v === 'string' && (v as string).trim()) as string | undefined;

  return { subject: claims.sub, email, name: (name ?? email.split('@')[0]).trim() };
}

// ─── Matching it to an account here ──────────────────────────────────────────

export interface LocalUser {
  id: string;
  email: string;
  status: string;
  /** The provider subject already linked to this account, if any. */
  ssoSubject: string | null;
}

export type LinkOutcome =
  | { action: 'sign-in'; userId: string }
  | { action: 'link'; userId: string }
  | { action: 'create' }
  | { action: 'refuse'; why: string };

/**
 * What to do with a verified identity.
 *
 * The subject is matched before the email, because the subject is the thing
 * the provider promises is stable. An institution that lets somebody change
 * their address should not strand their account, and one that reissues a
 * departed person's address to a new joiner must not hand them the old
 * account -- matching on the subject gets both right, and matching on the
 * email gets both wrong.
 */
export function decideLink(
  identity: Identity,
  users: LocalUser[],
  opts: { allowCreate: boolean },
): LinkOutcome {
  const bySubject = users.find(u => u.ssoSubject && u.ssoSubject === identity.subject);
  if (bySubject) {
    if (bySubject.status !== 'ACTIVE') {
      return { action: 'refuse', why: 'That account is not active here. Ask an administrator.' };
    }
    return { action: 'sign-in', userId: bySubject.id };
  }

  const byEmail = users.find(u => u.email.toLowerCase() === identity.email);
  if (byEmail) {
    if (byEmail.status !== 'ACTIVE') {
      return { action: 'refuse', why: 'That account is not active here. Ask an administrator.' };
    }
    /*
     * An account already tied to a different provider subject is not this
     * person. Re-linking it on a matching address is exactly the takeover the
     * verified-email check exists to prevent, arriving by another route.
     */
    if (byEmail.ssoSubject && byEmail.ssoSubject !== identity.subject) {
      return {
        action: 'refuse',
        why: 'That address already belongs to an account linked to a different identity. '
          + 'An administrator has to unlink it first.',
      };
    }
    return { action: 'link', userId: byEmail.id };
  }

  if (!opts.allowCreate) {
    return {
      action: 'refuse',
      why: 'There is no account here for that address, and this installation does not create them automatically.',
    };
  }
  return { action: 'create' };
}

/**
 * Whether a redirect target is one this application will send a browser to
 * after signing in.
 *
 * Only a path on this site. An open redirect at the end of a login flow is
 * the classic way to make a phishing link look legitimate: the victim really
 * does sign in to the real site, and is then handed to somewhere else.
 */
export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw) return '/';
  // A protocol-relative URL is an absolute one wearing a disguise.
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  if (/[\r\n]/.test(raw)) return '/';
  return raw;
}
