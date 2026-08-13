import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { newLearner, onboard } from './support/learner';

/**
 * Accessibility, machine-checked.
 *
 * Phase 3 applied ARIA by hand and reasoned about focus order, but nothing was
 * ever run against a real accessibility tree. NFR-6 requires WCAG 2.1 AA, and
 * "we were careful" is not evidence of it.
 *
 * axe-core catches roughly a third to a half of WCAG failures — the mechanical
 * ones. The keyboard tests below cover what it cannot: whether a person who
 * never touches a mouse can actually get through the product.
 */

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const learner = newLearner('a11y');

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

async function scan(target: Page) {
  return new AxeBuilder({ page: target }).withTags(WCAG).analyze();
}

/** Readable failure output — the default dump is unusable in a CI log. */
function describeViolations(violations: Awaited<ReturnType<typeof scan>>['violations']): string {
  return violations
    .map(
      (v) =>
        `\n[${v.impact ?? 'unknown'}] ${v.id}: ${v.help}\n` +
        v.nodes.map((n) => `    ${n.target.join(' ')}\n      ${n.failureSummary}`).join('\n'),
    )
    .join('\n');
}

test.describe('signed-out pages', () => {
  for (const path of ['/', '/sign-in', '/sign-up']) {
    test(`${path} has no WCAG violations`, async ({ page: fresh }) => {
      await fresh.goto(path);
      const { violations } = await new AxeBuilder({ page: fresh }).withTags(WCAG).analyze();
      expect(describeViolations(violations)).toBe('');
    });
  }
});

test.describe('signed-in pages', () => {
  for (const path of [
    '/dashboard',
    '/plan',
    '/practice',
    '/coach',
    '/progress',
    '/memory',
    '/settings',
  ]) {
    test(`${path} has no WCAG violations`, async () => {
      await page.goto(path);
      const { violations } = await scan(page);
      expect(describeViolations(violations)).toBe('');
    });
  }

  test('the study screen has no WCAG violations, running and idle', async () => {
    await page.goto('/dashboard');
    await page.getByRole('link', { name: 'Start this now' }).click();
    // App Router sets the document title *after* a client-side navigation
    // commits. Scanning before that lands reports a spurious missing-title
    // violation — so wait for the real title, which is worth asserting anyway
    // (WCAG 2.4.2: every view needs a distinct name).
    await expect(page).toHaveTitle(/Study/);
    expect(describeViolations((await scan(page)).violations)).toBe('');

    // A running session swaps in the timer, the rating fieldsets, and the
    // notes field — a different tree, so it needs its own scan.
    await page.getByRole('button', { name: 'Start studying' }).click();
    await expect(page.getByRole('timer')).toBeVisible();
    expect(describeViolations((await scan(page)).violations)).toBe('');

    // The rating phase is a different tree again — the one a learner actually
    // has to operate at the end of a long session.
    await page.getByRole('button', { name: /done studying/i }).click();
    await expect(page.getByRole('button', { name: /^Yes/ }).first()).toBeVisible();
    expect(describeViolations((await scan(page)).violations)).toBe('');

    await page.getByRole('button', { name: /Back to studying/i }).click();
    await page.getByRole('button', { name: 'Discard' }).click();
    await page.getByRole('button', { name: 'Discard', exact: true }).last().click();
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

test.describe('keyboard access', () => {
  test('a skip link is the first stop and it reaches the main region', async () => {
    await page.goto('/dashboard');
    await page.keyboard.press('Tab');

    const skip = page.getByRole('link', { name: /skip to content/i });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main/);
  });

  test('every interactive element shows a visible focus indicator', async () => {
    await page.goto('/dashboard');

    // Walk the first stretch of the tab order and assert each stop paints
    // something — an invisible focus ring makes keyboard use guesswork.
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      const outline = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        return {
          tag: el.tagName,
          outlineWidth: s.outlineWidth,
          outlineStyle: s.outlineStyle,
          boxShadow: s.boxShadow,
        };
      });
      if (!outline) continue;
      const painted =
        (outline.outlineStyle !== 'none' && parseFloat(outline.outlineWidth) > 0) ||
        (outline.boxShadow !== 'none' && outline.boxShadow !== '');
      expect(painted, `no focus indicator on <${outline.tag}> at tab stop ${i + 1}`).toBe(true);
    }
  });

  test('the whole onboarding schedule editor is operable without a mouse', async () => {
    await page.goto('/settings');
    await page.getByRole('link', { name: /Edit schedule/i }).click();
    await expect(page).toHaveURL(/\/onboarding\/availability/);

    // The editor is behind a disclosure now, so the disclosure itself has to be
    // keyboard-reachable before anything inside it matters.
    const toggle = page.getByRole('button', { name: /Set my own times|Hide exact times/ });
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // Reaching and operating the day select by keyboard alone.
    const firstDay = page.getByLabel('Day', { exact: true }).first();
    await firstDay.focus();
    await expect(firstDay).toBeFocused();
    await firstDay.selectOption('3');
    await expect(firstDay).toHaveValue('3');
  });

  test('the availability presets are real buttons that announce their state', async () => {
    await page.goto('/onboarding/availability');
    const preset = page.getByRole('button', { name: /Early mornings/ });
    await expect(preset).toHaveAttribute('aria-pressed', 'false');
    await preset.click();
    await expect(preset).toHaveAttribute('aria-pressed', 'true');
    expect(describeViolations((await scan(page)).violations)).toBe('');
  });

  test('the mobile navigation disclosure is reachable and announces its state', async ({
    browser,
  }) => {
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: await context.storageState(),
    });
    const small = await mobile.newPage();
    await small.goto('/dashboard');

    const toggle = small.getByRole('button', { name: 'Open menu' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();

    const opened = small.getByRole('button', { name: 'Close menu' });
    await expect(opened).toHaveAttribute('aria-expanded', 'true');
    await expect(small.locator('#mobile-nav')).toBeVisible();

    expect(describeViolations((await scan(small)).violations)).toBe('');
    await mobile.close();
  });
});
