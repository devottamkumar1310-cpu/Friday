import { CreatePracticeSetRequestSchema } from '@friday/contracts';
import { authedRoute } from '@/lib/api/handler';
import { createPracticeSet } from '@/modules/assessment/assessment.service';

export const runtime = 'nodejs';

export const POST = authedRoute({
  body: CreatePracticeSetRequestSchema,
  handler: async ({ user, body }) => ({
    status: 201,
    data: await createPracticeSet(user, body),
  }),
});
