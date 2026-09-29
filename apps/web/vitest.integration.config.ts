import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

/**
 * Integration tests that hit a real Postgres.
 *
 * Deliberately a *separate* lane from `vitest.config.ts`. The default suite is
 * hermetic — it runs in CI with no database, and `pnpm test` must stay that
 * way. These specs prove the things a unit test structurally cannot: that the
 * adaptive loop's writes actually land, that a re-plan really does retire the
 * work it claims to, and that the ledger before and after a regeneration adds
 * up. They need `DATABASE_URL` and they mutate rows, so they run on their own
 * command against their own throwaway users.
 *
 * Single-threaded on purpose: several specs assert on plan-version sequences
 * and churn-budget windows for one goal, which is not a thing that survives
 * being interleaved with itself.
 */
/**
 * Read `.env.local` directly rather than pulling in `dotenv`, which the web app
 * does not otherwise depend on. Next.js loads env for `dev`/`build`/`start`;
 * vitest does not, and adding a production dependency to serve a test lane is
 * the wrong trade.
 */
for (const file of ['.env.local', '.env']) {
  try {
    const path = fileURLToPath(new URL(`../../${file}`, import.meta.url));
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key!] !== undefined) continue;
      process.env[key!] = rawValue!.trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {
    // Absent env file is fine — the specs skip themselves without DATABASE_URL.
  }
}

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
