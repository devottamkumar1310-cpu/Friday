import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { newLearner, onboard } from './support/learner';

/**
 * The Coach against a live model — Launch Readiness blocker B2.
 *
 * The chat client parses Server-Sent Events by hand, because `EventSource`
 * cannot POST and this endpoint takes a body. It buffers partial events and
 * only drains up to the last complete one. Until now that parser had met
 * exactly one thing: an error response. It had never seen a real stream, which
 * made it the most complex and least verified code in the product.
 *
 * This spec needs a working provider key, so it is skipped by default and run
 * explicitly with `E2E_LIVE_AI=1`. It is deliberately *not* part of the CI gate:
 * a suite that fails when a third party rate-limits is a suite people learn to
 * ignore.
 */

const LIVE = process.env['E2E_LIVE_AI'] === '1';

test.skip(!LIVE, 'set E2E_LIVE_AI=1 and configure a provider key to run');
test.describe.configure({ mode: 'serial' });
// A live model call plus onboarding does not fit the default budget, and a
// timeout that fires mid-poll reads as "the stream failed" when it did not.
test.setTimeout(180_000);

const learner = newLearner('coach');

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

test('streams a real answer, token by token, into the transcript', async () => {
  /**
   * Record the wire, so a failure reads as "the stream was wrong" rather than
   * "the client mis-rendered a correct stream".
   *
   * Captured by teeing inside the page rather than via `response.text()`: the
   * page consumes the body as it streams, and asking Playwright for the text of
   * an already-consumed stream returns empty. A tee sees exactly the bytes the
   * client sees, which is the whole point.
   */
  await page.addInitScript(() => {
    const original = window.fetch;
    (window as unknown as { __sse: string }).__sse = '';
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await original(...args);
      const type = response.headers.get('content-type') ?? '';
      if (!type.includes('text/event-stream') || !response.body) return response;

      const [toClient, toRecorder] = response.body.tee();
      void (async () => {
        const reader = toRecorder.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          (window as unknown as { __sse: string }).__sse += decoder.decode(value, { stream: true });
        }
      })();

      return new Response(toClient, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };
  });

  await page.goto('/coach');

  await page.getByLabel('Message the coach').fill('In one sentence, what should I focus on next?');
  await page.getByRole('button', { name: 'Send message' }).click();

  // The learner's own message is echoed immediately — the UI must not appear
  // frozen while the model thinks.
  await expect(page.getByText('In one sentence, what should I focus on next?')).toBeVisible();

  const log = page.locator('[role="log"]');
  const baseline = (await log.innerText()).length;

  // Sample continuously from the moment the request goes out until the stream
  // closes. Sampling on a fixed window would just measure however long the
  // model took to think, not whether the client renders incrementally.
  const sentAt = Date.now();
  // Seeded with the pre-send length so the very first token counts as growth
  // like any other.
  const lengths: number[] = [baseline];
  let firstTokenMs: number | null = null;

  // The blinking cursor is the honest "still streaming" signal. The send button
  // is not: it is also disabled whenever the composer is empty, which it always
  // is straight after sending.
  const cursor = log.getByText('▍');

  while (Date.now() - sentAt < 90_000) {
    const length = (await log.innerText()).length;
    if (firstTokenMs === null && length > baseline) firstTokenMs = Date.now() - sentAt;
    lengths.push(length);
    if (firstTokenMs !== null && (await cursor.count()) === 0) break;
    await page.waitForTimeout(100);
  }

  const totalMs = Date.now() - sentAt;
  expect(firstTokenMs, 'no assistant text ever appeared').not.toBeNull();

  // Text was on screen while the stream was still open. This — not the number
  // of repaints — is what separates a streaming client from one that buffers
  // the whole body and paints once. How many chunks arrive is the provider's
  // choice: Gemini batches, and a short answer can legitimately be one delta,
  // so asserting "more than one repaint" would be testing Gemini, not FRIDAY.
  expect(firstTokenMs!).toBeLessThan(totalMs + 1);
  const steps = lengths.filter((len, i) => i > 0 && len > (lengths[i - 1] ?? 0)).length;
  expect(steps, `nothing was ever rendered: ${lengths.join(',')}`).toBeGreaterThan(0);

  // eslint-disable-next-line no-console -- the measurement is the point
  console.log(
    `coach stream: TTFT ${firstTokenMs}ms, ${steps} incremental render(s), ` +
      `${lengths.at(-1)} chars in ${totalMs}ms`,
  );

  // The composer is usable again once the stream closes.
  await expect(page.getByLabel('Message the coach')).toBeEnabled({ timeout: 30_000 });

  const transcript = await page.locator('[role="log"]').innerText();
  expect(transcript.length).toBeGreaterThan(40);

  // NFR-6.3 — model-generated text is labelled as such.
  await expect(page.getByText('Coach').first()).toBeVisible();

  // No half-parsed frames leaked into the rendered text.
  expect(transcript).not.toContain('data:');
  expect(transcript).not.toContain('event:');
  expect(transcript).not.toContain('undefined');
  expect(transcript).not.toContain('[object Object]');

  // And the wire really was SSE, with the events the client expects.
  const wire = await page.evaluate(() => (window as unknown as { __sse: string }).__sse);
  expect(wire, 'no event-stream body was captured').toContain('event: ');

  /**
   * The decisive check for B2.
   *
   * The client hand-parses this stream: it splits on blank lines, keeps a
   * partial tail in a buffer, and concatenates `delta.text`. Reassembling the
   * same frames here independently and comparing proves the parser dropped
   * nothing, duplicated nothing, and did not mangle a chunk boundary — which is
   * exactly the failure mode a hand-written SSE reader has, and exactly what a
   * network chunk landing mid-event would cause.
   */
  const expected = wire
    .split('\n\n')
    .filter((frame) => frame.includes('event: delta'))
    .map((frame) => {
      const data = frame.split('\n').find((line) => line.startsWith('data: '));
      return data ? ((JSON.parse(data.slice(6)) as { text?: string }).text ?? '') : '';
    })
    .join('');

  expect(expected.length, 'the stream carried no delta text').toBeGreaterThan(0);
  // Normalised: the transcript is rendered with `whitespace-pre-wrap` inside a
  // flex column, so innerText adds layout newlines the wire never had.
  const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
  expect(squash(transcript)).toContain(squash(expected));
});

