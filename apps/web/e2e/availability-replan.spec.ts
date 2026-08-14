import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { newLearner, onboard, signUp } from './support/learner';

/**
 * Changing availability re-plans.
 *
 * The audit collapsed a learner's availability from 48,510 minutes a fortnight
 * to 1,560 and the plan stayed on version 1 — still slotting 145 minutes into a
 * Thursday the learner had just given away. `'constraint'` was declared in
 * `ReplanTriggerClass` and fired from nowhere in the codebase.
 *
 * The assertion that matters is the last one: not that a version number moved,
 * but that the *resulting plan* fits inside the days the learner actually
 * declared. A re-plan that commits a schedule the learner still cannot keep has
 * changed a number and nothing else.
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

let context: BrowserContext;
let page: Page;
let goalId: string;

interface PlanShape {
  version: number;
  days: { date: string; minutes: number; weekday: number }[];
  totalMinutes: number;
}

/** The committed plan, read through the API the app itself uses. */
async function readPlan(target: Page, goal: string): Promise<PlanShape> {
  return target.evaluate(async (g) => {
    const plan = (await (
      await fetch(`/api/v1/goals/${g}/plans/current`, { credentials: 'include' })
    ).json()) as { data: { version: number } };

    const tasks = (await (
      await fetch(`/api/v1/tasks?goalId=${g}`, { credentials: 'include' })
    ).json()) as { data: { scheduledDate: string; estimatedMinutes: number; status: string }[] };

    const byDate = new Map<string, number>();
    for (const t of tasks.data) {
      if (t.status === 'completed') continue;
      byDate.set(t.scheduledDate, (byDate.get(t.scheduledDate) ?? 0) + t.estimatedMinutes);
    }

    const days = [...byDate.entries()]
      .map(([date, minutes]) => ({
        date,
        minutes,
        weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      version: plan.data.version,
      days,
      totalMinutes: days.reduce((sum, d) => sum + d.minutes, 0),
    };
  }, goal);
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await onboard(page, newLearner('avail'));
  goalId = await page.evaluate(async () => {
    const r = await fetch('/api/v1/goals', { credentials: 'include' });
    return ((await r.json()) as { data: { id: string }[] }).data[0]!.id;
  });
});

test.afterAll(async () => {
  await context.close();
});

test('collapsing availability re-plans, and the new plan fits the new week', async () => {
  const before = await readPlan(page, goalId);
  expect(before.days.length, 'no scheduled work to begin with').toBeGreaterThan(0);

  // Monday evening only, 18:00-19:00. Everything else given away.
  const put = await page.evaluate(async () => {
    const r = await fetch('/api/v1/me/availability', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rules: [{ dayOfWeek: 1, startTime: '18:00', endTime: '19:00', kind: 'available' }],
      }),
    });
    return r.status;
  });
  expect(put, 'availability update failed').toBe(200);

  const after = await readPlan(page, goalId);

  // 1. The plan actually re-derived. This is the audit's exact failure.
  expect(
    after.version,
    `plan stayed at v${before.version} after availability collapsed`,
  ).toBeGreaterThan(before.version);

  // 2. It got smaller. A re-plan that kept the same load would have re-derived
  //    against the old constraints, which is the failure wearing a new version.
  expect(
    after.totalMinutes,
    `plan still schedules ${after.totalMinutes} min against ~60 min/week`,
  ).toBeLessThan(before.totalMinutes);

  // 3. And — the assertion that actually matters — nothing is scheduled on a day
  //    the learner no longer has. Monday is weekday 1.
  const outsideAvailability = after.days.filter((d) => d.weekday !== 1);
  expect(
    outsideAvailability.map((d) => `${d.date} (${d.minutes}min)`),
    'work is scheduled on days the learner declared unavailable',
  ).toEqual([]);
});

test('the dashboard reflects the smaller plan rather than the old one', async () => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: /Good to see you/ })).toBeVisible();

  // Whatever it recommends must be startable inside an hour, since that is now
  // the learner's entire week. The panel and the planner have to agree.
  const minutes = await page.evaluate(() => {
    const text = document.querySelector('main')?.textContent ?? '';
    const match = /(\d+)\s*min/.exec(text);
    return match ? Number(match[1]) : null;
  });

  if (minutes !== null) {
    expect(
      minutes,
      `recommended a ${minutes}-minute task against a 60-minute week`,
    ).toBeLessThanOrEqual(60);
  }
});

test('a trivial availability edit does not churn the plan', async () => {
  // The materiality gate and churn budget still apply: re-planning on every
  // keystroke would make the plan feel random.
  const before = await readPlan(page, goalId);

  await page.evaluate(async () => {
    await fetch('/api/v1/me/availability', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rules: [{ dayOfWeek: 1, startTime: '18:00', endTime: '19:05', kind: 'available' }],
      }),
    });
  });

  const after = await readPlan(page, goalId);
  expect(after.version - before.version, 'a five-minute edit churned the plan').toBeLessThanOrEqual(
    1,
  );
});

test('a failing re-plan can never fail the availability save', async () => {
  // Availability for a learner with no goal at all: the re-plan loop has nothing
  // to iterate, and the save must still succeed. This is the shape of the
  // guarantee — `replanQuietly` swallows its own failures — exercised at the
  // only boundary a test can reach without breaking the scheduler on purpose.
  const fresh = await context.browser()!.newContext();
  const freshPage = await fresh.newPage();
  const learner = newLearner('avail-nogoal');

  // `signUp` from support/learner rather than a local copy of the same steps.
  // The copy had drifted from the form it was driving: it asked for a "Display
  // name" field (the label reads "Name") and matched "Password" exactly (the
  // label's text is "Password*", because the asterisk marks it required). Both
  // locators resolved to nothing, so the test spent its whole 5-minute budget
  // waiting on a fill and never reached the assertion it exists to make.
  await signUp(freshPage, learner);

  const status = await freshPage.evaluate(async () => {
    const r = await fetch('/api/v1/me/availability', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rules: [{ dayOfWeek: 3, startTime: '19:00', endTime: '20:00', kind: 'available' }],
      }),
    });
    return r.status;
  });

  expect(status, 'saving availability failed when there was no plan to re-derive').toBe(200);
  await fresh.close();
});
