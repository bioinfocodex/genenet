import { cookies } from 'next/headers';
import { configured, discover, newSecrets, ssoEnabled } from '@/lib/oidc-server';
import { startUrl, safeReturnTo } from '@/lib/oidc';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Begin a sign-in with the institution's identity provider.
 *
 * The three secrets go into one short-lived, httpOnly cookie. They have to
 * come back from the same browser that started: a state held in memory on the
 * server would work for one process and not for two, and a state held nowhere
 * is no state at all.
 */
export async function GET(req: Request) {
  if (!ssoEnabled()) {
    return Response.json({ error: 'Single sign-on is not configured here.' }, { status: 404 });
  }

  const config = configured()!;
  const discovery = await discover(config);
  if ('error' in discovery) {
    return Response.json({ error: discovery.error }, { status: 502 });
  }

  const secrets = newSecrets();
  const returnTo = safeReturnTo(new URL(req.url).searchParams.get('from'));

  const jar = await cookies();
  jar.set('sso_flow', JSON.stringify({
    state: secrets.state,
    nonce: secrets.nonce,
    codeVerifier: secrets.codeVerifier,
    returnTo,
  }), {
    httpOnly: true,
    sameSite: 'lax',   // the provider redirects back with a GET, which lax allows
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth/sso',
    // Long enough to type a password and answer a second factor, short enough
    // that an abandoned attempt does not sit in a browser for a day.
    maxAge: 10 * 60,
  });

  return Response.redirect(startUrl({
    ...config,
    authorizationEndpoint: discovery.authorization_endpoint,
    tokenEndpoint: discovery.token_endpoint,
    jwksUri: discovery.jwks_uri,
  }, secrets), 302);
}
