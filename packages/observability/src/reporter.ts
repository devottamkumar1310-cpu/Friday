import { getRequestContext } from './context';
import { logger } from './logger';
import { redact } from './redact';

/**
 * Error reporting, decoupled from the vendor.
 *
 * Sentry is the chosen tool, but wiring `@sentry/nextjs` in here would drag a
 * framework dependency into a leaf package that jobs and scripts also import.
 * The composition root registers a reporter instead; until it does, exceptions
 * still reach the log.
 */

export interface ErrorReport {
  error: unknown;
  /** Extra structured context. Redacted before it leaves the process. */
  context?: Record<string, unknown>;
  /** `error` is the default; `warning` for handled, expected faults. */
  severity?: 'error' | 'warning';
}

export type Reporter = (report: ErrorReport & { requestId?: string; userId?: string }) => void;

let reporter: Reporter | undefined;

export function registerReporter(fn: Reporter): void {
  reporter = fn;
}

export function captureException(report: ErrorReport): void {
  const ctx = getRequestContext();
  const enriched = {
    ...report,
    context: redact(report.context ?? {}) as Record<string, unknown>,
    ...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
    ...(ctx?.userId ? { userId: ctx.userId } : {}),
  };

  logger.error(
    report.error instanceof Error ? report.error.message : 'Unhandled exception',
    enriched.context,
  );

  try {
    reporter?.(enriched);
  } catch {
    // A failing reporter must never mask the original error.
  }
}
