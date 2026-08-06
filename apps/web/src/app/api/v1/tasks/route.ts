import { authedRoute } from '@/lib/api/handler';
import { listTasks, toWireTask } from '@/modules/planning/planning.service';

export const runtime = 'nodejs';

export const GET = authedRoute({
  handler: async ({ user, req }) => {
    const q = req.nextUrl.searchParams;
    const tasks = await listTasks(user, {
      goalId: q.get('goalId') ?? undefined,
      from: q.get('from') ?? undefined,
      to: q.get('to') ?? undefined,
      status: q.get('status') ?? undefined,
    });
    return { data: tasks.map(({ task, concepts }) => toWireTask(task, concepts)) };
  },
});
