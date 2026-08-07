import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { newLearner, onboard } from './support/learner';

/**
 * Performance against the budgets in PRODUCT_REQUIREMENTS §NFR-1.
 *
 * Measured, not asserted-and-hoped. The numbers below come from a local
 * production build against a local PostgreSQL, which is a *floor*, not a
 * prediction: no network between app and database, no cold starts, one user.
 * A local run that already misses a budget will certainly miss it in
 * production; a local run that meets it has only earned the right to be
 * measured again on real infrastructure. The report says so.
 *
 * The one budget deliberately not asserted here is NFR-1.5 (first token
 * < 1.5s), because it needs a live provider — it is measured in
 * `coach-live.spec.ts`, which reports TTFT directly.
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

/** PRODUCT_REQUIREMENTS §NFR-1. */
const BUDGET = {
  readApiP95Ms: 200,
  writeApiP95Ms: 400,
  nextActionP95Ms: 300,
  missionControlInteractiveP95Ms: 2000,
  planGenerationP95Ms: 45_000,
};

const SAMPLES = 20;

const learner = newLearner('perf');

let context: BrowserContext;
let page: Page;
let goalId: string;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await onboard(page, learner);

  goalId = await page.evaluate(async () => {
    const response = await fetch('/api/v1/goals', { credentials: 'include' });
    return ((await response.json()) as { data: { id: string }[] }).data[0]!.id;
  });
});

test.afterAll(async () => {
  await context.close();
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[index]!);
}

/** Timed inside the page, so the measurement includes the real fetch path. */
async function timeRequest(path: string, samples = SAMPLES): Promise<number[]> {
  return page.evaluate(
    async ([path, samples]) => {
      const timings: number[] = [];
      for (let i = 0; i < (samples as number); i += 1) {
        const started = performance.now();
        const response = await fetch(path as string, { credentials: 'include' });
        await response.text();
        timings.push(performance.now() - started);
      }
      return timings;
    },
    [path, samples] as const,
  );
}

function report(label: string, timings: number[], budgetMs: number): void {
  const p50 = percentile(timings, 50);
  const p95 = percentile(timings, 95);
  const verdict = p95 <= budgetMs ? 'PASS' : 'OVER BUDGET';
  // eslint-disable-next-line no-console -- the measurement is the deliverable
  console.log(
    `${verdict.padEnd(11)} ${label.padEnd(34)} p50 ${String(p50).padStart(5)}ms  ` +
      `p95 ${String(p95).padStart(5)}ms  (budget ${budgetMs}ms)`,
  );
}

test('NFR-1.3 — read API latency', async () => {
  const paths = [
    ['GET /me', '/api/v1/me'],
    ['GET /goals', '/api/v1/goals'],
    ['GET /tasks', '/api/v1/tasks'],
    ['GET /memory/mastery', '/api/v1/memory/mastery'],
    ['GET /intelligence/progress', '/api/v1/intelligence/progress'],
    ['GET /goals/{id}/mission-control', `/api/v1/goals/${goalId}/mission-control`],
  ] as const;

  const worst: { label: string; p95: number }[] = [];
  for (const [label, path] of paths) {
    const timings = await timeRequest(path);
    report(label, timings, BUDGET.readApiP95Ms);
    worst.push({ label, p95: percentile(timings, 95) });
  }

  const over = worst.filter((w) => w.p95 > BUDGET.readApiP95Ms);
  expect(
    over,
    `over the ${BUDGET.readApiP95Ms}ms read budget: ${over.map((o) => `${o.label} ${o.p95}ms`).join(', ')}`,
  ).toEqual([]);
});

test('NFR-1.7 — Next Action computation, the load-bearing one', async () => {
  // Architecturally load-bearing: the Next Action is computed by the
  // deterministic engine with no LLM in the hot path, and this budget is what
  // makes that claim falsifiable.
  const timings = await timeRequest(`/api/v1/goals/${goalId}/next-action`);
  report('GET /goals/{id}/next-action', timings, BUDGET.nextActionP95Ms);
  expect(percentile(timings, 95)).toBeLessThanOrEqual(BUDGET.nextActionP95Ms);
});

