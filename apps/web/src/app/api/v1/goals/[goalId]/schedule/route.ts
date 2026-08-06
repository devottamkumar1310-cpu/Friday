import { authedRoute, requireParam } from '@/lib/api/handler';
import {
  getSchedule,
  hydrateTasksWithConcepts,
  toWireTask,
} from '@/modules/planning/planning.service';

export const runtime = 'nodejs';

export const GET = authedRoute({
  handler: async ({ user, params }) => {
    const { plan, tasks } = await getSchedule(user, requireParam(params, 'goalId'));
    const hydrated = await hydrateTasksWithConcepts(user.id, tasks);

    const byDate = new Map<string, typeof hydrated>();
    for (const h of hydrated) {
      const list = byDate.get(h.task.scheduledDate) ?? [];
      list.push(h);
      byDate.set(h.task.scheduledDate, list);
    }

    const days = [...byDate.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, items]) => ({
        date,
        capacityMinutes: items.reduce((s, i) => s + i.task.estimatedMinutes, 0),
        plannedMinutes: items.reduce((s, i) => s + i.task.estimatedMinutes, 0),
        blocks: [
          {
            id: `${plan.id}-${date}`,
            startTime: null,
            endTime: null,
            plannedMinutes: items.reduce((s, i) => s + i.task.estimatedMinutes, 0),
            isLocked: false,
            tasks: items.map((i) => toWireTask(i.task, i.concepts)),
          },
        ],
      }));

    return {
      data: {
        planVersion: plan.version,
        window: { start: plan.windowStart, end: plan.windowEnd },
        days,
        projection: (plan.projection ?? []) as {
          week: string;
          conceptIds: string[];
          plannedMinutes: number;
        }[],
      },
    };
  },
});
