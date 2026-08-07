import { describe, expect, it } from 'vitest';
import { ApiError, ERROR_CODES } from '@friday/contracts';
import { sseStream } from '../handler';

/**
 * The SSE body's controller lifecycle.
 *
 * Found during launch-readiness verification, on a real Coach stream that hit a
 * provider quota while the browser was still attached: the route logged
 * `Invalid state: Controller is already closed`. A cancelled stream — a closed
 * tab, a back navigation, a dropped connection — left `enqueue` and `close`
 * throwing into nothing, and the throw was reported as an incident.
 *
 * A closed reader is not an incident. These tests hold that line.
 */

async function collect(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

async function* events(...items: { event: string; data: unknown }[]) {
  for (const item of items) yield item;
}

describe('sseStream', () => {
  it('writes each event as a well-formed frame', async () => {
    const body = await collect(
      sseStream(
        events({ event: 'delta', data: { text: 'hi' } }, { event: 'done', data: {} }),
        'r1',
      ),
    );
    expect(body).toBe('event: delta\ndata: {"text":"hi"}\n\nevent: done\ndata: {}\n\n');
  });

  it('delivers a mid-stream failure as an error event, keeping the real code', async () => {
    async function* failing() {
      yield { event: 'delta', data: { text: 'partial' } };
      throw new ApiError(ERROR_CODES.AI_UNAVAILABLE, 'The coach is unavailable.');
    }

    const body = await collect(sseStream(failing(), 'r2'));
    expect(body).toContain('event: delta');
    expect(body).toContain('event: error');
    // "AI_UNAVAILABLE" tells the learner their plan is fine and only the coach
    // is down. "INTERNAL_ERROR" would not.
    expect(body).toContain(ERROR_CODES.AI_UNAVAILABLE);
  });

  it('survives a reader that cancels mid-stream', async () => {
    let produced = 0;
    async function* slow() {
      for (let i = 0; i < 50; i += 1) {
        produced += 1;
        yield { event: 'delta', data: { text: `chunk ${i}` } };
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    }

    const stream = sseStream(slow(), 'r3');
    const reader = stream.getReader();
    await reader.read();
    // This is a learner closing the tab.
    await reader.cancel();

    // The previous implementation threw "Invalid state: Controller is already
    // closed" here, asynchronously and unhandled.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // It also stops pulling from the model once nobody is listening, rather
    // than burning tokens on an answer no one will read.
    expect(produced).toBeLessThan(50);
  });

  it('does not throw when the iterator fails after the reader has gone', async () => {
    async function* failsLate() {
      yield { event: 'delta', data: { text: 'one' } };
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error('provider died');
    }

    const stream = sseStream(failsLate(), 'r4');
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();

    // Writing the error frame has nowhere to go; it must be a no-op, not a
    // second exception on top of the first.
    await expect(new Promise((resolve) => setTimeout(() => resolve('settled'), 60))).resolves.toBe(
      'settled',
    );
  });

  it('closes the stream exactly once on the happy path', async () => {
    // A double close is the other half of the same bug.
    const body = await collect(sseStream(events({ event: 'done', data: {} }), 'r5'));
    expect(body).toBe('event: done\ndata: {}\n\n');
  });
});
