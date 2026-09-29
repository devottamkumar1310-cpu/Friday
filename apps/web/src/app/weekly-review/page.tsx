import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import {
  getProgress,
  getWeakConcepts,
  getTrends,
  listInsights,
} from '@/modules/intelligence/intelligence.service';
import { z } from 'zod';

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

      <div className="space-y-6">

        {/* Progress summary */}
        {progressData && progressData.weightedProgress !== undefined && (
          <div>
            <h2 className="text-lg font-medium mb-3">Progress This Week</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="font-medium">Weighted Progress</p>
                <p className="text-3xl font-medium">
                  {Number(progressData.weightedProgress).toFixed(2)}
                </p>
              </div>
              <div>
                <p className="font-medium">Concepts Mastered</p>
                <p className="text-3xl font-medium">
                  {progressData.conceptsMastered || 0}
                </p>
              </div>
            </div>
            <p className="text-muted-foreground">
              Verdict: {progressData.verdict || 'N/A'}
            </p>
            {progressData.projectedCompletionDate && (
              <p className="mt-2">
                Projected completion: {new Date(
                  progressData.projectedCompletionDate,
                ).toLocaleDateString()}
              </p>
            )}
          </div>
        )}

        {/* Weak concepts */}
        {weakConceptsData && weakConceptsData.length > 0 && (
          <div>
            <h2 className="text-lg font-medium mb-3">Weak Concepts</h2>
            <ol className="list-decimal pl-5 space-y-2">
              {weakConceptsData.map((wc: any, i: number) => (
                <li key={i} className="p-3 rounded border border-border">
                  <div className="font-medium">
                    Concept {wc.conceptId}: mastery {wc.mastery?.toFixed(2)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Evidence: {wc.evidence?.evidenceCount || 0} observations,
                    confidence: {wc.evidence?.beliefConfidence?.toFixed(2) ||
                      'N/A'}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Trends */}
        {trendsData && trendsData.length > 0 && (
          <div>
            <h2 className="text-lg font-medium mb-3">Progress Trend</h2>
            <p className="text-muted-foreground">
              {trendsData.length > 0
                ? `${trendsData.length} study days this period`
                : 'No data yet'}
            </p>
            <pre className="mt-2 p-3 rounded border border-border text-xs overflow-auto">
              {trendsData
                .map(
                  (t: any) =>
                    `${t.date}: weighted progress ${Number(t.weightedProgress).toFixed(
                      2,
                    )}, mastered ${t.conceptsMastered || 0}/${t.conceptsTotal || 0}`,
                )
                .join('\n')}
            </pre>
          </div>
        )}

        {/* Insights */}
        {insightsData && insightsData.length > 0 && (
          <div>
            <h2 className="text-lg font-medium mb-3">Insights</h2>
            <ol className="list-disc pl-5 space-y-2">
              {insightsData.map((insight: any, i: number) => (
                <li key={i} className="p-2 rounded border border-border text-sm">
                  <div className="font-medium">{insight.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {insight.body}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Adaptive focus */}
        <div>
          <h2 className="text-lg font-medium mb-3">Adaptive Focus</h2>
          <p className="text-muted-foreground">
            Based on your recent performance, FRIDAY recommends focusing on the weak
            concepts listed above. Consider reviewing them before starting new material.
          </p>
        </div>
      </div>
    </main>
  );
}