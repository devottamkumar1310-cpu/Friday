import { SendCoachMessageRequestSchema } from '@friday/contracts';
import { requireParam, sseRoute } from '@/lib/api/handler';
import { assertCoachAvailable, sendMessage } from '@/modules/coach/coach.service';

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
    // Checked here, in the async function body rather than inside the generator
    // below — so an unconfigured environment gets a real 503 with an honest
    // message, instead of a 200 whose first event is an error.
    assertCoachAvailable();
    const threadId = requireParam(params, 'threadId');

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
