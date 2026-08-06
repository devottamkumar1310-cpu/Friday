import type { CoachExecutors } from '@friday/ai';
import { daysOverdue } from '@friday/core';
import {
  curriculumRepository,
  executionRepository,
  getDb,
  goalsRepository,
  memoryRepository,
  planningRepository,
  type UserRow,
} from '@friday/db';
import { getNextAction } from '../next-action/next-action.service';
import { getProgress, getWeakConcepts } from '../intelligence/intelligence.service';
import { toCoreMemoryState } from '../shared/mappers';

/**
 * Tool executors — ADR-017, roadmap 2.5.
 *
 * `packages/ai` declares the tool schemas; this supplies the implementations.
 * Every executor takes `userId` as its first argument and passes it to a
 * user-scoped repository, so a tool cannot reach another learner's data even if
 * the model asks it to (NFR-3.3).
 *
 * Note what these do *not* do: none of them computes a recommendation or a
 * score. `get_next_action` calls the deterministic engine and reports what it
 * returned. The model observes the decision; it never makes one (DP1).
 */
export function buildCoachExecutors(user: UserRow, goalId: string | null): CoachExecutors {
  const db = getDb();

  const requireGoal = (): string => {
    if (!goalId) throw new Error('No active goal for this thread.');
    return goalId;
  };

  return {
    getGoalStatus: async () => {
      const id = requireGoal();
      const goal = await goalsRepository(db).findById(user.id, id);
      if (!goal) throw new Error('Goal not found.');
      const progress = await getProgress(user, id);
      return {
        title: goal.title,
        targetDate: goal.targetDate,
        daysRemaining: progress.daysRemaining,
        weightedProgress: progress.weightedProgress,
        verdict: progress.verdict,
        projectedCompletionDate: progress.projectedCompletionDate,
      };
    },

    getPlan: async (_userId, args) => {
      const id = requireGoal();
      const plan = await planningRepository(db).findActive(user.id, id);
      if (!plan) return { planVersion: 0, tasks: [] };
      const tasks = await planningRepository(db).listTasksInWindow(user.id, id, args.from, args.to);
      return {
        planVersion: plan.version,
        tasks: tasks.map((t) => ({
          title: t.title,
          type: t.type,
          scheduledDate: t.scheduledDate,
          estimatedMinutes: t.estimatedMinutes,
          status: t.status,
        })),
      };
    },

    getMastery: async (_userId, args) => {
      const id = requireGoal();
      const curriculum = await curriculumRepository(db).findByGoal(user.id, id);
      if (!curriculum) return { concepts: [] };

      const concepts = args.conceptIds
        ? await curriculumRepository(db).findConceptsByIds(user.id, args.conceptIds)
        : await curriculumRepository(db).listConcepts(user.id, curriculum.id);

      const states = await memoryRepository(db).listMasteryStates(
        user.id,
        concepts.map((c) => c.id),
      );
      const byConcept = new Map(states.map((s) => [s.conceptId, s]));

      return {
        concepts: concepts.map((c) => ({
          id: c.id,
          title: c.title,
          mastery: Number(byConcept.get(c.id)?.mastery ?? 0),
        })),
      };
    },

    getWeakConcepts: async (_userId, args) => {
      const weak = await getWeakConcepts(user, requireGoal(), args.limit);
      return {
        concepts: weak.map((w) => ({
          id: w.conceptId,
          title: w.title,
          mastery: w.mastery,
          examWeight: w.examWeight,
          evidenceCount: w.evidence.evidenceCount,
        })),
      };
    },

    getDueReviews: async (_userId, args) => {
      const id = requireGoal();
      const curriculum = await curriculumRepository(db).findByGoal(user.id, id);
      if (!curriculum) return { dueNow: 0, overdue: 0, concepts: [] };

      const concepts = await curriculumRepository(db).listConcepts(user.id, curriculum.id);
      const titleById = new Map(concepts.map((c) => [c.id, c.title]));
      const states = await memoryRepository(db).listMemoryStates(
        user.id,
        concepts.map((c) => c.id),
      );
      const masteryRows = await memoryRepository(db).listMasteryStates(
        user.id,
        concepts.map((c) => c.id),
      );
      const masteryByConcept = new Map(masteryRows.map((m) => [m.conceptId, Number(m.mastery)]));

      const now = new Date();
      const due = states
        .filter((s) => s.reps > 0 && s.dueAt.getTime() <= now.getTime())
        .map((s) => ({
          id: s.conceptId,
          title: titleById.get(s.conceptId) ?? s.conceptId,
          mastery: masteryByConcept.get(s.conceptId) ?? 0,
          dueAt: s.dueAt.toISOString(),
          daysOverdue: daysOverdue(toCoreMemoryState(s), now),
        }))
        .sort((a, b) => b.daysOverdue - a.daysOverdue);

      return {
        dueNow: due.length,
        overdue: due.filter((d) => d.daysOverdue >= 1).length,
        concepts: due.slice(0, args.limit),
      };
    },

    getSessionHistory: async (_userId, args) => {
      const sessions = await executionRepository(db).recentSessions(user.id, args.limit);
      return {
        sessions: sessions.map((s) => ({
          date: s.startedAt.toISOString().slice(0, 10),
          activeMinutes: s.activeMinutes,
          selfRating: s.selfRating,
          conceptTitles: [],
        })),
      };
    },

    getNextAction: async (_userId, args) => {
      const result = await getNextAction(user, requireGoal(), args.availableMinutes);
      return {
        title: result.action?.title ?? null,
        type: result.action?.type ?? null,
        estimatedMinutes: result.action?.estimatedMinutes ?? null,
        rationale: result.action?.rationale ?? null,
        dominantFactor: result.why?.dominantFactor ?? null,
      };
    },
  };
}
