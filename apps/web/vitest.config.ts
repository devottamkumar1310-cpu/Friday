import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Unit and service tests only.
 *
 * `e2e/` holds Playwright specs. They import `@playwright/test`, which defines
 * its own `test`/`expect`, so vitest picking them up fails at collection — and
 * more importantly they need a running server and a database, which is a
 * different gate with a different cost.
 *
 * `*.integration.test.ts` is the same argument: those specs need `DATABASE_URL`
 * and they write rows. They have their own config and their own command
 * (`pnpm test:integration`) so that `pnpm test` stays runnable anywhere.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: [
      'e2e/**',
      'node_modules/**',
      '.next/**',
      'src/**/*.integration.test.ts',
      'src/**/__tests__/fixtures.ts',
    ],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
