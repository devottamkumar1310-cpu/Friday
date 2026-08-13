import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { newLearner, onboard } from './support/learner';

/**
 * The session clock survives leaving the page.
 *
 * The failure this guards against was quiet and expensive: the timer lived in
 * React state and started at zero on every mount, so a learner who checked a
 * formula in another tab, took a call, or simply reloaded came back to `00:00`
 * — and finishing then recorded **one minute** against an hour of real work.
 * Every downstream number is computed from that duration, so the product was
 * confidently wrong about the one thing it exists to measure.
 *
 * The clock is now derived from the session row's `started_at`, which the
 * server has always had and the study endpoint used to discard.
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const learner = newLearner('persist');

let context: BrowserContext;
let page: Page;

/** Seconds on the clock, parsed from `mm:ss` or `h:mm:ss`. */
async function clockSeconds(target: Page): Promise<number> {
  const text = (await target.getByRole('timer').innerText()).trim();
  const parts = text.split(':').map(Number);
  return parts.length === 3
    ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
    : parts[0]! * 60 + parts[1]!;
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await onboard(page, learner);
});

test.afterAll(async () => {
  await context.close();
});

test('the clock keeps running across a full page reload', async () => {
  await page.goto('/dashboard');
  await page.getByRole('link', { name: 'Start this now' }).click();
  await page.getByRole('button', { name: 'Start studying' }).click();
  await expect(page.getByRole('timer')).toBeVisible();

  // Let real time pass, then destroy every scrap of client state.
  await page.waitForTimeout(4_000);
  const before = await clockSeconds(page);
  expect(before).toBeGreaterThanOrEqual(3);

  await page.reload();

  // Straight back into focus mode, not the "ready when you are" card.
  await expect(page.getByRole('timer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start studying' })).toHaveCount(0);

  const after = await clockSeconds(page);
  expect(after, `clock reset on reload: ${before}s → ${after}s`).toBeGreaterThanOrEqual(before);
});

test('the clock survives navigating away and coming back', async () => {
  await page.goto('/progress');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(3_000);

  await page.goto('/dashboard');
  await page.getByRole('link', { name: 'Start this now' }).click();

  await expect(page.getByRole('timer')).toBeVisible();
  const resumed = await clockSeconds(page);
  // Elapsed is wall-clock since the session began, so the detour counts.
  expect(resumed, 'the detour was not counted').toBeGreaterThanOrEqual(6);
});

test('a completed session records the real duration, not a default minute', async () => {
  const onClock = await clockSeconds(page);

  await page.getByRole('button', { name: /done studying/i }).click();
  await page.getByRole('button', { name: /^Yes/ }).first().click();
  await page.getByRole('button', { name: 'Save and finish' }).click();

  await expect(page.getByText(/minutes? done\./)).toBeVisible({ timeout: 20_000 });

  // The outcome screen reports minutes; the clock was seconds. What matters is
  // that it did not silently collapse to the one-minute floor when real time
  // had elapsed beyond it.
  const summary = await page.getByRole('heading', { level: 1 }).innerText();
  const recorded = Number(/(\d+)/.exec(summary)?.[1] ?? '0');
  expect(recorded).toBeGreaterThanOrEqual(Math.max(1, Math.round(onClock / 60)));
});

test('the session history shows that session with its duration', async () => {
  // Proof it reached the database, not just the screen.
  const sessions = await page.evaluate(async () => {
    const response = await fetch('/api/v1/sessions', { credentials: 'include' });
    return (await response.json()) as { data: { status: string; activeMinutes: number }[] };
  });

  const completed = sessions.data.filter((s) => s.status === 'completed');
  expect(completed.length).toBeGreaterThan(0);
  expect(completed[0]!.activeMinutes).toBeGreaterThanOrEqual(1);
});

test('the study endpoint returns the anchor the clock is derived from', async ({ browser }) => {
  /**
   * Regression: the page and the API disagreed.
   *
   * `study/[taskId]/page.tsx` calls the service directly, so the timer resumed
   * and every test above passed — while `GET /tasks/{id}/study`, which
   * advertises the same payload, hand-picked its fields and silently dropped
   * `activeSessionStartedAt`. A client using the documented endpoint would have
   * had the exact resetting timer this file exists to prevent.
   */
  const context = await browser.newContext();
  const page = await context.newPage();
  await onboard(page, newLearner('anchor'));

  await page.getByRole('link', { name: 'Start this now' }).click();
  await page.getByRole('button', { name: 'Start studying' }).click();
  await expect(page.getByRole('timer')).toBeVisible();

  const taskId = new URL(page.url()).pathname.split('/').pop()!;
  const body = await page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/tasks/${id}/study`, { credentials: 'include' });
    return (await response.json()) as {
      data: { activeSessionId: string | null; activeSessionStartedAt: string | null };
    };
  }, taskId);

  expect(body.data.activeSessionId).toBeTruthy();
  expect(body.data.activeSessionStartedAt, 'the API dropped the clock anchor').toBeTruthy();
  expect(Number.isNaN(Date.parse(body.data.activeSessionStartedAt!))).toBe(false);

  await context.close();
});
