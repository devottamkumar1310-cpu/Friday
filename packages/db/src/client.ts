import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

/**
 * Database connection.
 *
 * node-postgres rather than the Neon HTTP driver, for two reasons: it supports
 * multi-statement transactions — which the session-completion write depends on
 * (SYSTEM_ARCHITECTURE §6.4) — and it speaks plain Postgres, so local, Neon,
 * and CI all use the same code path. Against Neon, point DATABASE_URL at the
 * pooled endpoint. Swapping to `@neondatabase/serverless` is a one-line change
 * here if cold-start latency ever justifies it.
 */

export type Database = NodePgDatabase<typeof schema>;

interface DbGlobal {
  __fridayPool?: pg.Pool;
  __fridayDb?: Database;
}

const globalRef = globalThis as unknown as DbGlobal;

function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    // Serverless invocations are short-lived and numerous; a large per-instance
    // pool exhausts Postgres connections long before it helps throughput.
    max: Number(process.env['DATABASE_POOL_MAX'] ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ...(connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
      ? {}
      : { ssl: { rejectUnauthorized: true } }),
  });
}

/**
 * Cached on globalThis so Next.js hot reloads reuse one pool instead of leaking
 * a new one per recompile.
 */
export function getDb(): Database {
  if (globalRef.__fridayDb) return globalRef.__fridayDb;

  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and provide a Postgres connection string.',
    );
  }

  const pool = globalRef.__fridayPool ?? createPool(connectionString);
  const db = drizzle(pool, { schema });

  globalRef.__fridayPool = pool;
  globalRef.__fridayDb = db;
  return db;
}

/** Release the pool. For scripts and test teardown; the server never calls it. */
export async function closeDb(): Promise<void> {
  await globalRef.__fridayPool?.end();
  globalRef.__fridayPool = undefined;
  globalRef.__fridayDb = undefined;
}

export { schema };
