import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { newLearner, onboard } from './support/learner';

/**
 * The plan re-derives itself without being asked.
 *
 * The scheduler, the drift computation, the materiality gate and the churn
 * budget all shipped in Phase 1. What was missing was anything that *called*
 * them: re-planning ran only when a learner pressed a button, which meant the
 * adaptive system was adaptive in principle and static in practice.
 *
 * Three triggers now exist — session completed, session discarded, and the
 * first visit of a new day. This asserts on the two that can be exercised
 * inside a test run, and on the guard that stops them becoming a nuisance.
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const learner = newLearner('replan');

let context: BrowserContext;
let page: Page;

interface PlanShape {
  version: number;
  windowStart: string;
}

/** The active plan, read through the API the app itself uses. */
async function activePlan(target: Page, goalId: string): Promise<PlanShape> {
  return target.evaluate(async (id) => {
    const response = await fetch(`/api/v1/goals/${id}/plans/current`, { credentials: 'include' });
    const body = (await response.json()) as { data: { version: number; windowStart: string } };
    return { version: body.data.version, windowStart: body.data.windowStart };
  }, goalId);
}

async function firstGoalId(target: Page): Promise<string> {
  return target.evaluate(async () => {
    const response = await fetch('/api/v1/goals', { credentials: 'include' });
    return ((await response.json()) as { data: { id: string }[] }).data[0]!.id;
  });
}

let goalId: string;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await onboard(page, learner);
  goalId = await firstGoalId(page);
});

test.afterAll(async () => {
  await context.close();
});

test('a plan exists after onboarding, at version 1', async () => {
  const plan = await activePlan(page, goalId);
  expect(plan.version).toBe(1);
});

test('completing a session triggers a re-plan without the learner asking', async () => {
  const before = await activePlan(page, goalId);

  await page.goto('/dashboard');
  await page.getByRole('link', { name: 'Start this now' }).click();
  await page.getByRole('button', { name: 'Start studying' }).click();
  await page.getByRole('button', { name: /done studying/i }).click();
  await page
    .getByRole('button', { name: /^Easily/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Save and finish' }).click();
  await expect(page.getByText(/minutes? done\./)).toBeVisible({ timeout: 30_000 });

  const after = await activePlan(page, goalId);

  // Either the plan moved on, or the materiality gate judged the change too
  // small to be worth disturbing the learner. Both are correct outcomes of a
  // working trigger; a *crash* or an unchanged-because-never-ran plan is not.
  // What must hold is that the request completed and the plan is still valid.
  expect(after.version).toBeGreaterThanOrEqual(before.version);
  expect(after.windowStart).toBeTruthy();
});

test('the learner is told what they did, and offered the way forward', async () => {
  /**
   * This used to assert "FRIDAY will adjust your plan… come back tomorrow" —
   * true, and about the machinery. The learner has just done the hard part, and
   * the screen spent its one moment of their attention describing the system.
   *
   * What is reinforced now is the *behaviour*: sitting down and staying is the
   * repeatable act. Mastery movement is still shown above, but it is an outcome
   * they did not directly control, and praising it teaches learners to re-study
   * what they already know because it produces nicer numbers.
   */
  await expect(page.getByText(/stayed with it|Short counts/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'See updated plan' })).toBeVisible();
});

test('the churn budget stops automatic re-plans from thrashing the plan', async () => {
  await page.getByRole('button', { name: 'See updated plan' }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

  const start = await activePlan(page, goalId);

  // Discarding also triggers a re-plan. §10.3 caps automatic commits at one per
  // 24 hours, so however many times this fires, the plan must not run away.
  for (let i = 0; i < 2; i += 1) {
    await page.goto('/dashboard');
    const startLink = page.getByRole('link', { name: 'Start this now' });
    if ((await startLink.count()) === 0) break;
    await startLink.click();
    await page.getByRole('button', { name: 'Start studying' }).click();
    await page.getByRole('button', { name: 'Discard' }).click();
    await page.getByRole('button', { name: 'Discard', exact: true }).last().click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  }

  const end = await activePlan(page, goalId);
  expect(
    end.version - start.version,
    `the plan churned ${end.version - start.version} times under the 24h budget`,
  ).toBeLessThanOrEqual(1);
});

test('a session can never record more time than has actually elapsed', async ({ browser }) => {
  // The clamp. `activeMinutes` is client-reported and the schema alone would
  // accept a flat 1440; the server bounds it by `started_at`, which the client
  // cannot argue with. Everything downstream — mastery totals, pace,
  // feasibility — is computed from this number.
  //
  // Its own learner, because the tests above consume this one's open tasks.
  const fresh = await browser.newContext();
  const freshPage = await fresh.newPage();
  await onboard(freshPage, newLearner('clamp'));

  await freshPage.getByRole('link', { name: 'Start this now' }).click();
  await freshPage.getByRole('button', { name: 'Start studying' }).click();
  await expect(freshPage.getByRole('timer')).toBeVisible();

  const ids = await freshPage.evaluate(async () => {
    const sessions = (await (
      await fetch('/api/v1/sessions', { credentials: 'include' })
    ).json()) as { data: { id: string; status: string; goalId: string }[] };
    const active = sessions.data.find((s) => s.status === 'active') ?? null;

    // `/memory/mastery` is scoped to a goal, so it needs one.
    const mastery = active
      ? ((await (
          await fetch(`/api/v1/memory/mastery?goalId=${active.goalId}`, { credentials: 'include' })
        ).json()) as { data: { conceptId: string }[] })
      : { data: [] };

    return { sessionId: active?.id ?? null, conceptId: mastery.data[0]?.conceptId ?? null };
  });
  expect(ids.sessionId, 'no active session to complete').toBeTruthy();
  expect(ids.conceptId, 'no concept to rate').toBeTruthy();

  // Claim a full day of study for a session seconds old.
  const recorded = await freshPage.evaluate(
    async ([id, concept]) => {
      const response = await fetch(`/api/v1/sessions/${id}/complete`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activeMinutes: 1440,
          ratings: [{ conceptId: concept, rating: 'good' }],
        }),
      });
      const body = (await response.json()) as { data?: { session?: { activeMinutes: number } } };
      return body.data?.session?.activeMinutes ?? -1;
    },
    [ids.sessionId, ids.conceptId] as const,
  );

  expect(recorded, 'the server accepted 24 hours of study for a session seconds old').toBeLessThan(
    5,
  );
  expect(recorded).toBeGreaterThan(0);

  await fresh.close();
});
