import { z } from 'zod';
import { authedRoute } from '@/lib/api/handler';
import { createMockTest } from '@/modules/assessment/assessment.service';

export const runtime = 'nodejs';

const RequestSchema = z.object({
  goalId: z.string().uuid(),
  questionCount: z.number().int().min(1).max(50).optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
});

export const POST = authedRoute({
  body: RequestSchema,
  handler: async ({ user, body }) => ({
    status: 201,
    data: await createMockTest(user, body),
  }),
});
