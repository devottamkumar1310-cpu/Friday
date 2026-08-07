import { SendCoachMessageRequestSchema } from '@friday/contracts';
import { requireParam, sseRoute } from '@/lib/api/handler';
import {
  assertCoachAvailable,
  assertThreadOwned,
  sendMessage,
} from '@/modules/coach/coach.service';

export const runtime = 'nodejs';

/**
 * The Coach stream — API_SPECIFICATION §5.10.
 *
 * The service yields `CoachEvent`s whose `type` is already the SSE event name,
 * so this handler is a pass-through rather than a translator. Keeping the two
 * shapes identical is what stops the wire contract and the agent drifting apart.
 */
export const POST = sseRoute({
  body: SendCoachMessageRequestSchema,
  handler: async ({ user, params, body, requestId }) => {
    // Both checks run here, in the async function body rather than inside the
    // generator below. A generator body does not execute until its first
    // `next()`, which is after the 200 and the headers have gone out — so
    // anything checked in there is reported as a successful response carrying
    // an error event.
    //
    // Availability was hoisted in Phase 2. Ownership was not, and browser
    // verification found the consequence: posting into another learner's thread
    // answered 200. Nothing was written and nothing leaked, but every rate
    // limiter and alert keyed on 4xx saw those attempts succeed.
    assertCoachAvailable();
    const threadId = requireParam(params, 'threadId');
    await assertThreadOwned(user, threadId);

    async function* stream() {
      for await (const event of sendMessage(user, {
        threadId,
        content: body.content,
        requestId,
      })) {
        const { type, ...rest } = event;
        yield { event: type, data: rest };
      }
    }

    return stream();
  },
});
