import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { newLearner, onboard } from './support/learner';

/**
 * The Live Intelligence Panel.
 *
 * Mission Control used to be a grid of task lists — correct, and indistinguishable
 * from a planner. The panel replaces it with the shape of a decision: what the
 * system noticed, what it changed, and the one thing to do now.
 *
 * The assertion that matters most is the first one. A product that manufactures
 * an insight for a learner on day one is worse than one that says nothing, because
 * the learner has no way to tell the fabricated observation from the real ones that
 * follow. So the engine's refusal to adapt on thin evidence is tested before its
 * ability to adapt at all.
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const learner = newLearner('panel');

let context: BrowserContext;
let page: Page;
let goalId: string;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await onboard(page, learner);
  goalId = await page.evaluate(async () => {
    const response = await fetch('/api/v1/goals', { credentials: 'include' });
    return ((await response.json()) as { data: { id: string }[] }).data[0]!.id;
  });
});

test.afterAll(async () => {
  await context.close();
});

test('a brand-new learner is told the system does not know them yet', async () => {
  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: /Good to see you/ })).toBeVisible();
  await expect(page.getByText(/don't know how you study yet/i)).toBeVisible();

  // And, crucially, that it has therefore changed nothing. The absence of a
  // decision has to be stated; silence here reads as a system with no opinion.
  await expect(page.getByText(/Left your plan exactly as it is/i)).toBeVisible();
});

test('the panel leads with observation, decision, then a single action', async () => {
  const noticed = page.getByText('What I noticed');
  const changed = page.getByText('What I changed');
  const next = page.getByRole('heading', { name: 'Next action' });

  await expect(noticed).toBeVisible();
  await expect(changed).toBeVisible();
  await expect(next).toBeVisible();

  // Order is the argument: a conclusion after its evidence reads as reasoning;
  // the same two facts in the other order read as a status board.
  const [noticedBox, changedBox, nextBox] = await Promise.all([
    noticed.boundingBox(),
    changed.boundingBox(),
    next.boundingBox(),
  ]);
  expect(noticedBox!.y).toBeLessThan(changedBox!.y);
  expect(changedBox!.y).toBeLessThan(nextBox!.y);

  // Exactly one primary call to action on the screen.
  await expect(page.getByRole('link', { name: 'Start this now' })).toHaveCount(1);
});

test('the last thing read before the button is an instruction with a time box', async () => {
  /**
   * The commitment loop. Whatever the panel says above, the sentence directly
   * before the button has to be something the learner can *do*, and it asks for
   * minutes rather than for finishing — a time box is a promise a struggling
   * learner can keep, and "finish this" is the promise they have been breaking.
   */
  // First emphasised paragraph in the region: the action title above it is
  // `font-semibold`, and "Why this one" sits below the button.
  const card = page.getByRole('region', { name: 'Your next action' });
  const directive = card.locator('p.font-medium').first();

  await expect(directive).toBeVisible();
  const text = (await directive.innerText()).trim();

  expect(text, `no time box in the directive: ${text}`).toMatch(/\d+ minutes/);
  expect(
    text.split(/(?<=[.!?])\s+/).filter(Boolean).length,
    `too long: ${text}`,
  ).toBeLessThanOrEqual(2);
  expect(text, `hedged: ${text}`).not.toMatch(/it seems|might want|perhaps|somewhat|try to/i);

  // And it sits below the action title, above the button — nothing between the
  // instruction and the tap.
  const [directiveBox, ctaBox] = await Promise.all([
    directive.boundingBox(),
    page.getByRole('link', { name: 'Start this now' }).boundingBox(),
  ]);
  expect(directiveBox!.y).toBeLessThan(ctaBox!.y);
});

