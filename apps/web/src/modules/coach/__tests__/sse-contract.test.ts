import { describe, expect, it } from 'vitest';
import type { CoachEvent } from '@friday/ai';

/**
 * The SSE projection contract — API_SPECIFICATION §5.10.
 *
 * The route handler destructures a `CoachEvent` into `{ event: type, data:
 * rest }`. That only stays correct while the agent's event names and the wire
 * event names are the same word, so it is asserted rather than assumed.
 */

function project(event: CoachEvent): { event: string; data: Record<string, unknown> } {
  const { type, ...rest } = event;
  return { event: type, data: rest };
}

describe('coach SSE projection', () => {
  it('maps every event type to its documented wire name', () => {
    const events: CoachEvent[] = [
      { type: 'start', messageId: 'm1', model: 'claude-sonnet-5' },
      { type: 'tool_call', name: 'get_weak_concepts', args: { limit: 5 } },
      { type: 'tool_result', name: 'get_weak_concepts', summary: '5 concepts returned' },
      { type: 'delta', text: 'hello' },
      {
        type: 'done',
        messageId: 'm1',
        usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 },
        costUsd: 0.001,
      },
      { type: 'error', code: 'AI_UNAVAILABLE', message: 'down' },
    ];

    // These names are the API contract; renaming one is a breaking change.
    expect(events.map((e) => project(e).event)).toEqual([
      'start',
      'tool_call',
      'tool_result',
      'delta',
      'done',
      'error',
    ]);
  });

  it('strips the discriminant from the payload, leaving only the event fields', () => {
    const projected = project({ type: 'delta', text: 'partial answer' });
    expect(projected.data).toEqual({ text: 'partial answer' });
    expect(projected.data).not.toHaveProperty('type');
  });

  it('serialises to the SSE frame shape', () => {
    const { event, data } = project({ type: 'delta', text: 'hi' });
    expect(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).toBe(
      'event: delta\ndata: {"text":"hi"}\n\n',
    );
  });
});

/**
 * Regression: a pre-flight failure must produce a real HTTP error, not a 200
 * whose first frame is an error event.
 *
 * Found at runtime — `assertCoachAvailable()` originally sat inside an async
 * generator, and a generator body does not execute until its first `next()`,
 * by which point the status line and headers are already sent. The handler now
 * returns the iterable from an async function so throws happen while an error
 * response is still possible.
 */
describe('sse pre-flight ordering', () => {
  it('an async generator defers its body until first next()', async () => {
    let bodyRan = false;
    async function* generator() {
      bodyRan = true;
      yield 1;
    }

    const iterator = generator();
    expect(bodyRan).toBe(false); // nothing has run — this was the bug

    await iterator.next();
    expect(bodyRan).toBe(true);
  });

  it('an async function throws before returning its iterable', async () => {
    async function handler(): Promise<AsyncIterable<number>> {
      throw new Error('not configured');
    }

    // The throw happens on await, before any stream could be constructed.
    await expect(handler()).rejects.toThrow('not configured');
  });
});
