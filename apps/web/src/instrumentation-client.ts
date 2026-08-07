/**
 * Browser-side error reporting.
 *
 * Everything before this phase reported only server-side exceptions. That left
 * the entire client invisible: a hydration mismatch, a failed `fetch`, a
 * component that throws into an error boundary — the learner saw the error
 * state, and nobody else ever knew. The error boundaries themselves deliberately
 * do not import `@friday/observability`, because it uses `AsyncLocalStorage` and
 * pulling it into a client boundary broke the production build in Phase 3.
 *
 * Silent unless `NEXT_PUBLIC_SENTRY_DSN` is set, so local development and CI
 * send nothing.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env['NEXT_PUBLIC_SENTRY_DSN'];

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env['NEXT_PUBLIC_ENVIRONMENT'] ?? 'production',
    // Sampled: errors are cheap, traces are not, and a beta does not need
    // every span to find out what is slow.
    tracesSampleRate: 0.1,
    // Session Replay is off. It records the DOM, and these screens carry a
    // learner's mastery, their weaknesses, and what they told the coach —
    // turning it on would be a privacy decision, not a debugging one.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    /**
     * Last line of defence before anything leaves the browser. The transport
     * URL can carry a task or goal id, and a breadcrumb can carry whatever a
     * learner typed.
     */
    beforeSend(event) {
      if (event.request?.url) event.request.url = stripIds(event.request.url);
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === 'console') return null;
      if (typeof breadcrumb.data?.['url'] === 'string') {
        breadcrumb.data['url'] = stripIds(breadcrumb.data['url']);
      }
      return breadcrumb;
    },
  });
}

/** `/study/018f-…` → `/study/:id`, and no query string at all. */
function stripIds(url: string): string {
  return url
    .split('?')[0]!
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');
}

// Note: `onRouterTransitionStart` — the hook that ties navigation spans
// together — is a Sentry v9 export. This project is on v8, so client traces are
// per-page rather than per-navigation. Not worth a major SDK upgrade during a
// verification phase; recorded in the Launch Readiness Report instead.