test('once there is evidence, the panel names a real pattern and what it did about it', async () => {
  // Six finished sessions, half of them dropped. Started through the API rather
  // than the UI because what is under test is the reading of the history, not
  // the session screen — which `session-persistence.spec.ts` already covers.
  const outcome = await page.evaluate(async (id) => {
    const post = async (path: string, body?: unknown) => {
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        body: (await response.json()) as { data?: { id?: string }; error?: { message?: string } },
      };
    };

    // A completed session must record at least one rating — the API refuses a
    // completion with no evidence, which is the right rule and means this loop
    // needs a real concept to rate.
    const mastery = (await (
      await fetch(`/api/v1/memory/mastery?goalId=${id}`, { credentials: 'include' })
    ).json()) as { data: { conceptId: string }[] };
    const conceptId = mastery.data[0]?.conceptId;
    if (!conceptId) return 'no concept available to rate';

    for (let i = 0; i < 6; i += 1) {
      const started = await post('/api/v1/sessions', { goalId: id, originatedFrom: 'manual' });
      const sessionId = started.body.data?.id;
      if (!sessionId) {
        return `start ${i} -> ${started.status} ${started.body.error?.message ?? ''}`;
      }

      // Alternating: finished, dropped, finished, dropped...
      const ended =
        i % 2 === 0
          ? await post(`/api/v1/sessions/${sessionId}/complete`, {
              activeMinutes: 18,
              ratings: [{ conceptId, rating: 'good' }],
            })
          : await post(`/api/v1/sessions/${sessionId}/abandon`);

      // A session that did not actually end leaves the next start blocked by
      // E-19, which would otherwise surface as a confusing failure one loop later.
      if (ended.status >= 400) {
        return `end ${i} -> ${ended.status} ${ended.body.error?.message ?? ''}`;
      }
    }
    return 'ok';
  }, goalId);
  expect(outcome).toBe('ok');

  await page.reload();

  // The system no longer pleads ignorance...
  await expect(page.getByText(/don't know how you study yet/i)).toHaveCount(0);

  // ...it makes a claim, and backs it with the arithmetic. Asserting on the
  // presence of a percentage is asserting that the panel cannot become a
  // horoscope: every statement here is checkable by the learner.
  // Asserted on the *shape* of the evidence, not its wording — a percentage and
  // a bounded window. Matching the copy itself would make this a change-detector
  // that fails every time the phrasing improves.
  const panel = page.getByRole('region', { name: 'What FRIDAY is doing' });
  await expect(panel).toContainText(/%/);
  await expect(panel).toContainText(/\d+ of the last \d+ days/i);

  // And a decision that is actually about the workload, not a platitude.
  await expect(panel).toContainText(/minutes|load|plan/i);
});

test('every statement the panel makes carries its evidence', async () => {
  // A claim with no number under it is the failure mode this whole surface is
  // built to avoid, so it is asserted structurally rather than by sampling copy.
  const orphaned = await page.evaluate(() => {
    const region = document.querySelector('[aria-label="What FRIDAY is doing"]');
    if (!region) return ['no panel'];
    return [...region.querySelectorAll('li')]
      .filter((li) => li.querySelectorAll('p').length < 2)
      .map((li) => li.textContent?.trim() ?? '');
  });
  expect(orphaned, 'a statement was rendered with no supporting evidence line').toEqual([]);
});

test('on a phone it is one column with the action reachable', async ({ browser }) => {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phonePage = await phone.newPage();
  await onboard(phonePage, newLearner('panel-mobile'));
  await phonePage.goto('/dashboard');

  // No horizontal overflow: the panel must never be a two-column layout that
  // merely got narrow. ~90% of these learners are on a phone.
  const overflow = await phonePage.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'the page scrolls sideways on a 390px phone').toBeLessThanOrEqual(1);

  // The primary action is on screen without scrolling, because it is pinned.
  const cta = phonePage.getByRole('link', { name: 'Start this now' });
  await expect(cta).toBeVisible();
  const box = await cta.boundingBox();
  expect(box!.y, 'the primary action is below the fold on a phone').toBeLessThan(844);
  expect(box!.height, 'the primary action is under the 44px touch minimum').toBeGreaterThanOrEqual(
    44,
  );

  await phone.close();
});

test('on a phone, deciding to study and being in a session is one tap under 3s', async ({
  browser,
}) => {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phonePage = await phone.newPage();
  await onboard(phonePage, newLearner('panel-speed'));
  await phonePage.goto('/dashboard');

  const cta = phonePage.getByRole('link', { name: 'Start this now' });
  await expect(cta).toBeVisible();

  // One tap, no scrolling, no intermediate screen. The budget is the user's:
  // under three seconds from wanting to study to being able to.
  const started = Date.now();
  await cta.click();
  await expect(phonePage.getByRole('button', { name: 'Start studying' })).toBeVisible();
  const elapsed = Date.now() - started;

  expect(elapsed, `reaching the study screen took ${elapsed}ms`).toBeLessThan(3_000);

  await phone.close();
});
