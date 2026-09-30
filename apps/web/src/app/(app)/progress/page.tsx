import type { Metadata } from 'next';
import Link from 'next/link';
import { TrendingUp } from 'lucide-react';
import { Button, EmptyState, PageHeader } from '@friday/ui';
import { requireOnboardedUser } from '@/lib/auth/server';
import { listGoals } from '@/modules/curriculum/curriculum.service';
import {
  getProgress,
  getTrends,
  getWeakConcepts,
} from '@/modules/intelligence/intelligence.service';
import { getFeasibility } from '@/modules/planning/planning.service';
import { ProgressRing } from '@/components/progress/progress-ring';
import { WeakConceptList } from '@/components/progress/weak-concept-list';
import { FeasibilityRemediation } from '@/components/planning/feasibility-remediation';
import { MomentumMetric, MomentumSparkline } from '@/components/friday/momentum';

export const metadata: Metadata = { title: 'Progress' };

/**
 * Feasibility answers "does the remaining work fit the time I have?".
 * Velocity (below) answers "am I moving fast enough?". They are different
 * computations and can disagree on a brand-new learner, so each is stated in
 * its own terms rather than sharing the word "track".
 */
const VERDICT_LINE: Record<string, string> = {
  on_track:
    'The work left fits the time you have. This is a feasibility verdict, not a grade.',
  at_risk: 'The plan needs attention — the options below show exactly how to fix it.',
  not_feasible:
    'The current deadline does not fit the remaining work. The options below show your three levers.',
};

export default async function ProgressPage() {
  const user = await requireOnboardedUser();
  const goals = await listGoals(user);
  const goal = goals.find((g) => g.status === 'active') ?? goals[0];

  if (!goal) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Your learning progress"
          description="Mastery, retention, and what FRIDAY thinks you should fix next."
        />
        <EmptyState
          icon={<TrendingUp className="size-8" />}
          title="No goal yet"
          description="Progress appears once you have a goal and a plan to measure against."
        />
      </div>
    );
  }

  const [progress, weakConcepts, trends, feasibility] = await Promise.all([
    getProgress(user, goal.id),
    getWeakConcepts(user, goal.id, 10),
    getTrends(user, goal.id, 30),
    getFeasibility(user, goal.id),
  ]);

  const trendCopy = {
    ahead: 'ahead of the pace you need',
    on_pace: 'on the pace you need',
    declining: 'behind the pace you need',
  }[progress.velocity.trend];

  const masteredDelta =
    trends.length >= 2
      ? trends[trends.length - 1]!.conceptsMastered - trends[0]!.conceptsMastered
      : 0;

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow={goal.title}
        title="Your learning progress"
        description="Mastery, retention, and what FRIDAY thinks you should fix next."
        actions={
          weakConcepts.length > 0 ? (
            <Button asChild>
              <Link href="/practice">Practise weak concepts</Link>
            </Button>
          ) : undefined
        }
      />

      {/* Overall learning state — exam-weighted readiness, not task counts. */}
      <section
        aria-label="Where you stand"
        className="animate-enter rounded-xl border border-border bg-surface-raised p-6 md:p-8"
      >
        <div className="flex flex-col items-center gap-8 lg:flex-row lg:items-stretch">
          <div className="flex shrink-0 items-center justify-center">
            <ProgressRing value={progress.weightedProgress} label="Mastered" />
          </div>

          <div className="flex flex-1 flex-col justify-center gap-6">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                Where you stand
              </h2>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
                Weighted by exam importance and adjusted for memory decay — your actual
                readiness, not completed tasks.{' '}
                {VERDICT_LINE[progress.verdict] ?? ''}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-6 border-t border-border pt-6 md:grid-cols-3">
              <MomentumMetric
                eyebrow="Mastered"
                value={`${progress.conceptsMastered} / ${progress.conceptsTotal}`}
              />
              <MomentumMetric eyebrow="In progress" value={String(progress.conceptsInProgress)} />
              <MomentumMetric eyebrow="Not started" value={String(progress.conceptsNotStarted)} />
              <MomentumMetric eyebrow="Days left" value={String(progress.daysRemaining)} />
              <MomentumMetric
                eyebrow="Due for review"
                value={String(progress.retentionHealth.dueNow)}
              />
              <MomentumMetric
                eyebrow="At risk"
                value={String(progress.retentionHealth.atRisk)}
                caption={
                  progress.retentionHealth.overdue > 0
                    ? `${progress.retentionHealth.overdue} overdue`
                    : undefined
                }
              />
            </div>
          </div>
        </div>
      </section>

      {/* Momentum — velocity in words plus the recorded line. */}
      <section aria-label="Momentum" className="animate-enter space-y-3" style={{ ['--enter-delay' as string]: '60ms' }}>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Momentum
        </h2>
        <div className="flex flex-col gap-6 rounded-xl border border-border bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-md space-y-1">
            <p className="text-sm font-medium text-foreground">
              Your recent pace is {trendCopy}.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {masteredDelta > 0
                ? `${masteredDelta} more concept${masteredDelta === 1 ? '' : 's'} mastered across your recorded days.`
                : 'Mastery grows as you complete sessions and reviews.'}
            </p>
          </div>
          <MomentumSparkline
            points={trends.map((t) => ({ date: t.date, weightedProgress: t.weightedProgress }))}
          />
        </div>
      </section>

      {feasibility.feasibility.verdict !== 'on_track' && (
        <section aria-label="Get back on track">
          <FeasibilityRemediation
            feasibility={{
              verdict: feasibility.feasibility.verdict,
              requiredMinutes: Math.round(feasibility.feasibility.requiredMinutes),
              availableMinutes: Math.round(feasibility.feasibility.availableMinutes),
              slackMinutes: Math.round(feasibility.feasibility.slackMinutes),
              slackPercent: feasibility.feasibility.slackFraction * 100,
              projectedCompletionDate: feasibility.feasibility.projectedCompletionDate,
              confidenceIntervalDays: feasibility.feasibility.confidenceIntervalDays,
              remediationOptions: feasibility.remediationOptions.map((o) => ({
                type: o.type,
                detail: o.detail,
                impact: {
                  verdict: o.impact.verdict,
                  ...(o.impact.slackPercent !== undefined
                    ? { slackPercent: o.impact.slackPercent }
                    : {}),
                },
              })),
            }}
          />
        </section>
      )}

      <section aria-label="What to fix next" className="animate-enter space-y-3" style={{ ['--enter-delay' as string]: '120ms' }}>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          What to fix next
        </h2>

        {weakConcepts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
            <p className="text-sm font-medium text-foreground">No weak concepts identified.</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              FRIDAY needs a little more evidence before it can point at something
              meaningful. Keep studying.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <WeakConceptList
              goalId={goal.id}
              concepts={weakConcepts.map((w) => ({
                conceptId: w.conceptId,
                title: w.title,
                mastery: w.mastery,
                examWeight: w.examWeight,
                goalId: goal.id,
              }))}
            />
          </div>
        )}
      </section>
    </div>
  );
}
