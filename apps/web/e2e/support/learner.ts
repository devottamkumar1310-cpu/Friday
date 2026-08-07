import { expect, type Page } from '@playwright/test';

/**
 * Shared journey steps.
 *
 * Every spec provisions its own learner rather than sharing one, so files stay
 * independent and a failure in one cannot cascade. Sign-up goes through the
 * real form — the point of this suite is that the components work, so nothing
 * here reaches around the UI to seed state.
 */

export interface Learner {
  email: string;
  password: string;
  displayName: string;
}

let counter = 0;

export function newLearner(tag: string): Learner {
  counter += 1;
  return {
    // Unique per run so reruns never collide with a previous run's rows.
    email: `e2e-${tag}-${Date.now()}-${counter}@example.test`,
    password: 'correct-horse-battery-staple',
    displayName: `E2E ${tag}`,
  };
}

/** An adult date of birth, so the guardian-consent gate (FR-1.6) is not in play. */
function adultDateOfBirth(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 24);
  return d.toISOString().slice(0, 10);
}

export async function signUp(page: Page, learner: Learner): Promise<void> {
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill(learner.displayName);
  await page.getByLabel('Email').fill(learner.email);
  await page.getByLabel('Password').fill(learner.password);
  await page.getByLabel('Date of birth').fill(adultDateOfBirth());
  await page.getByRole('button', { name: 'Create account' }).click();

  // A brand-new learner has no availability, so the dashboard bounces them into
  // onboarding. Landing anywhere else means the gate is broken.
  await expect(page).toHaveURL(/\/onboarding\/availability/, { timeout: 20_000 });
}

export async function setAvailability(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Save and continue' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/\/onboarding\/goal/, { timeout: 20_000 });
}

export async function createGoal(page: Page, title = 'JEE Advanced 2027'): Promise<void> {
  await page.getByLabel('What are you working towards?').fill(title);
  await page.getByRole('button', { name: /Create goal and build my plan/i }).click();

  // Curriculum generation, feasibility, and the first plan all happen here.
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
}

/** Sign up → availability → goal → a dashboard with a real plan behind it. */
export async function onboard(page: Page, learner: Learner): Promise<void> {
  await signUp(page, learner);
  await setAvailability(page);
  await createGoal(page);
}
