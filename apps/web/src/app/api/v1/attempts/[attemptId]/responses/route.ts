import { SubmitResponseRequestSchema } from '@friday/contracts';
import { authedRoute, requireParam } from '@/lib/api/handler';
import { submitResponse } from '@/modules/assessment/assessment.service';

export const runtime = 'nodejs';

export const POST = authedRoute({
  body: SubmitResponseRequestSchema,
  handler: async ({ user, params, body }) => ({
    data: await submitResponse(user, {
      attemptId: requireParam(params, 'attemptId'),
      questionId: body.questionId,
      answer: body.answer,
      ...(body.responseMs !== undefined ? { responseMs: body.responseMs } : {}),
    }),
  }),
});
