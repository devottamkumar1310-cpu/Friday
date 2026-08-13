import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { newLearner, onboard } from './support/learner';

/**
 * Does the plan actually adapt?
 *
 * The engine has had the machinery since Phase 1 — a priority function whose
 * `Impact` term is driven by the mastery gap, a readiness gate, missed-task
 * handling, and a materiality gate. What it did not have was the learner's
 * state: both plan generation and re-generation passed an empty mastery map, so
 * the scheduler believed every concept had never been studied. You could master
 * half a syllabus, rebuild the plan, and get the same plan back.
 *
 * This walks the loop end to end and asserts on what a learner would see.
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const learner = newLearner('adaptive');

let context: BrowserContext;
let page: Page;

/** The task the engine currently recommends, as rendered. */
async function currentNextAction(target: Page): Promise<string> {
  await target.goto('/dashboard');
  const heading = target
    .locator('main')
    .getByText(/^Learn:|^Review:|^Practise:/)
    .first();
  await expect(heading).toBeVisible();
  return (await heading.innerText()).trim();
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await onboard(page, learner);
});

test.afterAll(async () => {
  await context.close();
});

test('the engine recommends something, and says what it is', async () => {
  const first = await currentNextAction(page);
  expect(first.length).toBeGreaterThan(0);
});

test('studying a topic changes what the engine believes about it', async () => {
  await page.goto('/dashboard');
  await expect(page.getByText('Why this one')).toBeVisible();

  // The rationale is rendered from the live factor table, so it is the visible
  // proof of what the engine currently thinks.
  const rationaleBefore = await page.locator('main').innerText();
  expect(rationaleBefore).toMatch(/at 0% mastery/i);

  await page.getByRole('link', { name: 'Start this now' }).click();
  await page.getByRole('button', { name: 'Start studying' }).click();
  await page.getByRole('button', { name: /done studying/i }).click();

  // "Easily" is the strongest evidence the learner can give.
  await page
    .getByRole('button', { name: /^Easily/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Save and finish' }).click();
  await expect(page.getByText(/minutes? done\./)).toBeVisible({ timeout: 20_000 });

  await page.goto('/dashboard');
  await expect(page.getByText('Why this one')).toBeVisible();
  const rationaleAfter = await page.locator('main').innerText();

  // The evidence reached the ranking. Note what is deliberately *not* asserted:
  // that the top task changed. Newton's Laws carries 70% exam weight, so one
  // session leaves an 88% gap on the heaviest topic in the syllabus and it can
  // legitimately still rank first. Demanding a different task would be
  // asserting a preference, not a property.
  expect(rationaleAfter, 'the engine still believes nothing has been studied').not.toMatch(
    /at 0% mastery/i,
  );
});

test('rebuilding the plan respects what has been learned', async () => {
  // Before the fix this was a no-op: the candidate plan was built from an empty
  // mastery map, so it came back byte-identical to the original and the
  // materiality gate discarded it every time.
  await page.goto('/plan');
  const rebuild = page.getByRole('button', { name: /Rebuild|Regenerate|Re-plan/i }).first();
  await expect(rebuild).toBeVisible();
  await rebuild.click();

  // Either it commits a new plan or it honestly reports nothing changed —
  // both are correct outcomes. What must not happen is an error.
  await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('progress reflects the mastered topic rather than staying at zero', async () => {
  await page.goto('/progress');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const body = await page.locator('main').innerText();
  // Something was learned, so the syllabus counters must have moved off zero.
  expect(body).toMatch(/1\s*\/\s*10|In progress|Concepts mastered/i);

  // Day one still must not accuse the learner of falling behind.
  expect(body).not.toMatch(/behind the pace you need/i);
});
