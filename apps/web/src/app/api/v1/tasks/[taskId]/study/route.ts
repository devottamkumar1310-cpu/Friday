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
      },
    };
  },
});
