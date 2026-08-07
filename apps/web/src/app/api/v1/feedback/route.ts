import { SubmitFeedbackRequestSchema } from '@friday/contracts';
import { authedRoute } from '@/lib/api/handler';
import { listOwnFeedback, submitFeedback } from '@/modules/platform/feedback.service';

export const runtime = 'nodejs';

export const POST = authedRoute({
  body: SubmitFeedbackRequestSchema,
  handler: async ({ user, body }) => ({
    status: 201,
    data: await submitFeedback(user, body),
  }),
});

export const GET = authedRoute({
  handler: async ({ user }) => ({ data: await listOwnFeedback(user) }),
});
