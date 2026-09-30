import type { Metadata } from 'next';
import Link from 'next/link';
import { Button, PageHeader } from '@friday/ui';
import { requireUser } from '@/lib/auth/server';
import {
  getProgress,
  getWeakConcepts,
  getTrends,
  listInsights,
} from '@/modules/intelligence/intelligence.service';
import { z } from 'zod';
import { WeeklyReviewClient } from './weekly-review-client';

export const metadata: Metadata = { title: 'Weekly Review' };

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
    return (
      <div className="space-y-10">
        <PageHeader
          eyebrow="Weekly briefing"
          title="Your week with FRIDAY"
          description="See what changed, what improved, and what needs attention."
        />

        {/* No goal selected state */}
        <div className="rounded-xl border border-border bg-surface px-6 py-10 text-center">
          <p className="text-sm font-medium text-foreground">
            No goal selected.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Go to Progress to select a goal for review.
          </p>
          <Button asChild className="mt-4">
            <Link href="/progress">Go to Progress</Link>
          </Button>
        </div>
      </div>
    );
  }

  const goalIdValid = GoalIdSchema.safeParse(goalId);
  if (!goalIdValid.success) {
    return (
      <div className="space-y-10">
        <PageHeader
          eyebrow="Weekly briefing"
          title="Your week with FRIDAY"
          description="See what changed, what improved, and what needs attention."
        />

        {/* Invalid goal id error state */}
        <div className="rounded-xl border border-border bg-surface px-6 py-10 text-center">
          <p className="text-sm font-medium text-foreground">
            Invalid goal identifier.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            The goal ID in this URL is not recognized. Return to Progress and
            select a valid goal.
          </p>
          <Button asChild className="mt-4">
            <Link href="/progress">Go to Progress</Link>
          </Button>
        </div>
      </div>
    );
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
          projectedCompletionDate: progressResult.projectedCompletionDate ?? undefined,
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
    insightsResult?.length > 0
      ? insightsResult.map((i: any) => ({
          id: i.id,
          type: i.type,
          title: i.title,
          body: i.body,
          severity: i.severity,
          conceptIds: i.conceptIds ?? [],
          evidence: i.evidence,
          createdAt: i.createdAt?.toISOString(),
        }))
      : undefined;

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Weekly briefing"
        title="Your week with FRIDAY"
        description="See what changed, what improved, and what needs attention."
      />

      <WeeklyReviewClient
        data={{ progressData, weakConceptsData, trendsData, insightsData }}
        goalId={goalIdValid.data}
      />
    </div>
  );
}