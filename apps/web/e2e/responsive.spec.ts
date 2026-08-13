import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { newLearner, onboard } from './support/learner';

/**
 * Responsive behaviour, measured rather than assumed.
 *
 * Phase 3 wrote the breakpoint classes and reasoned about how they would
 * behave. Nothing was ever rendered at a real viewport. The checks here are the
 * ones that actually break products on phones: content wider than the screen,
 * tap targets too small to hit, and navigation that disappears without a
 * replacement.
 *
 * 320px is included deliberately — it is the narrowest viewport WCAG 1.4.10
 * (Reflow) requires, and the width where a fixed-width table or a long unbroken
 * string shows up.
 */

const VIEWPORTS = [
  { name: '320px — smallest supported phone', width: 320, height: 800 },
  { name: '390px — iPhone class', width: 390, height: 844 },
  { name: '768px — tablet, the sm/md boundary', width: 768, height: 1024 },
  { name: '1280px — desktop', width: 1280, height: 800 },
];

const PAGES = ['/dashboard', '/plan', '/practice', '/coach', '/progress', '/memory', '/settings'];

const learner = newLearner('responsive');

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

/** How far the document scrolls sideways. Anything above zero is a defect. */
async function horizontalOverflow(target: Page): Promise<number> {
  return target.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** The element responsible for an overflow, so a failure names its own cause. */
async function widestOffender(target: Page): Promise<string> {
  return target.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    let worst = '';
    let worstRight = limit;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > worstRight + 0.5) {
        worstRight = r.right;
        worst = `<${el.tagName.toLowerCase()} class="${el.className}"> right=${Math.round(r.right)} limit=${limit}`;
      }
    }
    return worst;
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const path of PAGES) {
      test(`${path} does not scroll sideways`, async () => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(path);
        // Wait for real content. Measuring immediately catches the loading
        // skeleton instead of the page — which is how the skeleton's own
        // overflow was found, but it means the loaded page goes unchecked.
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        const overflow = await horizontalOverflow(page);
        expect(
          overflow,
          `overflows by ${overflow}px — ${await widestOffender(page)}`,
        ).toBeLessThanOrEqual(0);
      });
    }
  });
}

test.describe('the loading state', () => {
  test('the skeleton itself fits at 320px', async () => {
    // Regression: the app-shell skeleton used fixed `w-80` placeholders, which
    // are wider than a 320px content column. Every page scrolled sideways for
    // as long as it showed — a real jolt on a phone, and invisible to any test
    // that waits for content before measuring.
    const fresh = await context.newPage();
    await fresh.setViewportSize({ width: 320, height: 800 });
    await fresh.goto('/settings');

    // Hold the skeleton open by stalling the RSC payload for the next segment.
    // Delaying the *document* instead would just leave the old page on screen,
    // and the skeleton would never render at all.
    await fresh.route(/_rsc=/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      await route.continue();
    });

    // At 320px the destinations live behind the disclosure.
    await fresh.getByRole('button', { name: 'Open menu' }).click();
    await fresh.locator('#mobile-nav').getByRole('link', { name: 'Mission Control' }).click();
    await expect(fresh.getByText('Loading')).toBeAttached();
    expect(await horizontalOverflow(fresh)).toBeLessThanOrEqual(0);

    await fresh.unroute(/_rsc=/);
    await fresh.close();
  });
});

test.describe('navigation adapts to the viewport', () => {
  test('below sm the links collapse into a disclosure, and above it they do not', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Mission Control' })).toBeHidden();

    // Opening it must expose every destination — a collapsed menu that drops
    // links is worse than no menu.
    await page.getByRole('button', { name: 'Open menu' }).click();
    for (const label of [
      'Mission Control',
      'Plan',
      'Practice',
      'Coach',
      'Progress',
      'Memory',
      'Settings',
    ]) {
      await expect(page.locator('#mobile-nav').getByRole('link', { name: label })).toBeVisible();
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole('button', { name: /Open menu/ })).toBeHidden();
    await expect(page.getByRole('link', { name: 'Mission Control' })).toBeVisible();
  });
});

test.describe('the study screen on a phone', () => {
  test('the timer stays visible while rating, and tap targets are big enough', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard');
    await page.getByRole('link', { name: 'Start this now' }).click();
    await page.getByRole('button', { name: 'Start studying' }).click();
    await expect(page.getByRole('timer')).toBeVisible();
    await page.getByRole('button', { name: /done studying/i }).click();

    // WCAG 2.2 AA (2.5.8) sets the floor at 24×24 CSS px. These are the
    // controls a learner uses at the end of a session, one-handed.
    const ratings = page.getByRole('button', { name: /^Yes/ });
    // `count()` does not auto-wait, so it has to follow an assertion that does —
    // otherwise it races the concept list's first render and reports zero.
    await expect(ratings.first()).toBeVisible();
    const count = await ratings.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const box = await ratings.nth(i).boundingBox();
      expect(box, 'rating button has no box').not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(24);
      expect(box!.height).toBeGreaterThanOrEqual(24);
    }

    // The timer is the one thing that must not be pushed off-screen by the
    // rating UI — that is why navigation is a top disclosure, not a bottom bar.
    const timerBox = await page.getByRole('timer').boundingBox();
    expect(timerBox!.y).toBeLessThan(844);

    await page.getByRole('button', { name: /Back to studying/i }).click();
    await page.getByRole('button', { name: 'Discard' }).click();
    await page.getByRole('button', { name: 'Discard', exact: true }).last().click();
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

test.describe('onboarding on a phone', () => {
  test('the schedule editor is usable at 320px', async () => {
    const fresh = await context.newPage();
    await fresh.setViewportSize({ width: 320, height: 800 });
    await fresh.goto('/settings');
    await fresh.getByRole('link', { name: /Edit schedule/i }).click();

    // The presets carry the common path, so they have to be comfortable
    // one-thumb targets before anything else is judged.
    const preset = fresh.getByRole('button', { name: /Evenings after school/ });
    const presetBox = await preset.boundingBox();
    expect(presetBox!.height).toBeGreaterThanOrEqual(44);

    await fresh.getByRole('button', { name: 'Set my own times' }).click();

    // Each row stacks now — day on its own line, then From/To side by side —
    // so every control keeps a usable width even at 320px.
    const day = fresh.getByLabel('Day', { exact: true }).first();
    const box = await day.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(80);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(await horizontalOverflow(fresh)).toBeLessThanOrEqual(0);
    await fresh.close();
  });
});
