import { authedRoute, requireParam } from '@/lib/api/handler';
import { reportQuestion } from '@/modules/assessment/assessment.service';

export const runtime = 'nodejs';

export const POST = authedRoute({
  handler: async ({ params }) => {
    await reportQuestion(requireParam(params, 'questionId'));
    return { data: { reported: true } };
  },
});
