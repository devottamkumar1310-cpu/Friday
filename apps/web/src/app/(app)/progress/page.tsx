import type { Metadata } from 'next';
import { TrendingUp } from 'lucide-react';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from '@friday/ui';
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

export const metadata: Metadata = { title: 'Progress' };

/**
 * Progress page — roadmap 2.11 (ring, weak list, trend) and 2.3 (feasibility
 * remediation).
 *
 * An RSC that calls services directly (§4.1): the page is data-dense and barely
 * interactive, so server-rendering the whole frame beats shipping a client
 * fetch waterfall.
 */
export default async function ProgressPage() {
  const user = await requireOnboardedUser();
  const goals = await listGoals(user);
  const goal = goals.find((g) => g.status === 'active') ?? goals[0];

  if (!goal) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Progress</h1>
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={<TrendingUp className="size-8" />}
              title="No goal yet"
              description="Progress appears once you have a goal and a plan to measure against."
            />
          </CardContent>
        </Card>
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Progress</h1>
        <p className="mt-1 text-sm text-muted-foreground">{goal.title}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-[auto_1fr]">
        <Card className="grid place-items-center p-6">
          <ProgressRing value={progress.weightedProgress} label="weighted" />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Where you stand</CardTitle>
            <CardDescription>
              Progress is weighted by exam importance and adjusted for what you have forgotten — not
              a count of finished tasks.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <Stat
              label="Concepts mastered"
              value={`${progress.conceptsMastered} / ${progress.conceptsTotal}`}
            />
            <Stat label="In progress" value={String(progress.conceptsInProgress)} />
            <Stat label="Not started" value={String(progress.conceptsNotStarted)} />
            <Stat label="Days remaining" value={String(progress.daysRemaining)} />
            <Stat label="Due for review" value={String(progress.retentionHealth.dueNow)} />
            <Stat
              label="At risk of loss"
              value={String(progress.retentionHealth.atRisk)}
              hint={
                progress.retentionHealth.overdue > 0
                  ? `${progress.retentionHealth.overdue} overdue`
                  : undefined
              }
            />
          </CardContent>
        </Card>
      </div>

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

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Weakest concepts</CardTitle>
            <CardDescription>
              Ranked by what it costs to leave them weak — exam weight, how far off you are, and how
              much else depends on them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WeakConceptList
              concepts={weakConcepts.map((w) => ({
                conceptId: w.conceptId,
                title: w.title,
                mastery: w.mastery,
                examWeight: w.examWeight,
                evidence: {
                  evidenceCount: w.evidence.evidenceCount,
                  beliefConfidence: w.evidence.beliefConfidence,
                  lastEvidenceAt: w.evidence.lastEvidenceAt?.toISOString() ?? null,
                  provisional: w.evidence.provisional,
                },
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Pace</CardTitle>
              <Badge variant={progress.velocity.trend === 'declining' ? 'warning' : 'success'}>
                {trendCopy}
              </Badge>
            </div>
            <CardDescription>
              Measured from your actual progress, not from the hours you planned at signup.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <Stat
                label="Your pace"
                value={`${(progress.velocity.perWeek * 100).toFixed(1)}% / week`}
              />
              <Stat
                label="Needed"
                value={`${(progress.velocity.requiredPerWeek * 100).toFixed(1)}% / week`}
              />
            </div>

            {trends.length >= 2 ? (
              <Sparkline points={trends.map((t) => t.weightedProgress)} />
            ) : (
              <p className="text-xs text-subtle-foreground">
                A trend line appears once there are at least two daily snapshots. One data point is
                not a trend, so nothing is drawn yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {hint ? <div className="text-[11px] text-warning">{hint}</div> : null}
    </div>
  );
}

/** Inline SVG rather than a chart library — one series, no interaction, no axes. */
function Sparkline({ points }: { points: number[] }) {
  const width = 280;
  const height = 48;
  const max = Math.max(...points, 0.0001);
  const step = points.length > 1 ? width / (points.length - 1) : width;

  const d = points
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${(height - (p / max) * height).toFixed(1)}`,
    )
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-12 w-full text-primary"
      role="img"
      aria-label="Weighted progress over the last 30 days"
      preserveAspectRatio="none"
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}
