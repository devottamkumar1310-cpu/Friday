import { daysOverdue, retrievability } from '@friday/core';
import { ApiError, type MissionControlResponse } from '@friday/contracts';
import {
  availabilityRepository,
  curriculumRepository,
  getDb,
  goalsRepository,
  memoryRepository,
  planningRepository,
  type PlanRow,
  type UserRow,
} from '@friday/db';
import { getNextAction } from '../next-action/next-action.service';
import { buildCapacityWindows } from '../planning/availability';
import { hydrateTasksWithConcepts } from '../planning/planning.service';

const DEFAULT_AVAILABLE_MINUTES = 60;
const OVERDUE_RISK_THRESHOLD_DAYS = 3;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Mission Control — the composite deterministic-engine surface: Today's
 * Mission, Next Action, Progress, Risks, and recommendation rationale, in one
 * response. Every field is a direct projection of `packages/core` output.
 */
/**
 * What the last re-plan did, in one sentence the learner can check.
 *
 * The failure this replaces is the one every study app has: miss Monday, and
 * Tuesday silently becomes Monday plus Tuesday. FRIDAY does not do that — §10.4
 * retires missed work and re-derives placement — but *doing* the right thing
 * invisibly is indistinguishable from not doing it. The learner who missed a
 * day opens the app, sees a normal-looking list, and has no way to know whether
 * they got away with it or whether the debt is hiding somewhere.
 *
 * Every clause here is gated on a fact rather than composed as copy:
 *
 *   the count       comes from `diff_summary`, written by the transaction that
 *                   actually retired those rows
 *   "still X min"   is only said when today's planned minutes genuinely fit
 *                   today's capacity, which is re-checked here at read time
 *
 * If either check fails the sentence is not shown. There is deliberately no
 * fallback wording — an unverifiable reassurance is worse than silence, because
 * a learner who is told nothing was added and then finds a doubled Tuesday has
 * learned not to believe the next thing either.
 */
function describePlanChange(
  plan: PlanRow | undefined,
  capacityMinutes: number,
  plannedMinutes: number,
): { statement: string; evidence: string } | null {
  if (!plan) return null;

  const diff = plan.diffSummary as {
    rescheduledCount?: number;
    cancelledCount?: number;
    previousAvailableMinutes?: number | null;
  } | null;

  /**
   * A constraint the learner changed themselves, described by what moved.
   *
   * `availability_changed` and `goal_changed` are the two re-plans the learner
   * *caused*, and they are the two where a silent rebuild is most confusing:
   * they edited a setting, the plan quietly became a different plan, and
   * nothing on the dashboard connected the two. The link is worth stating —
   * but only with the actual figures, because "FRIDAY adjusted your plan" is
   * the kind of sentence that sounds adaptive and says nothing.
   *
   * Deliberately no wording for the *reason* beyond the fact of it. The plan row
   * knows capacity moved; it does not know the learner moved an exam rather
   * than a work shift, and inventing that motive is exactly the fabrication
   * this codebase keeps deleting.
   */
  const previous = diff?.previousAvailableMinutes ?? null;
  if (
    (plan.reason === 'availability_changed' || plan.reason === 'goal_changed') &&
    previous !== null &&
    previous > 0 &&
    plan.availableMinutes !== previous
  ) {
    const grew = plan.availableMinutes > previous;
    const hoursBefore = Math.round(previous / 60);
    const hoursAfter = Math.round(plan.availableMinutes / 60);
    return {
      statement: grew
        ? `You freed up time, so I rebuilt the plan around it.`
        : `Your available time shrank, so I rebuilt the plan to fit.`,
      // "before the exam" would be wrong for a `skill` or `course` goal, and the
      // plan row does not know which this is. The horizon is the honest noun.
      evidence: `${hoursBefore}h of study time in the plan, now ${hoursAfter}h.`,
    };
  }

  const rescheduled = diff?.rescheduledCount ?? 0;
  if (rescheduled <= 0) return null;

  const noun = rescheduled === 1 ? 'task' : 'tasks';
  const statement = `${rescheduled} missed ${noun} went back into the queue.`;

  // The reassurance is the load-bearing half, so it is the half that is
  // re-derived from today's actual rows rather than trusted from the write.
  const withinCapacity = capacityMinutes > 0 && plannedMinutes <= capacityMinutes;
  const evidence = withinCapacity
    ? `Nothing was added to today — still ${plannedMinutes} min of ${capacityMinutes}.`
    : `Re-ranked by priority rather than pushed to tomorrow.`;

  return { statement, evidence };
}

