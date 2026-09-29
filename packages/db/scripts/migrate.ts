/**
 * Applies pending migrations.
 *
 * Expand → deploy → contract (DATABASE_DESIGN §9): additive change ships first,
 * code follows, removal ships later. No column is dropped in the same release
 * as the code that stopped using it.
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '../../../.env.local') });
config({ path: resolve(here, '../../../.env') });

const rawConnectionString = process.env['DATABASE_URL'];
if (!rawConnectionString) {
  console.error(
    'DATABASE_URL is not set.\n' +
      'Copy .env.example to .env.local and provide a Postgres 16+ connection string.',
  );
  process.exit(1);
}

// For migrations / DDL, use DIRECT_DATABASE_URL or strip Neon's -pooler suffix
const connectionString =
  process.env['DIRECT_DATABASE_URL'] ??
  (rawConnectionString.includes('-pooler.')
    ? rawConnectionString.replace('-pooler.', '.')
    : rawConnectionString);

const pool = new pg.Pool({
  connectionString,
  ...(connectionString.includes('localhost') ? {} : { ssl: { rejectUnauthorized: true } }),
});

try {
  await migrate(drizzle(pool), { migrationsFolder: resolve(here, '../migrations') });
  // eslint-disable-next-line no-console -- CLI script
  console.log('Migrations applied.');
} catch (error) {
  console.error('Migration failed:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
