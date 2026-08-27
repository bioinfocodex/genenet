import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { decrypt } from '@/lib/session';

/** Pages reachable before signing in. */
const PUBLIC_PATHS = ['/login', '/register', '/setup', '/connect', '/download'];

/**
 * Endpoints reachable before signing in. Exactly one: the desktop app posts a
 * connection code here to find out whether it is pointed at the right
 * workspace, which necessarily happens before any session exists.
 *
 * Everything else under /api used to be exempt as a group, which left the whole
 * API open -- including the report export, which returns a full experimental
 * record. Add to this list only with the same justification.
 */
const PUBLIC_API_PATHS = ['/api/validate-code'];

/**
 * The token-authenticated API. Not public -- every route under here checks a
 * bearer token itself -- but it must not be sent to a login page, because the
 * caller is a script and a 302 to HTML is not something it can act on.
 */
const TOKEN_API_PREFIX = '/api/v1';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');

  // Forward pathname so layout.tsx can detect auth pages without another DB call
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);
  const proceed = () => NextResponse.next({ request: { headers: requestHeaders } });

  if (
    PUBLIC_PATHS.some(p => pathname.startsWith(p)) ||
    PUBLIC_API_PATHS.some(p => pathname === p || pathname.startsWith(p + '/')) ||
    pathname === TOKEN_API_PREFIX || pathname.startsWith(TOKEN_API_PREFIX + '/') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return proceed();
  }

  const token = request.cookies.get('session')?.value;
  const session = await decrypt(token);

  if (!session) {
    // An API client wants a status code, not a login page.
    if (isApi) {
      return NextResponse.json({ error: 'Sign in to use this endpoint.' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Cheap first pass so a member does not load the admin bundle at all. This
  // reads the role claim baked into the token, which can be up to seven days
  // stale, so it is a convenience rather than a control: the /admin pages and
  // the actions behind them re-check against the database via requireAdmin().
  if (pathname.startsWith('/admin') && session.role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return proceed();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
