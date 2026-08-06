import { authedRoute, requireParam } from '@/lib/api/handler';
import { archiveThread, getThread } from '@/modules/coach/coach.service';
import { toWireMessage, toWireThread } from '@/modules/coach/wire';

export const runtime = 'nodejs';

export const GET = authedRoute({
  handler: async ({ user, params }) => {
    const { thread, messages } = await getThread(user, requireParam(params, 'threadId'));
    return { data: { thread: toWireThread(thread), messages: messages.map(toWireMessage) } };
  },
});

export const DELETE = authedRoute({
  handler: async ({ user, params }) => {
    await archiveThread(user, requireParam(params, 'threadId'));
    return { data: { archived: true } };
  },
});
