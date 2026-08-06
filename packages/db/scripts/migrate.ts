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

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) {
  console.error(
    'DATABASE_URL is not set.\n' +
      'Copy .env.example to .env.local and provide a Postgres 16+ connection string.',
  );
  process.exit(1);
}

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