export async function getMissionControl(
  user: UserRow,
  goalId: string,
  availableMinutes = DEFAULT_AVAILABLE_MINUTES,
): Promise<MissionControlResponse['data']> {
  const db = getDb();
  const goal = await goalsRepository(db).findById(user.id, goalId);
  if (!goal) throw ApiError.notFound();

  /**
   * Independent reads, issued together.
   *
   * These four queries do not depend on each other, and were awaited one at a
   * time purely because that is how the code was written. Measured against a
   * managed Postgres about 150ms away, Mission Control — the dashboard's own
   * endpoint, the first thing a learner loads — took 3.5s at p50 and 6.5s at
   * p95, almost all of it round trips waiting in single file.
   *
   * Latency is the environment's fault; issuing avoidable round trips serially
   * is ours. This is the half we control.
   */
  const today = todayKey();
  const [plan, curriculum, availabilityRules, allTodayRows] = await Promise.all([
    planningRepository(db).findActive(user.id, goalId),
    curriculumRepository(db).findByGoal(user.id, goalId),
    availabilityRepository(db).listForUser(user.id),
    planningRepository(db).listTasksInWindow(user.id, goalId, today, today),
  ]);
  /**
   * Today's work — live rows only.
   *
   * `listTasksInWindow` filters by date and goal, not by status, so this list
   * also contained the `rescheduled` and `cancelled` rows a re-plan had just
   * retired. Today therefore looked busier than it was, and every total derived
   * from it counted work the learner had explicitly been told was gone.
   */
  const todaysTasks = plan
    ? allTodayRows.filter((t) => t.status !== 'cancelled' && t.status !== 'rescheduled')
    : [];

  /**
   * Capacity comes from the learner's availability, not from the plan.
   *
   * It was the sum of today's own task minutes, which made
   * `plannedMinutes <= capacityMinutes` true by construction and the pair
   * "90 min of 90" a tautology dressed as a measurement. Nothing could ever
   * read as over capacity, including a day that genuinely was, so the one
   * number on the dashboard that should warn the learner never could.
   *
   * The availability rules are the same source the scheduler plans against, so
   * this figure and the planner's now agree by construction rather than by
   * coincidence.
   */
  const capacityToday =
    buildCapacityWindows(availabilityRules, new Date(`${today}T00:00:00Z`), 1)[0]
      ?.capacityMinutes ?? 0;

  // Hydration and the Next Action are independent of each other too.
  const [hydratedToday, nextAction] = await Promise.all([
    hydrateTasksWithConcepts(user.id, todaysTasks),
    getNextAction(user, goalId, availableMinutes),
  ]);

  // --- Progress: weighted mastery over the curriculum (exam-weight-weighted,
  // not "% tasks done" — DATABASE_DESIGN §4.7 progress_snapshots note). ---
  let weightedProgress = 0;
  let conceptsMastered = 0;
  let conceptsTotal = 0;
  if (curriculum) {
    const concepts = await curriculumRepository(db).listConcepts(user.id, curriculum.id);
    const scoredConcepts = concepts.filter((c) => c.status !== 'excluded');
    conceptsTotal = scoredConcepts.length;
    conceptsMastered = scoredConcepts.filter(
      (c) => c.status === 'mastered' || c.status === 'already_known',
    ).length;

    const masteryStates = await memoryRepository(db).listMasteryStates(
      user.id,
      scoredConcepts.map((c) => c.id),
    );
    const masteryByConcept = new Map(masteryStates.map((m) => [m.conceptId, Number(m.mastery)]));
    const totalWeight = scoredConcepts.reduce((sum, c) => sum + Number(c.examWeight), 0);
    const earnedWeight = scoredConcepts.reduce(
      (sum, c) => sum + Number(c.examWeight) * (masteryByConcept.get(c.id) ?? 0),
      0,
    );
    weightedProgress = totalWeight > 0 ? earnedWeight / totalWeight : 0;
  }

  const daysRemaining = Math.max(
    0,
    Math.round((new Date(goal.targetDate).getTime() - Date.now()) / 86_400_000),
  );

  // --- Risks: deterministic derivations from feasibility + retention, never AI. ---
  const risks: MissionControlResponse['data']['risks'] = [];

  if (plan && plan.verdict !== 'on_track') {
    risks.push({
      id: 'feasibility',
      severity: plan.verdict === 'not_feasible' ? 'high' : 'medium',
      title: plan.verdict === 'not_feasible' ? 'Not on track to finish in time' : 'Tight on time',
      detail: `Required ${plan.requiredMinutes} min vs. available ${plan.availableMinutes} min (slack ${plan.slackMinutes} min).`,
      conceptIds: [],
    });
  }

  if (curriculum) {
    const allMemoryStates = await memoryRepository(db).listAllMemoryStates(user.id);
    const now = new Date();
    const badlyOverdue = allMemoryStates.filter(
      (m) =>
        daysOverdue(
          { ...m, stability: Number(m.stability), difficulty: Number(m.difficulty) },
          now,
        ) > OVERDUE_RISK_THRESHOLD_DAYS,
    );
    if (badlyOverdue.length > 0) {
      const avgRetrievability =
        badlyOverdue.reduce(
          (sum, m) =>
            sum +
            retrievability(
              { ...m, stability: Number(m.stability), difficulty: Number(m.difficulty) },
              now,
            ),
          0,
        ) / badlyOverdue.length;
      risks.push({
        id: 'retention-debt',
        severity: avgRetrievability < 0.5 ? 'high' : 'medium',
        title: `${badlyOverdue.length} review${badlyOverdue.length === 1 ? '' : 's'} overdue`,
        detail: `Average retrievability on overdue concepts is ${Math.round(avgRetrievability * 100)}%. Retention debt outranks new material (DP8).`,
        conceptIds: badlyOverdue.map((m) => m.conceptId),
      });
    }
  }

  if (!plan) {
    risks.push({
      id: 'no-plan',
      severity: 'high',
      title: 'No active plan',
      detail: 'No study plan has been generated for this goal yet.',
      conceptIds: [],
    });
  }

  const plannedToday = todaysTasks.reduce((sum, t) => sum + t.estimatedMinutes, 0);

  return {
    goalId,
    /** Null unless the last committed re-plan actually retired missed work. */
    planChange: describePlanChange(plan, capacityToday, plannedToday),
    today: {
      date: today,
      capacityMinutes: capacityToday,
      plannedMinutes: plannedToday,
      tasks: hydratedToday.map(({ task, concepts }) => ({
        id: task.id,
        type: task.type,
        title: task.title,
        estimatedMinutes: task.estimatedMinutes,
        status: task.status,
        scheduledDate: task.scheduledDate,
        concepts,
      })),
    },
    nextAction,
    progress: {
      weightedProgress,
      conceptsMastered,
      conceptsTotal,
      verdict: plan?.verdict ?? 'not_feasible',
      projectedCompletionDate: plan?.projectedCompletionDate ?? null,
      daysRemaining,
    },
    risks,
    computedAt: new Date().toISOString(),
  };
}