test('NFR-1.4 — write API latency', async () => {
  const timings = await page.evaluate(async (samples) => {
    const results: number[] = [];
    for (let i = 0; i < samples; i += 1) {
      const started = performance.now();
      const response = await fetch('/api/v1/me/preferences', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxDirectivesPerDay: (i % 5) + 1 }),
      });
      await response.text();
      results.push(performance.now() - started);
    }
    return results;
  }, SAMPLES);

  report('PATCH /me/preferences', timings, BUDGET.writeApiP95Ms);
  expect(percentile(timings, 95)).toBeLessThanOrEqual(BUDGET.writeApiP95Ms);
});

test('NFR-1.2 — Mission Control is interactive inside its budget', async () => {
  const timings: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    const fresh = await context.newPage();
    const started = Date.now();
    await fresh.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    // Interactive means the primary action is really there and clickable, not
    // that a spinner rendered.
    await fresh.getByRole('link', { name: 'Start this now' }).waitFor({ state: 'visible' });
    timings.push(Date.now() - started);
    await fresh.close();
  }

  report('/dashboard → actionable', timings, BUDGET.missionControlInteractiveP95Ms);
  expect(percentile(timings, 95)).toBeLessThanOrEqual(BUDGET.missionControlInteractiveP95Ms);
});

test('NFR-1.6 — onboarding a new learner, including plan generation', async ({ browser }) => {
  // The heaviest synchronous path in the product: curriculum, feasibility, and
  // a fourteen-day plan, all before the learner sees a dashboard.
  const fresh = await browser.newContext();
  const freshPage = await fresh.newPage();

  const started = Date.now();
  await onboard(freshPage, newLearner('perf-onboard'));
  const elapsed = Date.now() - started;

  report('sign-up → planned dashboard', [elapsed], BUDGET.planGenerationP95Ms);
  expect(elapsed).toBeLessThanOrEqual(BUDGET.planGenerationP95Ms);

  await fresh.close();
});

test('the dashboard ships a defensible amount of JavaScript', async () => {
  // Not a stated NFR, but NFR-1.1/1.2 are unreachable on a mid-range phone if
  // the bundle is large, and most of FRIDAY's learners are on one.
  const fresh = await context.newPage();
  // Measured from the body, not `content-length`: Next serves chunked, so the
  // header is absent and reading it reports a confident zero.
  const pending: Promise<number>[] = [];
  fresh.on('response', (response) => {
    if (response.url().includes('/_next/static/') && response.url().endsWith('.js')) {
      pending.push(
        response
          .body()
          .then((b) => b.length)
          .catch(() => 0),
      );
    }
  });

  // `load`, not `networkidle`. Next prefetches every nav link in the viewport
  // once the page settles — seven destinations' worth — and counting those
  // reports the whole app's JavaScript as if the dashboard needed it.
  await fresh.goto('/dashboard', { waitUntil: 'load' });

  const scriptBytes = (await Promise.all(pending)).reduce((a, b) => a + b, 0);
  const kb = Math.round(scriptBytes / 1024);
  expect(kb, 'no scripts were observed — the measurement is broken').toBeGreaterThan(0);
  // eslint-disable-next-line no-console -- the measurement is the deliverable
  console.log(`INFO        dashboard JavaScript, uncompressed  ${kb} KB (critical path)`);

  // Uncompressed, so this is the parse-and-compile cost — the part that hurts a
  // mid-range phone, and not the same number as `next build`'s compressed
  // "First Load JS". A regression guard rather than a target.
  expect(kb, 'the dashboard critical path has grown substantially').toBeLessThan(900);

  await fresh.close();
});
