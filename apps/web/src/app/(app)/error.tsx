'use client';

import { useEffect } from 'react';
import { ErrorState } from '@friday/ui';

/**
 * Route-level error boundary — §4.4's "error (with recovery)" state.
 *
 * Scoped to the authenticated shell, so a failure in one screen does not blank
 * the navigation. The digest is surfaced because support cannot correlate a
 * report without it.
 *
 * No `@friday/observability` import: it is a server-side package
 * (`AsyncLocalStorage`) and would break the client bundle. Sentry's Next.js
 * client instrumentation already captures errors that reach a boundary.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console -- client boundary; the structured logger is server-only
    console.error('Route error', error.digest ?? '', error);
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
