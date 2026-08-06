import { UpdateTaskRequestSchema } from '@friday/contracts';
import { authedRoute, requireParam } from '@/lib/api/handler';
import { toWireTask, updateTask } from '@/modules/planning/planning.service';

export const runtime = 'nodejs';

export const PATCH = authedRoute({
  body: UpdateTaskRequestSchema,
  handler: async ({ user, params, body }) => {
    const { task, concepts } = await updateTask(user, requireParam(params, 'taskId'), body);
    return { data: toWireTask(task, concepts) };
  },
});
