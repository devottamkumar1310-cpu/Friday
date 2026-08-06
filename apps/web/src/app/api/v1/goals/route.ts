import { CreateGoalRequestSchema } from '@friday/contracts';
import { authedRoute } from '@/lib/api/handler';
import { createGoal, listGoals, toWireGoal } from '@/modules/curriculum/curriculum.service';

export const runtime = 'nodejs';

export const POST = authedRoute({
  body: CreateGoalRequestSchema,
  handler: async ({ user, body }) => {
    const { goal, curriculum } = await createGoal(user, body);
    return {
      status: 201,
      data: {
        goal: toWireGoal(goal),
        curriculum: { id: curriculum.id, totalConcepts: curriculum.totalConcepts },
      },
    };
  },
});

export const GET = authedRoute({
  handler: async ({ user }) => ({ data: (await listGoals(user)).map(toWireGoal) }),
});
