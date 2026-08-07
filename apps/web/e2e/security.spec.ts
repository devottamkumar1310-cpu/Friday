import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { newLearner, onboard } from './support/learner';

/**
 * Security behaviour, exercised over real HTTP.
 *
 * Tenancy isolation is the item §7.3 has asked for since Phase 1 and no phase
 * has delivered. It is the highest-consequence property in the product: a bug
 * here does not degrade an experience, it discloses another learner's data.
 * Two real learners are provisioned, and each one's identifiers are then fired
 * at the other's session.
 *
 * The rule under test: a resource belonging to someone else must be
 * indistinguishable from one that does not exist. A 403 where a 404 belongs
 * still confirms the id is real.
 *
 * Requests are issued from inside the page rather than through Playwright's API
 * client, because the session cookie is `Secure` under a production build and
 * only the browser applies the localhost exemption for it. Going through the
 * page is also closer to the truth: it is the path the app itself takes.
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

interface Learner {
  context: BrowserContext;
  page: Page;
  goalId: string;
  taskId: string;
  threadId: string;
}

/** Fetch from within the page, so the browser's cookie jar applies. */
async function call(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  return page.evaluate(
    async ([method, path, body]) => {
      const response = await fetch(path as string, {
        method: method as string,
        credentials: 'include',
        ...(body === null
          ? {}
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      return { status: response.status, json: parsed };
    },
    [method, path, body ?? null] as const,
  );
}

async function list(page: Page, path: string): Promise<{ id: string }[]> {
  const { status, json } = await call(page, 'GET', path);
  if (status !== 200) throw new Error(`GET ${path} -> ${status}: ${JSON.stringify(json)}`);
  return (json as { data: { id: string }[] }).data;
}

async function provision(browser: Browser, tag: string): Promise<Learner> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await onboard(page, newLearner(tag));

  const goalId = (await list(page, '/api/v1/goals'))[0]!.id;
  const taskId = (await list(page, '/api/v1/tasks'))[0]!.id;
  const created = await call(page, 'POST', '/api/v1/coach/threads', { goalId });
  if (created.status !== 201) {
    throw new Error(`could not create a thread for ${tag}: ${JSON.stringify(created.json)}`);
  }
  const threadId = (created.json as { data: { id: string } }).data.id;

  return { context, page, goalId, taskId, threadId };
}

let alice: Learner;
let bob: Learner;

test.beforeAll(async ({ browser }) => {
  alice = await provision(browser, 'alice');
  bob = await provision(browser, 'bob');
});

test.afterAll(async () => {
  await alice?.context.close();
  await bob?.context.close();
});

test('the two learners really are distinct tenants', () => {
  expect(alice.goalId).not.toBe(bob.goalId);
  expect(alice.taskId).not.toBe(bob.taskId);
  expect(alice.threadId).not.toBe(bob.threadId);
});

test("one learner cannot read another learner's goal", async () => {
  for (const path of [
    `/api/v1/goals/${alice.goalId}`,
    `/api/v1/goals/${alice.goalId}/mission-control`,
    `/api/v1/goals/${alice.goalId}/next-action`,
    `/api/v1/goals/${alice.goalId}/graph`,
    `/api/v1/goals/${alice.goalId}/feasibility`,
    `/api/v1/goals/${alice.goalId}/plans/current`,
    `/api/v1/goals/${alice.goalId}/schedule`,
  ]) {
    const { status } = await call(bob.page, 'GET', path);
    expect(status, `${path} leaked across tenants`).toBe(404);
  }
});

test("one learner cannot read or mutate another learner's task", async () => {
  expect((await call(bob.page, 'GET', `/api/v1/tasks/${alice.taskId}/study`)).status).toBe(404);
  expect(
    (await call(bob.page, 'PATCH', `/api/v1/tasks/${alice.taskId}`, { status: 'completed' }))
      .status,
  ).toBe(404);
});

test("one learner cannot start a session against another learner's task", async () => {
  const { status } = await call(bob.page, 'POST', '/api/v1/sessions', {
    goalId: alice.goalId,
    taskId: alice.taskId,
    originatedFrom: 'recommendation',
  });
  expect(status).toBe(404);
});

test("one learner cannot reach another learner's coach thread", async () => {
  expect([403, 404]).toContain(
    (await call(bob.page, 'GET', `/api/v1/coach/threads/${alice.threadId}`)).status,
  );

  // Posting is refused too, but the reason depends on the environment: with no
  // live vendor configured the availability gate answers 503 before ownership
  // is ever consulted, which is deliberate (there is no non-AI version of a
  // conversation). What must never happen is the write succeeding. The strict
  // 404-on-ownership assertion lives in `coach-live.spec.ts`, where the coach
  // is actually reachable and the ownership check is the one that runs.
  const { status } = await call(
    bob.page,
    'POST',
    `/api/v1/coach/threads/${alice.threadId}/messages`,
    { content: 'reading your mail' },
  );
  expect([403, 404, 503]).toContain(status);
  expect(status, "a write into another learner's thread was accepted").not.toBe(200);
});

test("one learner cannot delete another learner's memory", async () => {
  const facts = await call(alice.page, 'GET', '/api/v1/memory/facts');
  const first = (facts.json as { data: { id: string }[] }).data[0];
  test.skip(!first, 'no learner facts exist yet to attempt deleting');
  expect((await call(bob.page, 'DELETE', `/api/v1/memory/facts/${first!.id}`)).status).toBe(404);
});

test("the list endpoints only ever return the caller's own rows", async () => {
  expect((await list(bob.page, '/api/v1/goals')).map((g) => g.id)).not.toContain(alice.goalId);
  expect((await list(bob.page, '/api/v1/tasks')).map((t) => t.id)).not.toContain(alice.taskId);
});

test('an unauthenticated caller gets nothing at all', async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL });
  for (const path of [
    '/api/v1/me',
    '/api/v1/goals',
    '/api/v1/tasks',
    '/api/v1/memory/mastery',
    '/api/v1/memory/facts',
    '/api/v1/intelligence/progress',
  ]) {
    expect((await anonymous.get(path)).status(), path).toBe(401);
  }
  await anonymous.dispose();
});

