import { authedRoute, requireParam } from '@/lib/api/handler';
import { submitAttempt } from '@/modules/assessment/assessment.service';

export const runtime = 'nodejs';

/** Closes the practice loop: score → evidence → mastery + retention (roadmap 2.8). */
export const POST = authedRoute({
  handler: async ({ user, params }) => {
    const result = await submitAttempt(user, requireParam(params, 'attemptId'));
    return {
      data: {
        attemptId: result.attempt.id,
        score: result.score,
        maxScore: result.maxScore,
        submittedAt: result.attempt.submittedAt?.toISOString() ?? null,
        conceptBreakdown: result.conceptBreakdown,
        masteryChanges: result.masteryChanges,
      },
    };
  },
});
