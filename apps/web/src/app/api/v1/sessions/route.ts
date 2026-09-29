import { StartSessionRequestSchema } from '@friday/contracts';
import { authedRoute } from '@/lib/api/handler';
import { listSessions, startSession } from '@/modules/execution/execution.service';
import { RATE_LIMITS } from '@/lib/api/rate-limit';

export const runtime = 'nodejs';

export const POST = authedRoute({
  body: StartSessionRequestSchema,
  rateLimit: RATE_LIMITS.session,
  handler: async ({ user, body }) => {
    const session = await startSession(user, body);
    return {
      status: 201,
      data: {
        id: session.id,
        goalId: session.goalId,
        taskId: session.taskId,
        status: session.status,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt?.toISOString() ?? null,
        activeMinutes: session.activeMinutes,
      },
    };
  },
});

export const GET = authedRoute({
  handler: async ({ user, req }) => {
    const limit = Number(req.nextUrl.searchParams.get('limit') ?? '20');
    return { data: await listSessions(user, limit) };
  },
});
