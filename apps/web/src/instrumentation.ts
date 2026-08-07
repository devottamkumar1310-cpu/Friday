import { logger, registerReporter } from '@friday/observability';
import { inspectEnv } from './lib/env';

/**
 * Runs once per server start (Next.js instrumentation hook).
 *
 * Sentry is the intended reporter (SYSTEM_ARCHITECTURE §11), wired here rather
 * than inside @friday/observability so that a leaf package used by scripts and
 * jobs does not drag in a framework SDK. Without a DSN the reporter still
 * records to the structured log, so local development is never silent.
 */
export function register(): void {
  verifyEnvironment();

  const dsn = process.env['SENTRY_DSN'];

  if (!dsn) {
    registerReporter(({ error, context }) => {
      logger.error('unhandled exception (no SENTRY_DSN configured)', {
        error: error instanceof Error ? error.message : String(error),
        ...context,
      });
    });
    return;
  }

  // Deferred so the SDK is only loaded when it is actually configured.
  void import('@sentry/nextjs')
    .then((Sentry) => {
      Sentry.init({
        dsn,
        tracesSampleRate: Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? 0.1),
        environment: process.env['NODE_ENV'],
      });

      registerReporter(({ error, context, requestId, userId, severity }) => {
        Sentry.withScope((scope) => {
          if (requestId) scope.setTag('request_id', requestId);
          if (userId) scope.setUser({ id: userId });
          scope.setLevel(severity === 'warning' ? 'warning' : 'error');
          scope.setContext('friday', context ?? {});
          Sentry.captureException(error);
        });
      });
    })
    .catch((error: unknown) => {
      logger.warn('Sentry SDK failed to load; falling back to log-only reporting', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

/**
 * Refuses to serve traffic on a misconfiguration that would be unsafe rather
 * than merely broken — a missing signing secret, a placeholder database URL.
 *
 * Crashing at boot is the kind option. The alternative is an instance that
 * accepts requests and fails them one learner at a time, which is harder to
 * diagnose and, in the case of a forgeable `AUTH_SECRET`, quietly insecure.
 */
function verifyEnvironment(): void {
  const problems = inspectEnv();
  if (problems.length === 0) return;

  for (const { variable, problem, fatal } of problems) {
    const message = `configuration: ${variable} ${problem}`;
    if (fatal) logger.error(message);
    else logger.warn(message);
  }

  const fatal = problems.filter((p) => p.fatal);
  if (fatal.length > 0) {
    throw new Error(
      `Refusing to start: ${fatal.map((p) => `${p.variable} ${p.problem}`).join('; ')}`,
    );
  }
}
