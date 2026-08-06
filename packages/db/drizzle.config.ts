import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit generates the SQL; every migration is reviewed as SQL rather than
 * trusted as generated output (DATABASE_DESIGN §9).
 */
export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/friday',
  },
  strict: true,
  verbose: true,
});
