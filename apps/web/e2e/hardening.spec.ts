import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { newLearner, onboard } from './support/learner';

/**
 * Finalisation checks: theme, account deletion, rate limiting.
 *
 * All three existed in some form before this pass and two of them did not
 * work. The theme control saved a preference the product then ignored; the
 * rate limiter was wired but never exercised. Assertions here are about
 * observable behaviour, not about the code being present.
 */

test.describe('theme', () => {
  test('the toggle switches the palette and survives a reload', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await onboard(page, newLearner('theme'));

    const isDark = () => page.evaluate(() => document.documentElement.classList.contains('dark'));
    const before = await isDark();

    await page.getByRole('button', { name: /Switch to (light|dark)/ }).click();
    expect(await isDark()).toBe(!before);

    // The whole point: it was never persisted before, so a reload reverted it.
    await page.reload();
    expect(await isDark(), 'the theme did not survive a reload').toBe(!before);

    // And the pre-paint script means no flash — the class is present in the
    // very first frame rather than applied after hydration.
    const stored = await page.evaluate(() => window.localStorage.getItem('friday-theme'));
    expect(stored).toBe(before ? 'light' : 'dark');

    await context.close();
  });

  test('text stays readable in dark mode', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await onboard(page, newLearner('theme-contrast'));

    await page.getByRole('button', { name: /Switch to dark/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // A dark class with a light background means the tokens did not switch.
    const { bg, fg } = await page.evaluate(() => {
      const s = getComputedStyle(document.body);
      return { bg: s.backgroundColor, fg: s.color };
    });

    /**
     * Lightness, 0..1.
     *
     * The design tokens are authored in `oklch()`, and browsers now return
     * computed colours in the same space rather than converting to `rgb()`.
     * An rgb-only parser reads every one of them as black, which is how this
     * test first "failed" against a perfectly correct dark theme.
     */
    const lightness = (colour: string): number => {
      const oklch = /oklch\(\s*([\d.]+)/.exec(colour);
      if (oklch) return Number(oklch[1]);
      const rgb = /(\d+),\s*(\d+),\s*(\d+)/.exec(colour);
      if (!rgb) throw new Error(`unparseable colour: ${colour}`);
      const [r, g, b] = rgb.slice(1).map(Number) as [number, number, number];
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };

    expect(lightness(bg), `dark mode background is light: ${bg}`).toBeLessThan(0.5);
    expect(lightness(fg), `dark mode text is dark: ${fg}`).toBeGreaterThan(0.5);

    await context.close();
  });
});

test.describe('account deletion', () => {
  let context: BrowserContext;
  let page: Page;
  const learner = newLearner('delete');

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await onboard(page, learner);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('the control is reachable and asks before doing anything', async () => {
    await page.goto('/settings');
    const trigger = page.getByRole('button', { name: /Delete (my )?account/i }).first();
    await expect(trigger).toBeVisible();
    await trigger.click();

    // A destructive, irreversible action must not happen on one tap.
    await expect(
      page.getByText(/permanent|cannot be undone|delete your account/i).first(),
    ).toBeVisible();
  });

  test('deleting signs the learner out and kills the session server-side', async () => {
    // Whatever the confirm control is called, it is the destructive one.
    const confirm = page
      .getByRole('button', { name: /^(Delete|Delete account|Yes, delete)/i })
      .last();
    await confirm.click();

    await expect(page).toHaveURL(/\/(sign-in)?$/, { timeout: 30_000 });

    // The token must be dead, not merely discarded by the browser.
    const status = await page.evaluate(async () => {
      const response = await fetch('/api/v1/me', { credentials: 'include' });
      return response.status;
    });
    expect(status, 'the session survived account deletion').toBe(401);
  });

  test('the deleted account can no longer sign in', async () => {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(learner.email);
    await page.getByLabel('Password').fill(learner.password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText(/Incorrect email or password/i)).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe('rate limiting', () => {
  test('repeated sign-in attempts are throttled', async ({ playwright, baseURL }) => {
    const client = await playwright.request.newContext({ baseURL });

    // Deliberately far past the configured ceiling for this route.
    const statuses: number[] = [];
    for (let i = 0; i < 26; i += 1) {
      const response = await client.post('/api/v1/auth/sign-in', {
        data: { email: `throttle-${i}@example.test`, password: 'wrong-but-well-formed' },
        headers: { origin: baseURL!, 'x-forwarded-for': '203.0.113.77' },
      });
      statuses.push(response.status());
    }

    expect(
      statuses.filter((s) => s === 429).length,
      `no request was throttled: ${statuses.join(',')}`,
    ).toBeGreaterThan(0);

    // And it must be the *later* ones — throttling from the first attempt
    // would lock out honest learners who mistype once.
    expect(statuses[0]).not.toBe(429);

    await client.dispose();
  });
});
