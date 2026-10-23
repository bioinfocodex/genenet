/**
 * What is reachable with no session at all.
 *
 * Kept here, away from the proxy, because the proxy imports next/server and so
 * can only run inside the bundler -- and this is the one decision in the
 * application that most deserves to be tested directly. A mistake is silent in
 * both directions: too narrow and signing in becomes impossible, too wide and
 * the API is open. Both have happened.
 */

/** Pages reachable before signing in. */
export const PUBLIC_PATHS = ['/login', '/register', '/setup', '/connect', '/download'];

/**
 * Endpoints reachable before signing in. The justification is the same for
 * both: they are how a session comes to exist, so requiring one is circular.
 *
 *   /api/validate-code — the desktop app posts a connection code to find out
 *     whether it is pointed at the right workspace.
 *   /api/auth/sso — the single sign-on handshake. The browser is sent to the
 *     provider and comes back here with a code; both halves necessarily
 *     happen while signed out. The prefix covers start and callback and
 *     nothing else under /api/auth, which stays guarded.
 *
 * Everything else under /api used to be exempt as a group, which left the whole
 * API open -- including the report export, which returns a full experimental
 * record. Add to this list only with the same justification.
 */
export const PUBLIC_API_PATHS = ['/api/validate-code', '/api/auth/sso'];

/**
 * The token-authenticated API. Not public -- every route under here checks a
 * bearer token itself -- but it must not be sent to a login page, because the
 * caller is a script and a 302 to HTML is not something it can act on.
 */
export const TOKEN_API_PREFIX = '/api/v1';

export function reachableWithoutSession(pathname: string): boolean {
  const underPrefix = (p: string) => pathname === p || pathname.startsWith(p + '/');
  return (
    PUBLIC_PATHS.some(p => pathname.startsWith(p)) ||
    PUBLIC_API_PATHS.some(underPrefix) ||
    underPrefix(TOKEN_API_PREFIX) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  );
}
