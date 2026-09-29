import { authedRoute, requireParam } from '@/lib/api/handler';
import { getStudyTask, toWireTask } from '@/modules/planning/planning.service';

export const runtime = 'nodejs';

/** One request for the whole study screen — see the service for why. */
export const GET = authedRoute({
  handler: async ({ user, params }) => {
    const result = await getStudyTask(user, requireParam(params, 'taskId'));
    return {
      data: {
        task: toWireTask(
          result.task,
          result.concepts.map((c) => ({ id: c.id, title: c.title })),
        ),
        goalId: result.goalId,
        concepts: result.concepts,
        activeSessionId: result.activeSessionId,
        /**
         * Forwarded, not dropped.
         *
         * The study *page* calls `getStudyTask` directly on the server, so the
         * timer resumed correctly and the persistence tests passed — while this
         * endpoint, which advertises the same payload, quietly omitted the one
         * field the clock is derived from. Any client using the documented API
         * would have got a timer that resets to zero on every reload, which is
         * precisely the bug the field was added to fix.
         */
        activeSessionStartedAt: result.activeSessionStartedAt,
      },
    };
  },
});
