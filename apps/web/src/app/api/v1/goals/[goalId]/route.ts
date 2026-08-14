import { UpdateGoalRequestSchema } from '@friday/contracts';
import { authedRoute, requireParam } from '@/lib/api/handler';
import { getGoal, toWireGoal, updateGoal } from '@/modules/curriculum/curriculum.service';

export const runtime = 'nodejs';

export const GET = authedRoute({
  handler: async ({ user, params }) => ({
    data: toWireGoal(await getGoal(user, requireParam(params, 'goalId'))),
  }),
});

/**
 * Change the goal's planner constraints — most importantly the exam date.
 *
 * `PATCH` rather than `PUT`: the curriculum is not editable through this route
 * and a full representation would imply otherwise. Changing what you are
 * studying means starting a new goal, which `POST /v1/goals` already does
 * without destroying the history attached to the old one.
 */
export const PATCH = authedRoute({
  body: UpdateGoalRequestSchema,
  handler: async ({ user, params, body }) => ({
    data: toWireGoal(await updateGoal(user, requireParam(params, 'goalId'), body)),
  }),
});
