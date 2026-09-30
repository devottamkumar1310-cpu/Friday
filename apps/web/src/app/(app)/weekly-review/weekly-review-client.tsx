'use client';

import Link from 'next/link';
import { ArrowRight, Check, TriangleAlert } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@friday/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface WeakConcept {
  conceptId: string;
  title?: string;
  mastery?: number;
  examWeight?: number;
}

interface Insight {
  id: string;
  type: string;
  title: string;
  body: string;
  severity?: string;
  conceptIds?: string[];
  createdAt?: string;
}

interface ProgressData {
  weightedProgress: number;
  rawProgress?: number;
  conceptsMastered: number;
  conceptsTotal: number;
  conceptsInProgress: number;
  conceptsNotStarted: number;
  verdict?: string;
  projectedCompletionDate?: string;
  daysRemaining?: number;
  velocity?: { trend: string; perWeek: number; requiredPerWeek: number };
  retentionHealth?: { dueNow: number; atRisk: number; overdue: number };
  adherence?: { last7d: number | null; last30d: number | null };
}

interface WeeklyReviewData {
  progressData?: ProgressData;
  weakConceptsData?: WeakConcept[];
  trendsData?: { weightedProgress: number; date: string }[];
  insightsData?: Insight[];
}

function severityVariant(severity?: string): 'warning' | 'neutral' | 'primary' {
  if (severity === 'high') return 'warning';
  if (severity === 'medium') return 'primary';
  return 'neutral';
}

export function WeeklyReviewClient({ data, goalId }: { data: WeeklyReviewData; goalId?: string }) {
  const router = useRouter();
  const [acknowledged, setAcknowledged] = useState(false);

  const progress = data.progressData;
  const insights = data.insightsData ?? [];
  const weakConcepts = data.weakConceptsData ?? [];

  const adherenceRate =
    progress?.adherence?.last7d !== null && progress?.adherence?.last7d !== undefined
      ? Math.round(progress.adherence.last7d * 100)
      : null;

  const progressPct = progress
    ? Math.round(progress.weightedProgress * 100)
    : null;

  return (
    <div className="space-y-6">
      {/* Where you improved, where you stand. */}
      {progress && (
        <Card>
          <CardHeader>
            <CardTitle>Where you stand</CardTitle>
            <CardDescription>
              Weighted by exam importance, adjusted for retention — not a count of finished tasks.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
              <Stat
                label="Mastered"
                value={`${progressPct ?? 0}%`}
              />
              <Stat
                label="Concepts mastered"
                value={`${progress.conceptsMastered} / ${progress.conceptsTotal}`}
              />
              <Stat
                label="In progress"
                value={String(progress.conceptsInProgress)}
              />
              {progress.daysRemaining !== undefined && (
                <Stat label="Days remaining" value={String(progress.daysRemaining)} />
              )}
              {progress.retentionHealth && (
                <Stat
                  label="Due for review"
                  value={String(progress.retentionHealth.dueNow)}
                />
              )}
              {adherenceRate !== null && (
                <Stat
                  label="Session adherence"
                  value={`${adherenceRate}%`}
                  hint="Over the last 7 days"
                />
              )}
            </div>

            {progress.velocity && progress.velocity.trend !== undefined && (
              <div className="mt-4 flex items-center gap-2 text-sm">
                <Badge
                  variant={
                    progress.velocity.trend === 'declining'
                      ? 'warning'
                      : 'success'
                  }
                >
                  {progress.velocity.trend === 'ahead'
                    ? 'Ahead of pace'
                    : progress.velocity.trend === 'on_pace'
                      ? 'On pace'
                      : 'Behind pace'}
                </Badge>
                <span className="text-muted-foreground">
                  {(progress.velocity.perWeek * 100).toFixed(1)}% per week ·{' '}
                  {(progress.velocity.requiredPerWeek * 100).toFixed(1)}% needed
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Key insights */}
      {insights.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>What FRIDAY noticed this week</CardTitle>
            <CardDescription>
              Observations from your session data — the signals that drove plan changes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {insights.map((insight) => (
              <div
                key={insight.id}
                className="flex gap-3 rounded-lg border border-border p-3"
              >
                {insight.severity === 'high' ? (
                  <TriangleAlert
                    className="mt-0.5 size-4 shrink-0 text-warning"
                    aria-hidden
                  />
                ) : (
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{insight.title}</p>
                    <Badge variant={severityVariant(insight.severity)}>
                      {insight.severity ?? 'info'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {insight.body}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Where you struggled — and where next week starts. */}
      {weakConcepts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>What struggled most</CardTitle>
            <CardDescription>
              Ranked by what it costs to leave them weak. Start next week here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {weakConcepts.map((wc) => {
                const mastery = Math.round((wc.mastery ?? 0) * 100);
                return (
                  <li
                    key={wc.conceptId}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {wc.title ?? `Concept ${wc.conceptId.slice(0, 8)}…`}
                      </p>
                      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                        <span>Mastery: {mastery}%</span>
                        {wc.examWeight !== undefined && (
                          <span>Exam weight: {Math.round(wc.examWeight * 100)}%</span>
                        )}
                      </div>
                    </div>
                    {goalId && (
                      <Button asChild variant="secondary" size="sm" className="shrink-0">
                        <Link
                          href={`/root-cause?goalId=${goalId}&weakConceptId=${wc.conceptId}`}
                        >
                          Follow the root cause
                          <ArrowRight className="ml-1 size-3.5" aria-hidden />
                        </Link>
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Acknowledge CTA */}
      <Card>
        <CardContent className="pt-6">
          <p className="mb-4 text-sm text-muted-foreground">
            Reviewing this summary completes your weekly check-in. FRIDAY will incorporate any
            plan changes before your next session.
          </p>
          <Button
            className="w-full"
            size="lg"
            onClick={() => {
              setAcknowledged(true);
              setTimeout(() => router.push('/dashboard'), 500);
            }}
            disabled={acknowledged}
          >
            {acknowledged ? (
              <>
                <Check className="mr-2 size-4" aria-hidden />
                Review acknowledged
              </>
            ) : (
              'Acknowledge and continue'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums text-foreground">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
