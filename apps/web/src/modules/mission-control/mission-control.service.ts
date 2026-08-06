import { daysOverdue, retrievability } from '@friday/core';
import { ApiError, type MissionControlResponse } from '@friday/contracts';
import {
  curriculumRepository,
  getDb,
  goalsRepository,
  memoryRepository,
  planningRepository,
  type UserRow,
} from '@friday/db';
import { getNextAction } from '../next-action/next-action.service';
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
export async function getMissionControl(
  user: UserRow,
  goalId: string,
  availableMinutes = DEFAULT_AVAILABLE_MINUTES,
): Promise<MissionControlResponse['data']> {
  const db = getDb();
  const goal = await goalsRepository(db).findById(user.id, goalId);
  if (!goal) throw ApiError.notFound();

  const plan = await planningRepository(db).findActive(user.id, goalId);
  const curriculum = await curriculumRepository(db).findByGoal(user.id, goalId);

  const today = todayKey();
  const todaysTasks = plan
    ? await planningRepository(db).listTasksInWindow(user.id, goalId, today, today)
    : [];
  const hydratedToday = await hydrateTasksWithConcepts(user.id, todaysTasks);
  const capacityToday =
    plan && todaysTasks.length > 0
      ? todaysTasks.reduce((sum, t) => sum + t.estimatedMinutes, 0)
      : 0;

  const nextAction = await getNextAction(user, goalId, availableMinutes);

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

  return {
    goalId,
    today: {
      date: today,
      capacityMinutes: capacityToday,
      plannedMinutes: todaysTasks.reduce((sum, t) => sum + t.estimatedMinutes, 0),
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
