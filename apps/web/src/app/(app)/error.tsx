'use client';

import { useEffect } from 'react';
import { captureException } from '@sentry/nextjs';
import { ErrorState } from '@friday/ui';

/**
 * Route-level error boundary — §4.4's "error (with recovery)" state.
 *
 * Scoped to the authenticated shell, so a failure in one screen does not blank
 * the navigation. The digest is surfaced because support cannot correlate a
 * report without it.
 *
 * No `@friday/observability` import: it is a server-side package
 * (`AsyncLocalStorage`), and importing it here broke the production build in
 * Phase 3 while passing both typecheck and lint. Reporting goes straight to
 * Sentry instead, which is configured in `instrumentation-client.ts` and is a
 * no-op when no DSN is set.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Reported explicitly rather than relying on the boundary being observed:
    // an error a learner sees and nobody records is the failure mode this
    // phase exists to remove.
    captureException(error, { tags: { boundary: 'app', digest: error.digest ?? 'none' } });
  }, [error]);

  return (
    <ErrorState
      title="This page could not load"
      description="The rest of FRIDAY is still working — your plan and progress are unaffected."
      requestId={error.digest}
      onRetry={reset}
    />
  );
}
