import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge middleware.
 *
 * Two jobs, both cheap: stamp a request id so client and server logs share one,
 * and redirect on *cookie presence* for navigation UX.
 *
 * It deliberately does not validate the session. Middleware runs on the edge
 * runtime, without the database or node crypto, so a real check is impossible
 * here — and pretending otherwise would put an authorization decision somewhere
 * it cannot be enforced. Every protected page and route re-checks for real
 * (see lib/auth/server.ts and lib/api/handler.ts); this only saves a round trip
 * to a page that would immediately redirect.
 */

const SESSION_COOKIE = 'friday_session';

const PROTECTED = ['/dashboard', '/onboarding', '/settings'];
const AUTH_PAGES = ['/sign-in', '/sign-up'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasCookie = req.cookies.has(SESSION_COOKIE);

  if (PROTECTED.some((p) => pathname.startsWith(p)) && !hasCookie) {
    const url = req.nextUrl.clone();
    url.pathname = '/sign-in';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (AUTH_PAGES.includes(pathname) && hasCookie) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
  const headers = new Headers(req.headers);
  headers.set('x-request-id', requestId);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set('X-Request-Id', requestId);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
