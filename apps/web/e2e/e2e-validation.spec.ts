import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createGoal, newLearner, setAvailability, signUp } from './support/learner';

test.describe.configure({ mode: 'serial' });
const learner = newLearner('final-validation');
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context.close();
});

test('Completes the final validation flow', async () => {
  // SIGN UP
  await signUp(page, learner);

  // ONBOARDING (Availability)
  await setAvailability(page);

  // CREATE GOAL
  await createGoal(page, 'Learn Quantum Physics');

  // DASHBOARD / MISSION CONTROL
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good to see you|Mission Control/i);

  // Fetch real goal ID from API using browser fetch
  const realGoalId = await page.evaluate(async () => {
    const res = await fetch('/api/v1/goals');
    const json = await res.json();
    return json.data[0].id;
  });
  expect(realGoalId, 'Real goal ID should be captured').toBeDefined();

  // NEXT ACTION & RATIONALE
  const startButton = page.getByRole('button', { name: /Start Session/i });
  await expect(startButton).toBeVisible();

  // TASK EXECUTION
  await startButton.click();
  await expect(page).toHaveURL(/\/study\/.+/);
  
  const completeBtn = page.getByRole('button', { name: /Complete/i });
  if (await completeBtn.isVisible()) {
    await completeBtn.click();
  }

  // ADAPTIVE UPDATE & PROGRESS
  await page.goto('/progress');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/progress/i);

  // Check if there are weak concepts
  const rootCauseLink = page.locator('a[href*="/root-cause"]');
  if (await rootCauseLink.count() > 0) {
    await rootCauseLink.first().click();
    await expect(page).toHaveURL(/\/root-cause/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Why is this concept weak/i);
    await expect(page.locator('text=/Concept/i')).toBeVisible();
  } else {
    // Navigate with real goalId and a fallback weakConceptId just to verify the route doesn't crash
    const dummyConceptId = '00000000-0000-0000-0000-000000000000';
    await page.goto(`/root-cause?goalId=${realGoalId}&weakConceptId=${dummyConceptId}`);
    // Might return 404 or show no evidence if concept doesn't exist, just expect it loads
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Why is this concept weak|Not Found/i);
  }

  // WEEKLY REVIEW
  // We use the real goalId to access the weekly review surface
  await page.goto(`/weekly-review?goalId=${realGoalId}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Your Learning Review/i);
});
