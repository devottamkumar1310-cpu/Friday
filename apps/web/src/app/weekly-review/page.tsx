import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import {
  getProgress,
  getWeakConcepts,
  getTrends,
  listInsights,
} from '@/modules/intelligence/intelligence.service';
import { z } from 'zod';
import { WeeklyReviewClient } from './weekly-review-client';

const GoalIdSchema = z.string().uuid();

export default async function WeeklyReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ goalId?: string }>;
}) {
  const user = await requireUser();

  const params = await searchParams;
  const goalId = params.goalId;

  if (!goalId) {
    notFound();
    return;
  }

  const goalIdValid = GoalIdSchema.safeParse(goalId);
  if (!goalIdValid.success) {
    notFound();
    return;
  }

  const [progressResult, weakConceptsResult, trendsResult, insightsResult] =
    await Promise.all([
      getProgress(user, goalIdValid.data),
      getWeakConcepts(user, goalIdValid.data, 5),
      getTrends(user, goalIdValid.data, 30),
      listInsights(user, goalIdValid.data),
    ]);

  const progressData =
    progressResult?.weightedProgress !== undefined
      ? {
          weightedProgress: progressResult.weightedProgress,
          rawProgress: progressResult.rawProgress,
          conceptsMastered: progressResult.conceptsMastered,
          conceptsTotal: progressResult.conceptsTotal,
          conceptsInProgress: progressResult.conceptsInProgress,
          conceptsNotStarted: progressResult.conceptsNotStarted,
          verdict: progressResult.verdict,
          projectedCompletionDate: progressResult.projectedCompletionDate,
          daysRemaining: progressResult.daysRemaining,
          velocity: progressResult.velocity,
          retentionHealth: progressResult.retentionHealth,
          adherence: progressResult.adherence,
        }
      : undefined;

  const weakConceptsData =
    weakConceptsResult?.length > 0 ? weakConceptsResult : undefined;

  const trendsData = trendsResult?.length > 0 ? trendsResult : undefined;

  const insightsData =
    insightsResult?.length > 0 ? insightsResult.map((i: any) => ({
      id: i.id,
      type: i.type,
      title: i.title,
      body: i.body,
      severity: i.severity,
      conceptIds: i.conceptIds ?? [],
      evidence: i.evidence,
      createdAt: i.createdAt?.toISOString(),
    })) : undefined;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="mb-8">
        <p className="text-sm font-medium text-primary">Weekly Review</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Your Learning Review
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          FRIDAY summarizes your progress over the last week.
        </p>
      </div>

      <WeeklyReviewClient data={{ progressData, weakConceptsData, trendsData, insightsData }} />
    </main>
  );
}