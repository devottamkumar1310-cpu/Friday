'use client';

import { useEffect } from 'react';
import { captureException } from '@sentry/nextjs';

/**
 * Last-resort boundary: catches failures in the root layout itself, which the
 * route-level boundary cannot. It renders its own <html>/<body>, because at
 * this point the layout that normally supplies them has failed.
 *
 * Deliberately imports nothing from `@friday/observability`: that package uses
 * `AsyncLocalStorage` for request-scoped context and cannot run in a browser
 * bundle — importing it here broke the production build in Phase 3. Reporting
 * goes directly to Sentry, which is a no-op when no DSN is configured.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error, { tags: { boundary: 'global', digest: error.digest ?? 'none' } });
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center p-6">
        <div className="max-w-md space-y-3 text-center">
          <h1 className="text-xl font-semibold">Something went badly wrong</h1>
          <p className="text-sm text-muted-foreground">
            FRIDAY could not recover on its own. Reloading usually fixes it.
          </p>
          {error.digest ? (
            <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-border px-4 py-2 text-sm"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