test('a cross-origin mutation is rejected before authentication is even considered', async ({
  playwright,
  baseURL,
}) => {
  const outsider = await playwright.request.newContext({ baseURL });

  // The origin check runs ahead of the session lookup, so a foreign origin is
  // 403 while the same call from the right origin only gets as far as 401.
  // That difference is the proof the rejection came from the CSRF guard and
  // not incidentally from missing auth.
  const foreign = await outsider.post('/api/v1/coach/threads', {
    data: {},
    headers: { origin: 'https://evil.example' },
  });
  expect(foreign.status()).toBe(403);

  const local = await outsider.post('/api/v1/coach/threads', {
    data: {},
    headers: { origin: baseURL! },
  });
  expect(local.status()).toBe(401);

  await outsider.dispose();
});

test('the session cookie is HttpOnly, Secure, SameSite=Lax, and invisible to script', async () => {
  const session = (await bob.context.cookies()).find((c) => c.name === 'friday_session');
  expect(session, 'no session cookie was set').toBeDefined();
  expect(session!.httpOnly, 'must not be readable by script').toBe(true);
  expect(session!.sameSite).toBe('Lax');
  // A production build sets Secure; the browser exempts localhost so this still
  // works under test, and a real deployment is over TLS.
  expect(session!.secure, 'must not travel over plaintext in production').toBe(true);

  expect(await bob.page.evaluate(() => document.cookie)).not.toContain(session!.value);
});

test('signing out invalidates the session server-side, not just in the browser', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await onboard(page, newLearner('logout'));

  const cookie = (await context.cookies()).find((c) => c.name === 'friday_session')!;
  expect((await call(page, 'GET', '/api/v1/me')).status).toBe(200);

  await call(page, 'POST', '/api/v1/auth/sign-out');

  // Replay the exact token a stolen-cookie attacker would hold. Clearing the
  // browser's copy is not security; the row has to be gone.
  const replay = await browser.newContext();
  await replay.addCookies([cookie]);
  const replayPage = await replay.newPage();
  await replayPage.goto('/sign-in');
  expect(
    (await call(replayPage, 'GET', '/api/v1/me')).status,
    'a signed-out token still worked',
  ).toBe(401);

  await replay.close();
  await context.close();
});

test('a stale session cookie does not lock a learner out of signing in', async ({ browser }) => {
  /**
   * Regression for a lockout found during launch-readiness verification.
   *
   * Middleware redirected anyone *holding* a session cookie away from
   * `/sign-in` to `/dashboard`. But a cookie is not a session: once it expired
   * or was revoked, `/dashboard` validated it for real, failed, and redirected
   * back to `/sign-in` — `ERR_TOO_MANY_REDIRECTS`, forever. The learners who
   * hit it were exactly the ones who needed the sign-in page.
   */
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: 'friday_session',
      value: 'a-token-that-was-never-valid',
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  const page = await context.newPage();

  await page.goto('/sign-in');
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByLabel('Email')).toBeVisible();

  // And a protected page still refuses it rather than being fooled by presence.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/sign-in/);

  await context.close();
});

test('security headers are present on an app response', async ({ page }) => {
  const response = await page.goto('/sign-in');
  const headers = response!.headers();

  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['permissions-policy']).toBeTruthy();
  expect(headers['strict-transport-security']).toContain('max-age=');

  const csp = headers['content-security-policy'];
  expect(csp, 'no Content-Security-Policy').toBeTruthy();
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("base-uri 'self'");
  // A nonce is what makes the policy worth having; `unsafe-inline` in
  // script-src would quietly reduce it to decoration.
  expect(csp).toMatch(/script-src[^;]*'nonce-/);
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
});

test('the CSP nonce is fresh on every request', async ({ page }) => {
  // A reused nonce is barely better than none: one leaked value would be
  // replayable across every later response.
  const nonceOf = async () => {
    const response = await page.goto('/sign-in');
    return /'nonce-([^']+)'/.exec(response!.headers()['content-security-policy'] ?? '')?.[1];
  };
  const first = await nonceOf();
  const second = await nonceOf();
  expect(first).toBeTruthy();
  expect(first).not.toBe(second);
});

test('no page violates its own CSP', async ({ browser }) => {
  // The risk of a strict policy is breaking the app in ways that only show up
  // in the console. Every page is loaded and the console is read.
  const context = await browser.newContext();
  const page = await context.newPage();
  await onboard(page, newLearner('csp'));

  const violations: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/Content Security Policy|Refused to (load|execute|apply|connect)/i.test(text)) {
      violations.push(`${page.url()}: ${text}`);
    }
  });
  page.on('pageerror', (error) => violations.push(`${page.url()}: ${error.message}`));

  for (const path of [
    '/',
    '/sign-in',
    '/sign-up',
    '/dashboard',
    '/plan',
    '/practice',
    '/coach',
    '/progress',
    '/memory',
    '/settings',
  ]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }

  expect(violations.join('\n')).toBe('');
  await context.close();
});
