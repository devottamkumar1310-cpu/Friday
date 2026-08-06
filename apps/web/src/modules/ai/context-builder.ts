import {
  buildContextPacket,
  type AgentName,
  type LearnerContextPacket,
  type PacketConcept,
} from '@friday/ai';
import { DEFAULT_PRIORITY_CONFIG, rankWeakConcepts, retrievability } from '@friday/core';
import {
  curriculumRepository,
  executionRepository,
  getDb,
  goalsRepository,
  learnerFactsRepository,
  memoryRepository,
  planningRepository,
  type UserRow,
} from '@friday/db';
import { toCoreMasteryState, toCoreMemoryState } from '../shared/mappers';

/**
 * Service-side context assembly — SYSTEM_ARCHITECTURE §5.4, roadmap 2.4.
 *
 * `packages/ai` owns the *shape* and the budgeting; this owns the *gathering*,
 * because `ai` may not import `db` (ADR-017). Keeping the split here is what
 * makes "what was in the prompt?" answerable: there is exactly one function
 * that assembles learner state for a model, and it is this one.
 */

export async function buildLearnerContext(
  user: UserRow,
  goalId: string | null,
  agent: AgentName,
  now = new Date(),
): Promise<LearnerContextPacket> {
  const db = getDb();

  const identity = {
    displayName: user.displayName,
    timezone: user.timezone,
    locale: user.locale,
  };

  if (!goalId) {
    return buildContextPacket({ identity }, { agent, now });
  }

  const goal = await goalsRepository(db).findById(user.id, goalId);
  if (!goal) return buildContextPacket({ identity }, { agent, now });

  const plan = await planningRepository(db).findActive(user.id, goalId);
  const curriculum = await curriculumRepository(db).findByGoal(user.id, goalId);
  const concepts = curriculum
    ? await curriculumRepository(db).listConcepts(user.id, curriculum.id)
    : [];
  const conceptIds = concepts.map((c) => c.id);

  const masteryRows = await memoryRepository(db).listMasteryStates(user.id, conceptIds);
  const memoryRows = await memoryRepository(db).listMemoryStates(user.id, conceptIds);
  const masteryByConcept = new Map(masteryRows.map((m) => [m.conceptId, m]));
  const memoryByConcept = new Map(memoryRows.map((m) => [m.conceptId, m]));

  const withMastery: (PacketConcept & { hasEvidence: boolean })[] = concepts.map((c) => {
    const row = masteryByConcept.get(c.id);
    return {
      id: c.id,
      title: c.title,
      mastery: row ? Number(row.mastery) : 0,
      hasEvidence: (row?.evidenceCount ?? 0) > 0,
    };
  });

  const strongest = [...withMastery]
    .filter((c) => c.hasEvidence)
    .sort((a, b) => b.mastery - a.mastery)
    .slice(0, 5)
    .map(({ id, title, mastery }) => ({ id, title, mastery }));

  const edges = curriculum ? await curriculumRepository(db).listEdges(user.id, curriculum.id) : [];
  const outDegree = new Map<string, number>();
  for (const edge of edges) {
    if (edge.type !== 'prerequisite_of') continue;
    outDegree.set(edge.fromConceptId, (outDegree.get(edge.fromConceptId) ?? 0) + 1);
  }

  // The Coach sees the same weak list the progress page shows, computed by the
  // same function — so it cannot contradict the UI (§5.7 hallucinated state).
  const weakest = rankWeakConcepts(
    concepts.map((c) => {
      const memoryRow = memoryByConcept.get(c.id);
      const memoryState = memoryRow ? toCoreMemoryState(memoryRow) : null;
      return {
        concept: {
          id: c.id,
          title: c.title,
          examWeight: Number(c.examWeight),
          estimatedMinutes: c.estimatedMinutes,
          status: c.status,
        },
        masteryState: masteryByConcept.get(c.id)
          ? toCoreMasteryState(masteryByConcept.get(c.id)!)
          : null,
        retrievability: retrievability(memoryState, now),
        directUnlockCount: outDegree.get(c.id) ?? 0,
      };
    }),
    { phi: DEFAULT_PRIORITY_CONFIG.phi, lambda: DEFAULT_PRIORITY_CONFIG.lambda, limit: 10 },
  ).map((w) => ({ id: w.conceptId, title: w.title, mastery: w.mastery }));

  const dueForReview = memoryRows.filter(
    (m) => m.reps > 0 && m.dueAt.getTime() <= now.getTime(),
  ).length;

  const todayKey = now.toISOString().slice(0, 10);
  const todayTasks = plan
    ? (await planningRepository(db).listTasksInWindow(user.id, goalId, todayKey, todayKey)).map(
        (t) => ({
          title: t.title,
          type: t.type,
          estimatedMinutes: t.estimatedMinutes,
          status: t.status,
        }),
      )
    : [];

  const sessions = await executionRepository(db).recentSessions(user.id, 5);
  const facts = await learnerFactsRepository(db).list(user.id);

  const daysRemaining = Math.max(
    0,
    Math.round((new Date(goal.targetDate).getTime() - now.getTime()) / 86_400_000),
  );

  return buildContextPacket(
    {
      identity,
      goal: {
        title: goal.title,
        type: goal.type,
        targetDate: goal.targetDate,
        daysRemaining,
        intensity: goal.targetWeeklyMinutes,
      },
      status: plan
        ? {
            progressPct: 0, // filled by the caller when it already computed progress
            onTrack: plan.verdict,
            projectedCompletion: plan.projectedCompletionDate,
            weeklyAdherence: null,
          }
        : null,
      plan: plan
        ? {
            currentPlanVersion: plan.version,
            todayTasks,
            thisWeekSummary: `Plan v${plan.version}, window ${plan.windowStart} to ${plan.windowEnd}.`,
          }
        : null,
      mastery: { strongest, weakest, dueForReview },
      recent: {
        last5Sessions: sessions.map((s) => ({
          date: s.startedAt.toISOString().slice(0, 10),
          minutes: s.activeMinutes,
          rating: s.selfRating,
        })),
        last3Assessments: [],
      },
      facts: facts.map((f) => ({
        id: f.id,
        category: f.category,
        statement: f.statement,
        confidence: Number(f.confidence),
      })),
      // Semantic retrieval needs pgvector, which arrives in Phase 3 (D11).
      retrieved: [],
    },
    { agent, now },
  );
}
