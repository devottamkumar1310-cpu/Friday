import { ApiError } from '@friday/contracts';
import { retrievability } from '@friday/core';
import {
  curriculumRepository,
  getDb,
  learnerFactsRepository,
  memoryRepository,
  type LearnerFactRow,
  type UserRow,
} from '@friday/db';
import { toCoreMemoryState } from '../shared/mappers';

/**
 * Memory service — API_SPECIFICATION §5.8.
 *
 * Covers what FRIDAY knows (mastery, due reviews) and what it *believes*
 * (learner facts, FR-7.4/7.6). The belief half is the one with a rule attached:
 * a fact the system cannot source is a fact it should not hold, and a learner
 * who deletes one gets it deleted rather than archived.
 */

export async function listMastery(user: UserRow, goalId: string, limit = 100) {
  const db = getDb();
  const curriculum = await curriculumRepository(db).findByGoal(user.id, goalId);
  if (!curriculum) throw ApiError.notFound();

  const concepts = await curriculumRepository(db).listConcepts(user.id, curriculum.id);
  const states = await memoryRepository(db).listMasteryStates(
    user.id,
    concepts.map((c) => c.id),
  );
  const byConcept = new Map(states.map((s) => [s.conceptId, s]));

  return concepts
    .map((c) => {
      const state = byConcept.get(c.id);
      return {
        conceptId: c.id,
        title: c.title,
        mastery: state ? Number(state.mastery) : 0,
        confidence: state ? Number(state.confidence) : 0,
        evidenceCount: state?.evidenceCount ?? 0,
        lastEvidenceAt: state?.lastEvidenceAt?.toISOString() ?? null,
      };
    })
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, limit);
}

export async function listDueReviews(user: UserRow, goalId: string, now = new Date()) {
  const db = getDb();
  const curriculum = await curriculumRepository(db).findByGoal(user.id, goalId);
  if (!curriculum) throw ApiError.notFound();

  const concepts = await curriculumRepository(db).listConcepts(user.id, curriculum.id);
  const titleById = new Map(concepts.map((c) => [c.id, c.title]));
  const states = await memoryRepository(db).listMemoryStates(
    user.id,
    concepts.map((c) => c.id),
  );

  return states
    .filter((s) => s.reps > 0)
    .map((s) => ({
      conceptId: s.conceptId,
      title: titleById.get(s.conceptId) ?? s.conceptId,
      dueAt: s.dueAt.toISOString(),
      retrievability: retrievability(toCoreMemoryState(s), now),
      reps: s.reps,
      lapses: s.lapses,
    }))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

export function toWireFact(row: LearnerFactRow) {
  return {
    id: row.id,
    category: row.category,
    statement: row.statement,
    confidence: Number(row.confidence),
    reinforcementCount: row.reinforcementCount,
    evidenceRefs: row.evidenceRefs,
    conceptIds: row.conceptIds ?? [],
    isUserEdited: row.isUserEdited,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listFacts(user: UserRow, category?: LearnerFactRow['category']) {
  return learnerFactsRepository(getDb()).list(user.id, category);
}

export async function updateFact(
  user: UserRow,
  factId: string,
  patch: { statement?: string; confidence?: number },
): Promise<LearnerFactRow> {
  const updated = await learnerFactsRepository(getDb()).update(user.id, factId, {
    ...(patch.statement !== undefined ? { statement: patch.statement } : {}),
    ...(patch.confidence !== undefined ? { confidence: patch.confidence.toFixed(2) } : {}),
  });
  if (!updated) throw ApiError.notFound();
  return updated;
}

/** FR-7.6: honoured immediately. Not a soft flag — the row is gone. */
export async function deleteFact(user: UserRow, factId: string): Promise<void> {
  const deleted = await learnerFactsRepository(getDb()).remove(user.id, factId);
  if (!deleted) throw ApiError.notFound();
}
