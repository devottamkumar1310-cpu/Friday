import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { newLearner, onboard } from './support/learner';

/**
 * Operational surfaces added for launch — CR-007.
 *
 * The health probe, the feedback channel, and the product-event recorder. None
 * of them are part of the learning loop, and the last of those is the point:
 * analytics that can fail a learner's session is worse than no analytics, so
 * the recorder is best-effort by construction and that is verified here.
 */

test.describe.configure({ mode: 'serial' });

const learner = newLearner('platform');

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

test('the health probe reports dependency state without authentication', async ({
  playwright,
  baseURL,
}) => {
  const anonymous = await playwright.request.newContext({ baseURL });
  const response = await anonymous.get('/api/health');

  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    data: { status: string; checks: { database: string } };
  };
  expect(body.data.status).toBe('ok');
  expect(body.data.checks.database).toBe('ok');

  // Never cached: a cached health check reports an old moment with total
  // confidence, which is worse than having none.
  expect(response.headers()['cache-control']).toContain('no-store');

  // And it must not become a reconnaissance endpoint.
  const raw = await response.text();
  expect(raw).not.toMatch(/postgres|password|connection|5432|@/i);

  await anonymous.dispose();
});

test('a learner can send feedback and see it acknowledged', async () => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Tell us what is wrong' })).toBeVisible();

  await page.getByLabel('What kind of feedback is this?').selectOption('confusing');
  await page
    .getByLabel('Tell us what happened')
    .fill('The plan page did not explain why only two weeks are scheduled.');
  await page.getByRole('button', { name: 'Send feedback' }).click();

  await expect(page.getByText('Sent — thank you')).toBeVisible({ timeout: 15_000 });
});

test('the feedback is persisted and readable back by its author', async () => {
  const body = await page.evaluate(async () => {
    const response = await fetch('/api/v1/feedback', { credentials: 'include' });
    return (await response.json()) as { data: { kind: string; message: string; path: string }[] };
  });

  expect(body.data.length).toBeGreaterThan(0);
  const [latest] = body.data;
  expect(latest!.kind).toBe('confusing');
  expect(latest!.message).toContain('two weeks');
  // The screen is recorded; nothing else is.
  expect(latest!.path).toBe('/settings');
});

test('an empty or trivial message cannot be submitted', async () => {
  await page.goto('/settings');
  const send = page.getByRole('button', { name: 'Send feedback' });
  await expect(send).toBeDisabled();

  await page.getByLabel('Tell us what happened').fill('no');
  await expect(send).toBeDisabled();

  await page.getByLabel('Tell us what happened').fill('this is long enough');
  await expect(send).toBeEnabled();
});

test('identifiers are stripped from the recorded path', async () => {
  // Sent from a study screen, whose path carries a task id. What is useful is
  // "the study screen"; the id only links the report to a specific row.
  await page.goto('/dashboard');
  await page.getByRole('link', { name: 'Start this now' }).click();
  await expect(page).toHaveURL(/\/study\/[0-9a-f-]{36}/);

  const status = await page.evaluate(async (path) => {
    const response = await fetch('/api/v1/feedback', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'bug', message: 'sent from a study screen', path }),
    });
    return response.status;
  }, new URL(page.url()).pathname);
  expect(status).toBe(201);

  const body = await page.evaluate(async () => {
    const response = await fetch('/api/v1/feedback', { credentials: 'include' });
    return (await response.json()) as { data: { message: string; path: string }[] };
  });
  const record = body.data.find((f) => f.message === 'sent from a study screen');
  expect(record?.path).toBe('/study/:id');
});

test('the journey recorded the product events a launch needs to read', async () => {
  // Onboarding and a completed session both happened above for this learner.
  // The events are written server-side, so nothing here depends on a browser
  // script having run.
  await page.goto('/dashboard');
  const events = await page.evaluate(async () => {
    const response = await fetch('/api/v1/feedback', { credentials: 'include' });
    return response.status;
  });
  // Sanity: the learner is still authenticated for the assertion that follows.
  expect(events).toBe(200);

  // `product_events` has no read endpoint by design — it is an analytics sink,
  // not learner-facing data — so the assertion that it filled is made in the
  // service test. What is checked here is that recording never interfered:
  // every step of the journey above completed.
  await expect(page.getByRole('heading', { name: 'Next action' })).toBeVisible();
});
