import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge middleware.
 *
 * Two jobs, both cheap: stamp a request id so client and server logs share one,
 * and send a learner with no cookie at all away from a protected page.
 *
 * It deliberately does not validate the session. Middleware runs on the edge
 * runtime, without the database or node crypto, so a real check is impossible
 * here — and pretending otherwise would put an authorization decision somewhere
 * it cannot be enforced. Every protected page and route re-checks for real
 * (see lib/auth/server.ts and lib/api/handler.ts); this only saves a round trip
 * to a page that would immediately redirect.
 *
 * It used to also bounce anyone *holding* a cookie away from `/sign-in`. That
 * was a lockout: a cookie is not a session. A learner whose session had expired
 * or been revoked was redirected to `/dashboard`, which validated the session
 * for real, failed, and redirected back to `/sign-in` — an infinite loop, with
 * no way to sign in again short of clearing cookies by hand. The check now
 * lives on the auth pages themselves, which run on Node and can tell the
 * difference between a cookie and a session.
 */

const SESSION_COOKIE = 'friday_session';

const PROTECTED = ['/dashboard', '/onboarding', '/settings'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PROTECTED.some((p) => pathname.startsWith(p)) && !req.cookies.has(SESSION_COOKIE)) {
    const url = req.nextUrl.clone();
    url.pathname = '/sign-in';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
  const nonce = btoa(crypto.randomUUID());

  const headers = new Headers(req.headers);
  headers.set('x-request-id', requestId);
  headers.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set('X-Request-Id', requestId);
  response.headers.set('Content-Security-Policy', contentSecurityPolicy(nonce));
  return response;
}

/**
 * Nonce-based CSP.
 *
 * Built here rather than in `next.config.mjs` because a nonce has to be fresh
 * per request, and static headers cannot be. `strict-dynamic` lets the scripts
 * Next bootstraps with the nonce load their own chunks without every chunk URL
 * having to be enumerated, which is what makes a strict policy survive a
 * framework that code-splits.
 *
 * The one inline script FRIDAY ships — the pre-paint theme switch in the root
 * layout — carries this nonce. Adding another inline script without one will
 * fail loudly in the console rather than silently weakening the policy, which
 * is the intended pressure.
 */
function contentSecurityPolicy(nonce: string): string {
  // Sentry posts events to its own ingest host; allow exactly that origin and
  // nothing else when a DSN is configured.
  let sentryOrigin = '';
  const dsn = process.env['SENTRY_DSN'];
  if (dsn) {
    try {
      sentryOrigin = ` ${new URL(dsn).origin}`;
    } catch {
      // A malformed DSN is a deployment problem, not a reason to widen the CSP.
    }
  }

  const development = process.env.NODE_ENV !== 'production';

  return [
    "default-src 'self'",
    // `unsafe-eval` only in development, where React Refresh needs it.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    // Tailwind emits a stylesheet, but Next still inlines critical CSS and
    // React sets styles on elements, so style-src cannot be nonce-only here.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${sentryOrigin}${development ? ' ws:' : ''}`,
    "form-action 'self'",
    // Belt and braces with X-Frame-Options: DENY, which older browsers honour.
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    ...(development ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
