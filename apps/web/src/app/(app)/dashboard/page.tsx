import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireOnboardedUser } from '@/lib/auth/server';
import { getAdaptiveProfile } from '@/modules/adaptive/adaptive.service';
import { listGoals } from '@/modules/curriculum/curriculum.service';
import { getMissionControl } from '@/modules/mission-control/mission-control.service';
import { ensurePlanFreshForToday } from '@/modules/planning/planning.service';
import { LiveIntelligencePanel } from '@/components/app/live-intelligence-panel';

export const metadata: Metadata = { title: 'Mission Control' };

/**
 * Mission Control — now a single Live Intelligence Panel.
 *
 * This page used to render two cards side by side: a next action, and a list of
 * today's tasks with a risks card beside it. Everything on it was correct and
 * none of it read as intelligence — it looked like a planner, because a grid of
 * task lists is what a planner looks like. The reasoning existed but was folded
 * behind a disclosure.
 *
 * The data is unchanged. Only what the screen leads with has changed: what the
 * system observed, what it decided, and the one thing to do now.
 */
export default async function DashboardPage() {
  const user = await requireOnboardedUser();
  const firstName = user.displayName.split(' ')[0] ?? user.displayName;

  const goals = await listGoals(user);
  const goal = goals.find((g) => g.status === 'active') ?? goals[0];

  // A learner with no goal has nothing to see here — send them to build one
  // rather than showing an empty shell they have to work out how to escape.
  if (!goal) redirect('/onboarding/availability');

  // First open of a new day: yesterday's unfinished work is still sitting on
  // yesterday's date until the window is re-derived. Returns immediately on
  // every visit after the first.
  await ensurePlanFreshForToday(user, goal.id);

  const profile = await getAdaptiveProfile(user);

  /**
   * The adaptive dials are *applied*, not just displayed.
   *
   * Without this line the panel announces "shortened sessions to about 10
   * minutes" directly above a 50-minute recommendation — the system contradicting
   * itself in the same screenful, which is worse than never having claimed to
   * adapt. Passing the target as the time budget makes the claim true: the
   * engine ranks and fits against it.
   *
   * `unknown` deliberately passes `undefined` so the service keeps its own
   * default. Adapting the budget for a learner the engine admits it cannot read
   * would contradict the restraint the rest of this feature is built on.
   */
  const mission = await getMissionControl(
    user,
    goal.id,
    profile.band === 'unknown' ? undefined : profile.targetSessionMinutes,
  );
  const { action, why } = mission.nextAction;

  /**
   * Is the recommendation one of today's scheduled tasks?
   *
   * The Next Action is ranked across the whole horizon while Today is the
   * materialised schedule, so a change in exam weight or decay can promote
   * something the schedule had put later. The old layout showed both lists and
   * left the learner to notice the discrepancy; the panel shows one action, so
   * the count below simply excludes it.
   */
  const remainingToday = mission.today.tasks.filter(
    (t) => t.status !== 'completed' && t.id !== action?.taskId,
  ).length;

  return (
    <LiveIntelligencePanel
      firstName={firstName}
      goalTitle={goal.title}
      daysRemaining={mission.progress.daysRemaining}
      profile={profile}
      risks={mission.risks.map((r) => ({
        id: r.id,
        severity: r.severity,
        title: r.title,
        detail: r.detail,
      }))}
      action={
        action
          ? {
              taskId: action.taskId,
              title: action.title,
              estimatedMinutes: action.estimatedMinutes,
              rationale: action.rationale,
              why: why
                ? {
                    priorityScore: why.priorityScore,
                    factors: why.factors,
                    dominantFactor: why.dominantFactor,
                    confidence: why.confidence,
                  }
                : null,
            }
          : null
      }
      remainingToday={remainingToday}
    />
  );
}
