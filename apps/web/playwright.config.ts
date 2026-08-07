import { defineConfig, devices } from '@playwright/test';

/**
 * Browser verification.
 *
 * Every phase before this one verified FRIDAY over HTTP, which exercises the
 * routes and services but never the React components that sit on top of them.
 * The forms, the session timer, the practice runner, and the Coach's SSE parser
 * had no coverage at all. This config is what closes that gap.
 *
 * The server under test is a **production build** (`next start`), not `next
 * dev`. Phase 3 lost half a day to a defect that `typecheck` and `lint` both
 * passed and only the production build caught, so the thing we verify is the
 * thing we ship.
 *
 * Set `E2E_BASE_URL` to point at an already-running server; otherwise one is
 * started here and torn down at the end.
 */

const externalBaseUrl = process.env['E2E_BASE_URL'];
const port = Number(process.env['E2E_PORT'] ?? 3100);
const baseURL = externalBaseUrl ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  // The journey spec walks one learner through an ordered story, so its tests
  // share state by design. Workers are per-file, and each file provisions its
  // own learner, so files stay parallel-safe.
  fullyParallel: false,
  workers: process.env['CI'] ? 1 : 2,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // Deterministic clock-independent formatting in assertions.
    locale: 'en-GB',
    timezoneId: 'Asia/Kolkata',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      // The full journey again, on an emulated touch phone. `responsive.spec`
      // covers the viewport matrix; this covers what a viewport cannot fake —
      // touch events, a mobile user agent, and no hover. Most of FRIDAY's
      // learners are on a phone, so the journey has to hold there too.
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: /journey\.spec\.ts/,
    },
  ],

  ...(externalBaseUrl
    ? {}
    : {
        webServer: {
          command: `pnpm start --port ${port}`,
          url: `http://127.0.0.1:${port}/sign-in`,
          reuseExistingServer: !process.env['CI'],
          timeout: 120_000,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      }),
});
