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
  const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');

  const pool = new pg.Pool({
    connectionString,
    // Serverless invocations are short-lived and numerous; a large per-instance
    // pool exhausts Postgres connections long before it helps throughput.
    max: Number(process.env['DATABASE_POOL_MAX'] ?? 10),
    /**
     * Shorter than the managed provider's own idle cut-off, deliberately.
     *
     * Neon suspends an idle connection from its side after a period of quiet.
     * At 30s this pool was still holding — and still handing out — sockets the
     * server had already closed, so the *next* query on that client failed with
     * `Connection terminated unexpectedly` even though nothing was wrong with
     * the query or the database. Recycling first means the pool discards the
     * socket before the provider does.
     */
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // TCP keepalives stop a connection that is merely quiet from being mistaken
    // for one that is dead, which is the other half of the same problem.
    keepAlive: true,
    keepAliveInitialDelayMillis: 5_000,
    ...(isLocal ? {} : { ssl: { rejectUnauthorized: true } }),
  });

  /**
   * An idle client that dies must not take the process with it.
   *
   * `pg.Pool` emits `error` for a client that fails while sitting idle. That is
   * a normal event against a serverless Postgres — the provider closes idle
   * connections — but Node treats an unhandled `error` on an EventEmitter as
   * fatal, so a routine suspension could surface as a crashed request or, in
   * the integration suite, as a whole file's `beforeAll` collapsing and taking
   * a hundred assertions with it as "skipped".
   *
   * Handling it lets the pool do what it already knows how to do: drop that
   * client and open a fresh one on the next checkout. Logged rather than
   * swallowed silently, because a *sustained* stream of these means something
   * genuinely wrong with the database rather than an idle timeout.
   */
  pool.on('error', (error) => {
    // `console` rather than `@friday/observability`: this package sits below it
    // in the dependency graph and the boundary is lint-enforced. One warning on
    // a recycled socket does not justify inverting the layering.
    // eslint-disable-next-line no-console -- lowest layer; stderr is its channel
    console.warn(
      '[friday/db] idle client errored; the pool will replace it:',
      error instanceof Error ? error.message : String(error),
    );
  });

  return pool;
}

/**
 * Cached on globalThis so Next.js hot reloads reuse one pool instead of leaking
 * a new one per recompile.
 */
export function getDb(): Database {
  if (globalRef.__fridayDb) return globalRef.__fridayDb;

  const rawConnectionString = process.env['DATABASE_URL'];
  if (!rawConnectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and provide a Postgres connection string.',
    );
  }
  const connectionString = rawConnectionString.trim();

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
