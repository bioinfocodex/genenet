import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { decrypt } from '@/lib/session';

const PUBLIC_PATHS = ['/login', '/register', '/setup', '/connect', '/download'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Forward pathname so layout.tsx can detect auth pages without another DB call
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);

  if (
    PUBLIC_PATHS.some(p => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/api/')
  ) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const token = request.cookies.get('session')?.value;
  const session = await decrypt(token);

  if (!session) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Admin-only paths
  if (pathname.startsWith('/admin') && session.role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
