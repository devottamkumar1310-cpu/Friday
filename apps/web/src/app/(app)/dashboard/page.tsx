import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertTriangle, Target } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from '@friday/ui';
import { requireOnboardedUser } from '@/lib/auth/server';
import { listGoals } from '@/modules/curriculum/curriculum.service';
import { getMissionControl } from '@/modules/mission-control/mission-control.service';
import { WhyThis } from '@/components/progress/why-this';

export const metadata: Metadata = { title: 'Mission Control' };

/**
 * Mission Control.
 *
 * Phase 1 built the deterministic engine and its API; this renders it, and
 * carries roadmap 2.10 — the "why this?" factor breakdown — on the Next Action
 * card, which is the only place it means anything.
 */
export default async function DashboardPage() {
  const user = await requireOnboardedUser();
  const firstName = user.displayName.split(' ')[0] ?? user.displayName;

  const goals = await listGoals(user);
  const goal = goals.find((g) => g.status === 'active') ?? goals[0];

  // A learner with no goal has nothing to see here — send them to build one
  // rather than showing an empty shell they have to work out how to escape.
  if (!goal) redirect('/onboarding/availability?next=goal');

  const mission = await getMissionControl(user, goal.id);
  const { action, why } = mission.nextAction;

  return (
    <div className="space-y-6">
      <Header
        firstName={firstName}
        subtitle={`${goal.title} · ${mission.progress.daysRemaining} days remaining`}
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Next action</CardTitle>
            {action ? <Badge variant="outline">{action.estimatedMinutes} min</Badge> : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {action ? (
            <>
              <div>
                <p className="text-lg font-medium">{action.title}</p>
                {/* The rationale is rendered from the live factor table by a
                    deterministic template — never stored prose, never an LLM
                    (AI_DECISION_ENGINE §12.2). */}
                <p className="mt-1 text-sm text-muted-foreground">{action.rationale}</p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button asChild>
                  <Link href={`/study/${action.taskId}`}>Start this now</Link>
                </Button>
                <Button variant="ghost" asChild>
                  <Link href="/plan">See the full plan</Link>
                </Button>
              </div>

              {why ? (
                <details className="group rounded-md border border-border">
                  <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium marker:content-none">
                    Why this?
                    <span className="ml-2 text-xs text-muted-foreground group-open:hidden">
                      show
                    </span>
                    <span className="ml-2 hidden text-xs text-muted-foreground group-open:inline">
                      hide
                    </span>
                  </summary>
                  <div className="border-t border-border px-3 py-3">
                    <WhyThis
                      priorityScore={why.priorityScore}
                      factors={why.factors}
                      dominantFactor={why.dominantFactor}
                      confidence={why.confidence}
                    />
                  </div>
                </details>
              ) : null}
            </>
          ) : (
            <EmptyState
              icon={<Target className="size-8" />}
              title="Nothing scheduled right now"
              description="No task fits the current window. Regenerate the plan, or come back with more time."
            />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Today</CardTitle>
            <CardDescription>
              {mission.today.tasks.length} task{mission.today.tasks.length === 1 ? '' : 's'} ·{' '}
              {mission.today.plannedMinutes} min planned
            </CardDescription>
          </CardHeader>
          <CardContent>
            {mission.today.tasks.length > 0 ? (
              <ul className="divide-y divide-border text-sm">
                {mission.today.tasks.map((task) => (
                  <li key={task.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="truncate">{task.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {task.estimatedMinutes} min
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing scheduled for today.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Risks</CardTitle>
            <CardDescription>
              <Link href="/progress" className="underline underline-offset-2">
                See full progress
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {mission.risks.length > 0 ? (
              <ul className="space-y-3">
                {mission.risks.map((risk) => (
                  <li key={risk.id} className="flex gap-2.5">
                    <AlertTriangle
                      className={
                        risk.severity === 'high'
                          ? 'mt-0.5 size-4 shrink-0 text-destructive'
                          : 'mt-0.5 size-4 shrink-0 text-warning'
                      }
                      aria-hidden
                    />
                    <div>
                      <p className="text-sm font-medium">{risk.title}</p>
                      <p className="text-xs text-muted-foreground">{risk.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing needs your attention.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Header({ firstName, subtitle }: { firstName: string; subtitle: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Good to see you, {firstName}.</h1>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}
