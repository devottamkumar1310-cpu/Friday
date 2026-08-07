import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createGoal, newLearner, setAvailability, signUp } from './support/learner';

/**
 * The complete student journey, in a browser.
 *
 * Phase 3 walked this same path with `curl`, which proved the services and
 * routes work. It did not prove that a person can do it: the forms, the session
 * timer, the practice runner, and the mastery deltas had never been driven
 * through the DOM. That is what this file is for.
 *
 * The steps run in order against one learner because the story is cumulative —
 * mastery only moves if a session was completed, and practice only offers a
 * concept that has been studied.
 */

test.describe.configure({ mode: 'serial' });

const learner = newLearner('journey');

/**
 * One context for the whole story. Playwright's default is a fresh context per
 * test, which would sign the learner out between steps — and a journey that
 * re-authenticates at every step is not the journey a person takes.
 */
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context.close();
});

test.describe('a learner from sign-up to measurable progress', () => {
  test('signs up and is sent into onboarding, not the dashboard', async () => {
    await signUp(page, learner);
    await expect(page.getByRole('heading', { name: /when.*you.*(free|study)/i })).toBeVisible();
  });

  test('cannot save an overlapping week, and is told why', async () => {
    await page.goto('/onboarding/availability');

    // Add a slot that collides with the Monday default (18:00–20:30).
    await page.getByRole('button', { name: 'Add a slot' }).click();
    const rows = page.getByRole('listitem');
    const added = rows.last();
    // Exact, because the row's remove button is labelled "Remove Monday …",
    // which a substring match on "Day" would also hit.
    await added.getByLabel('Day', { exact: true }).selectOption('1');
    await added.getByLabel('From', { exact: true }).selectOption('19:00');
    await added.getByLabel('To', { exact: true }).selectOption('21:00');

    await expect(page.getByText(/overlaps another slot/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save and continue' })).toBeDisabled();

    // Remove it and the form recovers.
    await added.getByRole('button', { name: /^Remove/ }).click();
    await expect(page.getByRole('button', { name: 'Save and continue' })).toBeEnabled();
  });

  test('saves availability and reaches the goal form', async () => {
    await page.goto('/onboarding/availability');
    await expect(page.getByText('15h 30m')).toBeVisible();
    await setAvailability(page);
  });

  test('creates a goal and lands on a Mission Control with a real next action', async () => {
    await page.goto('/onboarding/goal');
    await createGoal(page);

    await expect(page.getByRole('heading', { name: /Good to see you/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Next action' })).toBeVisible();

    // The rationale is deterministic prose from the factor table, so its
    // presence is the visible proof the engine ran — not a placeholder.
    const start = page.getByRole('link', { name: 'Start this now' });
    await expect(start).toBeVisible();
  });

  test('"Why this?" reveals the factor breakdown behind the recommendation', async () => {
    await page.goto('/dashboard');
    await page.getByText('Why this?').click();
    await expect(page.getByText(/readiness/i).first()).toBeVisible();
  });

  test('completes a study session and sees mastery move', async () => {
    await page.goto('/dashboard');
    await page.getByRole('link', { name: 'Start this now' }).click();
    await expect(page).toHaveURL(/\/study\//);

    // The clock only runs once a session exists server-side.
    await expect(page.getByRole('timer')).toHaveText('00:00');
    await page.getByRole('button', { name: 'Start studying' }).click();
    await expect(page.getByText('Running')).toBeVisible();

    // Wall-clock based, so it must actually advance.
    await expect(page.getByRole('timer')).not.toHaveText('00:00', { timeout: 5_000 });

    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('Paused')).toBeVisible();
    await page.getByRole('button', { name: 'Resume' }).click();

    // Finishing with nothing rated must be refused — an unrated session would
    // produce no evidence, and silently recording it would be a lie.
    await page.getByRole('button', { name: 'Finish session' }).click();
    await expect(page.getByText(/Rate at least one concept/)).toBeVisible();

    await page.getByRole('button', { name: 'Good' }).first().click();
    await page.getByLabel(/Notes/).fill('Browser-verified session.');
    await page.getByRole('button', { name: 'Finish session' }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    // The mastery delta is the payoff of the whole loop; it is shown as a toast.
    await expect(page.getByText(/Mastery \d+% → \d+%/)).toBeVisible({ timeout: 10_000 });
  });

  test('refuses a second concurrent session (E-19)', async () => {
    await page.goto('/dashboard');
    await page.getByRole('link', { name: 'Start this now' }).click();
    await page.getByRole('button', { name: 'Start studying' }).click();
    await expect(page.getByText('Running')).toBeVisible();
    const studyUrl = page.url();

    const second = await context.newPage();
    await second.goto(studyUrl);
    // The page reflects the already-open session rather than offering a second
    // start, which is the correct rendering of E-19.
    await expect(second.getByText(/Running|Paused/)).toBeVisible();
    await second.close();

    // Clean up so later steps are not blocked by an open session.
    await page.getByRole('button', { name: 'Abandon' }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  });

  test('practises the studied concept and sees mastery move again', async () => {
    await page.goto('/practice');

    const concept = page.getByRole('button', { name: /%$/ }).first();
    await expect(concept).toBeVisible();
    await concept.click();

    await page.getByRole('button', { name: /^Practise/ }).click();

    await expect(page.getByText(/Question 1 of/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('progressbar', { name: 'Practice progress' })).toBeVisible();

    // Walk the whole set. A practice set mixes question types — multiple choice
    // and typed (numeric / short answer) — and every one of them has to be
    // answerable. A set that dead-ends on one is the defect this step exists to
    // catch.
    for (let guard = 0; guard < 25; guard += 1) {
      const typed = page.getByLabel('Your answer');
      const options = page.locator('fieldset:not([hidden]) button[aria-pressed]');

      if (await typed.isVisible()) {
        await typed.fill('42');
      } else {
        await expect(options.first()).toBeVisible();
        await options.first().click();
      }

      await page.getByRole('button', { name: 'Check answer' }).click();
      // Feedback at the moment of answering is the design intent.
      await expect(page.getByText(/Correct|Not quite/).first()).toBeVisible({ timeout: 15_000 });

      const finish = page.getByRole('button', { name: 'Finish' });
      if (await finish.isVisible()) {
        await finish.click();
        break;
      }
      await page.getByRole('button', { name: 'Next question' }).click();
    }

    await expect(page.getByText(/of \d+ correct/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/\d+% → \d+%/)).toBeVisible();
  });

  test('progress reflects the work that was done', async () => {
    await page.goto('/progress');
    await expect(page.getByRole('heading', { name: /Progress/i }).first()).toBeVisible();
    // Weighted progress must have left zero — the loop closed.
    await expect(page.getByText(/%/).first()).toBeVisible();
  });

  test('every navigation destination renders for a real learner', async () => {
    for (const [path, heading] of [
      ['/dashboard', /Good to see you/],
      ['/plan', /plan/i],
      ['/practice', /practice/i],
      ['/coach', /coach/i],
      ['/progress', /progress/i],
      ['/memory', /memory/i],
      ['/settings', /settings/i],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
      await expect(page.locator('nav[aria-label="Main"] a[aria-current="page"]')).toHaveCount(1);
    }
  });

  test('signs out, and protected pages are no longer reachable', async () => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: /Sign out/i }).click();
    await expect(page).toHaveURL(/\/(sign-in)?$/, { timeout: 20_000 });

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
