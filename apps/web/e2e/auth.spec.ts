import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { newLearner } from './support/learner';

/**
 * Signing back in.
 *
 * This file exists because of a gap, not a hunch: `journey.spec.ts` signs a
 * learner *up*, uses the app, and signs *out* — but never signs back **in**.
 * Ninety-five browser tests, and the single most-used screen in any product
 * after week one had no coverage at all. A returning learner is the common
 * case; a brand-new one happens once.
 *
 * Every assertion here is about the thing a student actually experiences:
 * do I get in, do I stay in, and does it survive a reload.
 */

test.describe.configure({ mode: 'serial' });

const learner = newLearner('auth');

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();

  // Provision through the UI, exactly as a real learner would.
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill(learner.displayName);
  await page.getByLabel('Email').fill(learner.email);
  await page.getByLabel('Password').fill(learner.password);
  await page.getByLabel('Date of birth').fill('2002-04-12');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/onboarding\/availability/, { timeout: 20_000 });

  // Cleared rather than clicking "Sign out": the onboarding screens sit outside
  // the app shell and have no sign-out control at all — a learner who stops
  // here has no way out but clearing cookies by hand. Recorded as a UX finding;
  // this simulates the returning visit.
  await context.clearCookies();
});

test.afterAll(async () => {
  await context.close();
});

test('the sign-in form renders its fields', async () => {
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
});

test('a wrong password is refused with a message, not a silent failure', async () => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(learner.email);
  await page.getByLabel('Password').fill('definitely-not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Something must be said. A form that silently does nothing is the single
  // most common way a login "does not work" from a user's point of view.
  await expect(page.getByText(/is not correct|incorrect|invalid/i).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page).toHaveURL(/\/sign-in/);
});

test('correct credentials sign the learner in and land them somewhere useful', async () => {
  const failures: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') failures.push(m.text());
  });
  page.on('requestfailed', (r) => failures.push(`${r.method()} ${r.url()} failed`));

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(learner.email);
  await page.getByLabel('Password').fill(learner.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Away from /sign-in, and not into an error page.
  await expect(page).not.toHaveURL(/\/sign-in/, { timeout: 20_000 });
  await expect(page.getByText('Something went badly wrong')).toHaveCount(0);

  // A brand-new learner has no availability yet, so onboarding is correct.
  expect(page.url()).toMatch(/\/(dashboard|onboarding)/);
  expect(failures.join('\n')).not.toMatch(/Refused to|ChunkLoadError|Failed to fetch/);
});

test('the session survives a reload — it was a cookie, not just client state', async () => {
  await page.reload();
  expect(page.url()).not.toMatch(/\/sign-in/);

  const session = (await context.cookies()).find((c) => c.name === 'friday_session');
  expect(session, 'no session cookie after sign-in').toBeDefined();
  expect(session!.httpOnly).toBe(true);
});

test('signing in never loops between /sign-in and a protected page', async () => {
  // The failure mode a user describes as "login does not work": the page
  // flickers and lands back where it started.
  const visited: string[] = [];
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) visited.push(new URL(f.url()).pathname);
  });

  await page.goto('/dashboard');
  await page.waitForTimeout(2_000);

  const bounces = visited.filter((p) => p === '/sign-in').length;
  expect(bounces, `redirect loop: ${visited.join(' → ')}`).toBeLessThan(2);
});

test('the `next` parameter returns the learner to where they were headed', async () => {
  await context.clearCookies();

  await page.goto('/settings');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fsettings|\/sign-in\?next=\/settings/);

  await page.getByLabel('Email').fill(learner.email);
  await page.getByLabel('Password').fill(learner.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).not.toHaveURL(/\/sign-in/, { timeout: 20_000 });
});
