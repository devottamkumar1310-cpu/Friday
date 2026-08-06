import { CompleteSessionRequestSchema } from '@friday/contracts';
import { authedRoute, requireParam } from '@/lib/api/handler';
import { completeSession } from '@/modules/execution/execution.service';

export const runtime = 'nodejs';

/**
 * "The most important write in the system" (API_SPECIFICATION §5.6) —
 * evidence -> mastery + retention update, in one transaction.
 */
export const POST = authedRoute({
  body: CompleteSessionRequestSchema,
  handler: async ({ user, params, body }) => {
    const sessionId = requireParam(params, 'sessionId');
    const { session, changes } = await completeSession(user, sessionId, body);
    return {
      data: {
        session: {
          id: session.id,
          goalId: session.goalId,
          taskId: session.taskId,
          status: session.status,
          startedAt: session.startedAt.toISOString(),
          endedAt: session.endedAt?.toISOString() ?? null,
          activeMinutes: session.activeMinutes,
        },
        changes,
        nextActionInvalidated: true,
      },
    };
  },
});
