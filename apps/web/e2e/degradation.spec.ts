import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { newLearner, onboard } from './support/learner';

/**
 * NFR-2.2 / E-16, seen from the browser.
 *
 * The architecture's central bet is that the deterministic engine does not
 * depend on the model: if the provider is down, a learner still gets a plan, a
 * next action, and a place to record what they did. Phase 3 proved this at the
 * HTTP layer. What it could not show is what the learner actually *sees* — an
 * honest explanation, or a spinner that never resolves.
 *
 * Run against a server configured with a provider whose calls fail:
 *   AI_PROVIDER=google GOOGLE_API_KEY=invalid-key … next start
 *   E2E_AI_BROKEN=1 npx playwright test degradation.spec.ts
 */

const BROKEN = process.env['E2E_AI_BROKEN'] === '1';

test.skip(!BROKEN, 'set E2E_AI_BROKEN=1 against a server with a failing provider');
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const learner = newLearner('degraded');

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await onboard(page, learner);
});

test.afterAll(async () => {
  await context.close();
});

test('the deterministic loop is untouched by the model being down', async () => {
  // Onboarding already succeeded above, which means curriculum, feasibility,
  // and the first plan were all produced without the model.
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Next action' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start this now' })).toBeVisible();

  await page.goto('/plan');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await page.goto('/progress');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('the coach fails honestly rather than hanging', async () => {
  await page.goto('/coach');
  await page.getByLabel('Message the coach').fill('What should I do next?');
  await page.getByRole('button', { name: 'Send message' }).click();

  // An explanation, naming what is and is not affected — not a dead spinner.
  await expect(page.getByText('Coach unavailable')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/plan, next action, and sessions are unaffected/i)).toBeVisible();

  // And the composer is usable again, so the learner can retry.
  await expect(page.getByLabel('Message the coach')).toBeEnabled();
});

test('a study session still records evidence with the model down', async () => {
  await page.goto('/dashboard');
  await page.getByRole('link', { name: 'Start this now' }).click();
  await page.getByRole('button', { name: 'Start studying' }).click();
  await expect(page.getByText('Running')).toBeVisible();

  await page.getByRole('button', { name: 'Good' }).first().click();
  await page.getByRole('button', { name: 'Finish session' }).click();

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  // Mastery moved. The loop closed with no model involved at any point.
  await expect(page.getByText(/Mastery \d+% → \d+%/)).toBeVisible({ timeout: 15_000 });
});
