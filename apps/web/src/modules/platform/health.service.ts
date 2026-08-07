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
    logger.error('health check: database unreachable', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    status: database === 'ok' ? 'ok' : 'degraded',
    checks: { database },
    revision: process.env['VERCEL_GIT_COMMIT_SHA'] ?? process.env['GIT_COMMIT_SHA'] ?? null,
    uptimeSeconds: Math.round(process.uptime()),
  };
}
