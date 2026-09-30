import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarDays, Info, PlayCircle } from 'lucide-react';
import { Button, EmptyState } from '@friday/ui';
import { PageHeader } from '@friday/ui';
import { requireOnboardedUser } from '@/lib/auth/server';
import { getAdaptiveProfile } from '@/modules/adaptive/adaptive.service';
import { listGoals } from '@/modules/curriculum/curriculum.service';
import { getSchedule, hydrateTasksWithConcepts } from '@/modules/planning/planning.service';
import { RegeneratePlanButton } from '@/components/planning/regenerate-plan-button';
import { AdaptationCard } from '@/components/friday/intelligence';

export const metadata: Metadata = { title: 'Plan' };

const TYPE_TONE: Record<string, string> = {
  learn: 'text-primary bg-primary/10 border-primary/20',
  revise: 'text-success bg-success/10 border-success/20',
  practice: 'text-muted-foreground bg-muted border-border',
};

function formatDay(date: string): { weekday: string; label: string; isToday: boolean; isPast: boolean } {
  const today = new Date().toISOString().slice(0, 10);
  const d = new Date(`${date}T00:00:00Z`);
  return {
    weekday: d.toLocaleDateString('en', { weekday: 'long', timeZone: 'UTC' }),
    label: d.toLocaleDateString('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    isToday: date === today,
    isPast: date < today,
  };
}

export default async function PlanPage() {
  const user = await requireOnboardedUser();
  const goals = await listGoals(user);
  const goal = goals.find((g) => g.status === 'active') ?? goals[0];
  if (!goal) redirect('/onboarding/availability');

  let plan;
  let tasks;
  let profile;
  try {
    const [scheduleResult, profileResult] = await Promise.all([
      getSchedule(user, goal.id),
      getAdaptiveProfile(user),
    ]);
    plan = scheduleResult.plan;
    tasks = await hydrateTasksWithConcepts(user.id, scheduleResult.tasks);
    profile = profileResult;
  } catch {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Your study schedule"
          description="What FRIDAY planned for you, and why it changed."
        />
        <EmptyState
          icon={<CalendarDays className="size-8" />}
          title="No plan yet"
          description="Generate a plan to see your adaptive schedule."
        />
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

  const diffSummary = plan.diffSummary as {
    rescheduledCount?: number;
    capacityBefore?: number;
    capacityAfter?: number;
    reasoning?: string;
  } | null;

  const projection = (plan.projection ?? []) as {
    week: string;
    conceptIds: string[];
    plannedMinutes: number;
  }[];

  const sizingNote =
    profile.band === 'struggling'
      ? `Adjusting to keep you moving. Sessions are currently sized to ${profile.targetSessionMinutes} minutes to build momentum.`
      : profile.band === 'thriving'
        ? `Pushing you harder. Sessions are currently sized to ${profile.targetSessionMinutes} minutes because you have room.`
        : `Holding your plan steady. Sessions are currently sized to ${profile.targetSessionMinutes} minutes based on your pace.`;

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow={goal.title}
        title="Your study schedule"
        description={`Detailed for ${plan.windowStart} to ${plan.windowEnd}. FRIDAY keeps the next fortnight precise and everything beyond it as a rough outline.`}
        actions={<RegeneratePlanButton goalId={goal.id} />}
      />

      {/* What FRIDAY changed — before → now + reason. */}
      {(diffSummary?.rescheduledCount || profile.band !== 'unknown') && (
        <div className="space-y-3">
          {diffSummary?.rescheduledCount ? (
            <AdaptationCard
              statement={`FRIDAY rescheduled ${diffSummary.rescheduledCount} task${diffSummary.rescheduledCount === 1 ? '' : 's'} to protect exam-critical work.`}
              before={
                diffSummary.capacityBefore != null
                  ? `${diffSummary.capacityBefore}h available`
                  : undefined
              }
              now={
                diffSummary.capacityAfter != null
                  ? `${diffSummary.capacityAfter}h available`
                  : undefined
              }
              reason={
                diffSummary.reasoning ??
                'Preserve exam-weighted work while keeping workload feasible.'
              }
            />
          ) : null}
          {profile.band !== 'unknown' && (
            <p className="rounded-xl border border-border bg-surface px-5 py-4 text-sm leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Session sizing — </span>
              {sizingNote}
            </p>
          )}
        </div>
      )}

      <section aria-label="Upcoming schedule">
        {days.length === 0 ? (
          <EmptyState
            title="Nothing scheduled in this window"
            description="Regenerate the plan, or add study hours in settings so FRIDAY has time to work with."
          />
        ) : (
          <ol className="relative space-y-10 before:absolute before:inset-y-0 before:left-4 before:w-px before:bg-border md:before:left-1/2">
            {days.map(([date, dateTasks]) => {
              const { weekday, label, isToday, isPast } = formatDay(date);

              if (isPast) return null; // Hide past schedules completely to reduce anxiety.

              return (
                <li key={date} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse">
                  {/* Timeline dot */}
                  <div
                    className={`absolute left-4 h-3 w-3 -translate-x-1/2 rounded-full border-2 md:left-1/2 ${isToday ? 'border-background bg-primary' : 'border-border bg-surface'}`}
                    aria-hidden
                  />

                  <div className="w-full pl-12 md:w-5/12 md:pl-0 md:group-odd:text-right">
                    <div className="mb-3">
                      <p className={`text-sm font-bold ${isToday ? 'text-primary' : 'text-foreground'}`}>
                        {isToday ? 'TODAY' : weekday.toUpperCase()}
                      </p>
                      <p className="text-xs text-muted-foreground">{label}</p>
                    </div>

                    <div className="space-y-3">
                      {dateTasks.map((item) => (
                        <article
                          key={item.task.id}
                          className={`rounded-xl border bg-surface-raised p-4 transition-colors hover:border-border-strong ${item.task.status === 'completed' ? 'opacity-60' : 'border-border'}`}
                        >
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                            <span
                              className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${TYPE_TONE[item.task.type] ?? TYPE_TONE.practice}`}
                            >
                              {item.task.type}
                            </span>
                            <span className="shrink-0 rounded-md bg-background px-2 py-1 text-xs font-medium tabular-nums text-muted-foreground">
                              {item.task.estimatedMinutes} min
                            </span>
                          </div>

                          <h3 className="mb-1 truncate text-sm font-semibold text-foreground" title={item.task.title}>
                            {item.task.title}
                          </h3>

                          {item.task.status === 'completed' ? (
                            <p className="mt-3 text-xs font-semibold text-success">Completed</p>
                          ) : (
                            <div className="mt-4 flex justify-end border-t border-border pt-4">
                              <Button asChild variant="secondary" size="sm">
                                <Link href={`/study/${item.task.id}`} prefetch>
                                  <PlayCircle className="mr-1.5 size-3.5" aria-hidden /> Start
                                </Link>
                              </Button>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {projection.length > 0 && (
        <section aria-label="Beyond this window" className="space-y-4 border-t border-border pt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Beyond this window
          </h2>
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Week commencing</th>
                  <th scope="col" className="px-4 py-3 font-medium">Focus</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Budget</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {projection.slice(0, 12).map((week) => (
                  <tr key={week.week}>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{week.week}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {week.conceptIds.length} concept{week.conceptIds.length === 1 ? '' : 's'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {Math.round(week.plannedMinutes / 60)}h
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="pt-4 text-center">
        <p className="mb-2 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Info className="size-3.5" aria-hidden /> Why only two weeks?
        </p>
        <p className="mx-auto max-w-lg text-xs leading-relaxed text-subtle-foreground">
          FRIDAY schedules the next fortnight in detail and keeps everything beyond it as a
          coarse projection. Planning day 217 to the minute would be false precision.
        </p>
      </div>
    </div>
  );
}
