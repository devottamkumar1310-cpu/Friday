import { getDb, productRepository } from '@friday/db';
import { logger } from '@friday/observability';

/**
 * Liveness and readiness.
 *
 * A load balancer needs to know whether this instance can serve traffic, and
 * "the process is running" is not the same question as "it can reach its
 * database". The distinction matters during a deploy: an instance that has
 * started but cannot reach Postgres must not be sent requests.
 *
 * Deliberately says as little as possible. A health endpoint is unauthenticated
 * by necessity, so it reports whether dependencies answer — never their
 * versions, hostnames, or error text, which is reconnaissance for free.
 */

export interface HealthReport {
  status: 'ok' | 'degraded';
  checks: { database: 'ok' | 'unreachable' };
  /** Set by the platform at build time; useful for confirming what is deployed. */
  revision: string | null;
  uptimeSeconds: number;
}

export async function checkHealth(): Promise<HealthReport> {
  let database: 'ok' | 'unreachable' = 'ok';

  try {
    await productRepository(getDb()).ping();
  } catch (error) {
    database = 'unreachable';
    // Logged in full internally; never returned to the caller.
    //
    // The cause chain matters here: a driver failure usually wraps the useful
    // part (`ECONNREFUSED`, `ENOTFOUND`, a TLS complaint) one level down, and
    // the outer message alone is often just "Failed query".
    logger.error('health check: database unreachable', {
      error: error instanceof Error ? error.message : String(error),
      ...describeCause(error),
    });
  }

  return {
    status: database === 'ok' ? 'ok' : 'degraded',
    checks: { database },
    revision: process.env['VERCEL_GIT_COMMIT_SHA'] ?? process.env['GIT_COMMIT_SHA'] ?? null,
    uptimeSeconds: Math.round(process.uptime()),
  };
}

/**
 * Pulls the useful fields off an unknown thrown value.
 *
 * Narrowed with `unknown` and property checks rather than `as any`, so a driver
 * that changes its error shape produces a missing field rather than a crash
 * inside the error handler — which would turn an unreachable database into an
 * unreachable health endpoint.
 */
function describeCause(error: unknown): { cause?: string; code?: string } {
  if (typeof error !== 'object' || error === null) return {};

  const cause = 'cause' in error ? (error as { cause?: unknown }).cause : undefined;
  const out: { cause?: string; code?: string } = {};

  if (cause instanceof Error) out.cause = cause.message;
  else if (cause !== undefined) out.cause = String(cause);

  const codeOf = (v: unknown): string | undefined =>
    typeof v === 'object' && v !== null && 'code' in v
      ? String((v as { code?: unknown }).code)
      : undefined;

  const code = codeOf(cause) ?? codeOf(error);
  if (code) out.code = code;

  return out;
}
