import { CalendarPlus, Clock, Scissors } from 'lucide-react';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@friday/ui';

/**
 * Feasibility verdict and remediation options — roadmap 2.3.
 *
 * Three levers, **always presented together, never chosen between**
 * (AI_DECISION_ENGINE §9.3): extend the deadline, add hours, or cut scope. The
 * engine computes what each would do to the arithmetic; which one is acceptable
 * is a decision about the learner's life, not their curriculum.
 *
 * The verdict copy states the numbers plainly. Per DP6 bad news is arithmetic,
 * not judgement — there is no encouragement here standing in for information.
 */

export interface RemediationOption {
  type: 'increase_hours' | 'reduce_scope' | 'extend_deadline';
  detail: string;
  impact: { verdict: string; slackPercent?: number };
}

export interface FeasibilityView {
  verdict: 'on_track' | 'at_risk' | 'not_feasible';
  requiredMinutes: number;
  availableMinutes: number;
  slackMinutes: number;
  slackPercent: number;
  projectedCompletionDate: string | null;
  confidenceIntervalDays: number;
  remediationOptions: RemediationOption[];
}

const VERDICT_COPY: Record<
  FeasibilityView['verdict'],
  { label: string; variant: 'success' | 'warning' | 'destructive' }
> = {
  on_track: { label: 'On track', variant: 'success' },
  at_risk: { label: 'At risk', variant: 'warning' },
  not_feasible: { label: 'Not feasible', variant: 'destructive' },
};

const OPTION_META: Record<RemediationOption['type'], { title: string; icon: React.ReactNode }> = {
  extend_deadline: { title: 'Extend the deadline', icon: <CalendarPlus className="size-4" /> },
  increase_hours: { title: 'Add study hours', icon: <Clock className="size-4" /> },
  reduce_scope: { title: 'Reduce scope', icon: <Scissors className="size-4" /> },
};

function hours(minutes: number): string {
  return `${Math.round(minutes / 60).toLocaleString()} h`;
}

export function FeasibilityRemediation({ feasibility }: { feasibility: FeasibilityView }) {
  const verdict = VERDICT_COPY[feasibility.verdict];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Will you finish in time?</CardTitle>
          <Badge variant={verdict.variant}>{verdict.label}</Badge>
        </div>
        <CardDescription>
          You need {hours(feasibility.requiredMinutes)} and have{' '}
          {hours(feasibility.availableMinutes)} available
          {feasibility.slackMinutes >= 0
            ? ` — ${hours(feasibility.slackMinutes)} of buffer (${feasibility.slackPercent.toFixed(1)}%).`
            : ` — short by ${hours(Math.abs(feasibility.slackMinutes))}.`}
          {feasibility.projectedCompletionDate
            ? ` At your observed pace you finish around ${feasibility.projectedCompletionDate}` +
              (feasibility.confidenceIntervalDays > 0
                ? ` ± ${feasibility.confidenceIntervalDays} days.`
                : '.')
            : ''}
        </CardDescription>
      </CardHeader>

      {feasibility.remediationOptions.length > 0 ? (
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Three ways to close the gap. FRIDAY will not pick for you — the right trade-off depends
            on things it cannot see.
          </p>

          <ul className="grid gap-3 sm:grid-cols-3">
            {feasibility.remediationOptions.map((option) => {
              const meta = OPTION_META[option.type];
              return (
                <li key={option.type} className="rounded-md border border-border p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {meta.icon}
                    {meta.title}
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">{option.detail}</p>
                  <p className="mt-2 text-[11px] text-subtle-foreground">
                    Would move you to <span className="font-medium">{option.impact.verdict}</span>
                    {option.impact.slackPercent !== undefined
                      ? ` (${option.impact.slackPercent.toFixed(1)}% buffer)`
                      : ''}
                    .
                  </p>
                </li>
              );
            })}
          </ul>
        </CardContent>
      ) : null}
    </Card>
  );
}