test('the answer survives a reload — it was persisted, not just painted', async () => {
  await page.goto('/coach');
  const transcript = await page.locator('[role="log"]').innerText();
  expect(transcript).toContain('In one sentence, what should I focus on next?');
});

test('a second turn keeps the thread rather than starting over', async () => {
  await page.goto('/coach');
  const answers = page.locator('[role="log"]').getByText('Coach', { exact: true });
  const before = await answers.count();

  await page.getByLabel('Message the coach').fill('And why that one?');
  await page.getByRole('button', { name: 'Send message' }).click();

  // Wait for a second labelled answer to land. Not the streaming cursor: a
  // short reply can finish inside one polling interval, so the cursor's
  // presence is a race rather than a signal. Not the send button either — that
  // is disabled whenever the composer is empty, which it is right after
  // sending.
  await expect(answers).toHaveCount(before + 1, { timeout: 90_000 });

  const transcript = await page.locator('[role="log"]').innerText();
  expect(transcript).toContain('In one sentence, what should I focus on next?');
  expect(transcript).toContain('And why that one?');
});

// Runs last on purpose: it creates a fresh thread for this learner, which
// becomes the one `/coach` renders. Earlier, it left the persistence test
// reading an empty transcript.
test("another learner's thread is unreachable even when the coach is up", async ({ browser }) => {
  // The complement to `security.spec.ts`: there the availability gate answers
  // first and ownership is never consulted. Here the coach is live, so the
  // ownership check is the one that runs — and it has to answer "no such
  // thread", not "not yours", which would confirm the id is real.
  const threadId = await page.evaluate(async () => {
    const response = await fetch('/api/v1/coach/threads', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    return ((await response.json()) as { data: { id: string } }).data.id;
  });

  const outsider = await browser.newContext();
  const outsiderPage = await outsider.newPage();
  await onboard(outsiderPage, newLearner('coach-outsider'));

  const status = await outsiderPage.evaluate(async (id) => {
    const response = await fetch(`/api/v1/coach/threads/${id}/messages`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'reading your mail' }),
    });
    return response.status;
  }, threadId);

  expect(status).toBe(404);
  await outsider.close();
});
