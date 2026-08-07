import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarDays } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Callout,
  EmptyState,
} from '@friday/ui';
import { requireOnboardedUser } from '@/lib/auth/server';
import { listGoals } from '@/modules/curriculum/curriculum.service';
import { getSchedule, hydrateTasksWithConcepts } from '@/modules/planning/planning.service';
import { RegeneratePlanButton } from '@/components/planning/regenerate-plan-button';

export const metadata: Metadata = { title: 'Plan' };

const TYPE_TONE: Record<string, 'primary' | 'success' | 'neutral'> = {
  learn: 'primary',
  revise: 'success',
  practice: 'neutral',
};

function formatDay(date: string): { weekday: string; label: string; isToday: boolean } {
  const today = new Date().toISOString().slice(0, 10);
  const d = new Date(`${date}T00:00:00Z`);
  return {
    weekday: d.toLocaleDateString('en', { weekday: 'long', timeZone: 'UTC' }),
    label: d.toLocaleDateString('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    isToday: date === today,
  };
}

export default async function PlanPage() {
  const user = await requireOnboardedUser();
  const goals = await listGoals(user);
  const goal = goals.find((g) => g.status === 'active') ?? goals[0];
  if (!goal) redirect('/onboarding/availability');

  let plan;
  let tasks;
  try {
    const schedule = await getSchedule(user, goal.id);
    plan = schedule.plan;
    tasks = await hydrateTasksWithConcepts(user.id, schedule.tasks);
  } catch {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Plan</h1>
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={<CalendarDays className="size-8" />}
              title="No plan yet"
              description="Generate a plan to see your schedule."
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const byDate = new Map<string, typeof tasks>();
  for (const item of tasks) {
    const list = byDate.get(item.task.scheduledDate) ?? [];
    list.push(item);
    byDate.set(item.task.scheduledDate, list);
  }
  const days = [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1));

  const projection = (plan.projection ?? []) as {
    week: string;
    conceptIds: string[];
    plannedMinutes: number;
  }[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Plan</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {goal.title} · version {plan.version} · {plan.windowStart} to {plan.windowEnd}
          </p>
        </div>
        <RegeneratePlanButton goalId={goal.id} />
      </div>

      {/* §4.3: a plan version materialises 14 days and projects the rest. Saying
          so plainly prevents the reasonable assumption that the rest is missing. */}
      <Callout tone="info" title="Why only two weeks?">
        FRIDAY schedules the next fortnight in detail and keeps everything beyond it as a coarse
        projection. Planning day 217 to the minute would be false precision — it rolls forward as
        you go.
      </Callout>

      {days.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={<CalendarDays className="size-8" />}
              title="Nothing scheduled in this window"
              description="Regenerate the plan, or add study hours in settings."
            />
          </CardContent>
        </Card>
      ) : (
        <ol className="space-y-4">
          {days.map(([date, items]) => {
            const { weekday, label, isToday } = formatDay(date);
            const minutes = items.reduce((s, i) => s + i.task.estimatedMinutes, 0);
            return (
              <li key={date}>
                <Card className={isToday ? 'border-primary/40' : undefined}>
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="text-base">
                        {weekday} {label}
                        {isToday ? (
                          <Badge variant="primary" className="ml-2">
                            Today
                          </Badge>
                        ) : null}
                      </CardTitle>
                      <span className="text-sm text-muted-foreground">{minutes} min</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ul className="divide-y divide-border">
                      {items.map(({ task, concepts }) => (
                        <li
                          key={task.id}
                          className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={TYPE_TONE[task.type] ?? 'neutral'}>{task.type}</Badge>
                              <span className="truncate text-sm font-medium">{task.title}</span>
                              {task.status === 'completed' ? (
                                <Badge variant="success">done</Badge>
                              ) : null}
                              {task.status === 'skipped' ? (
                                <Badge variant="outline">skipped</Badge>
                              ) : null}
                            </div>
                            {concepts.length > 0 ? (
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                {concepts.map((c) => c.title).join(', ')}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <span className="text-xs text-muted-foreground">
                              {task.estimatedMinutes} min
                            </span>
                            {task.status === 'pending' ? (
                              <Button size="sm" variant="secondary" asChild>
                                <Link href={`/study/${task.id}`}>Study</Link>
                              </Button>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>
      )}

      {projection.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Beyond the window</CardTitle>
            <CardDescription>
              Week-level projection to your target date. It becomes a real schedule as the window
              rolls forward.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {projection.slice(0, 12).map((week) => (
                <li key={week.week} className="flex items-center justify-between gap-3 py-2">
                  <span className="font-mono text-xs">{week.week}</span>
                  <span className="text-muted-foreground">
                    {week.conceptIds.length} concept{week.conceptIds.length === 1 ? '' : 's'} ·{' '}
                    {week.plannedMinutes} min
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
