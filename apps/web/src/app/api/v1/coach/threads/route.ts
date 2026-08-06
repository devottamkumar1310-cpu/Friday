import { CreateThreadRequestSchema } from '@friday/contracts';
import { authedRoute } from '@/lib/api/handler';
import { createThread, listThreads } from '@/modules/coach/coach.service';
import { toWireThread } from '@/modules/coach/wire';

export const runtime = 'nodejs';

export const GET = authedRoute({
  handler: async ({ user }) => ({ data: (await listThreads(user)).map(toWireThread) }),
});

export const POST = authedRoute({
  body: CreateThreadRequestSchema,
  handler: async ({ user, body }) => ({
    status: 201,
    data: toWireThread(await createThread(user, body.goalId ?? null)),
  }),
});
