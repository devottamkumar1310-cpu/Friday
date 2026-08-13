import { expect, test } from '@playwright/test';

/**
 * The same-origin check, from both sides.
 *
 * This is the defect that took login down in production: every mutating
 * request 403'd while every page rendered normally, so the only visible
 * symptom was "login doesn't work". The cause was a comparison against
 * `APP_URL` (or, unset, against the internal request URL) rather than against
 * the host the browser actually reached — which a platform proxy rewrites, and
 * which differs across a deployment's several hostnames.
 *
 * These two tests pull in opposite directions on purpose. Fixing the outage by
 * loosening the check into uselessness would pass the first and fail the
 * second.
 */

test('a request from the host the browser reached is accepted', async ({ playwright, baseURL }) => {
  const client = await playwright.request.newContext({ baseURL });

  // A deployment hostname that is *not* whatever APP_URL happens to say. The
  // proxy reports it via x-forwarded-host, exactly as Vercel does.
  const response = await client.post('/api/v1/auth/sign-in', {
    data: { email: 'nobody@example.test', password: 'wrong-but-well-formed' },
    headers: {
      origin: 'https://friday-preview.vercel.app',
      'x-forwarded-host': 'friday-preview.vercel.app',
      'x-forwarded-proto': 'https',
    },
  });

  // 401 means the credentials were actually evaluated — the request got past
  // the CSRF gate, which is the whole point. 403 would mean it never did.
  expect(response.status(), 'the origin check rejected a legitimate host').toBe(401);

  await client.dispose();
});

test('a genuine cross-site request is still rejected', async ({ playwright, baseURL }) => {
  const client = await playwright.request.newContext({ baseURL });

  // An attacker's page: their origin, our host. This must never be accepted.
  const response = await client.post('/api/v1/auth/sign-in', {
    data: { email: 'nobody@example.test', password: 'wrong-but-well-formed' },
    headers: {
      origin: 'https://evil.example',
      'x-forwarded-host': 'friday-preview.vercel.app',
    },
  });

  expect(response.status(), 'a cross-site write was allowed through').toBe(403);

  await client.dispose();
});

test('scheme differences do not matter, because TLS ends at the edge', async ({
  playwright,
  baseURL,
}) => {
  const client = await playwright.request.newContext({ baseURL });

  // The browser speaks https to the edge; the function sees http internally.
  // Comparing full origins made this fatal.
  const response = await client.post('/api/v1/auth/sign-in', {
    data: { email: 'nobody@example.test', password: 'wrong-but-well-formed' },
    headers: { origin: 'https://friday-preview.vercel.app', host: 'friday-preview.vercel.app' },
  });

  expect(response.status()).toBe(401);

  await client.dispose();
});
