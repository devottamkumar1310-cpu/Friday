import type {
  ConceptEdge as CoreConceptEdge,
  ConceptNode as CoreConceptNode,
  MasteryState as CoreMasteryState,
  MemoryState as CoreMemoryState,
} from '@friday/core';
import type { ConceptEdgeRow, ConceptRow, MasteryStateRow, MemoryStateRow } from '@friday/db';

/**
 * Row → domain mappers.
 *
 * `packages/core` takes plain data, never ORM rows (ADR-003), so every service
 * that calls the engine needs this conversion. It lived inline in three Phase 1
 * services; centralising it here means the numeric coercions — Postgres returns
 * `numeric` as a string — are written once and cannot drift apart.
 */

export function toCoreConcept(row: ConceptRow): CoreConceptNode {
  return {
    id: row.id,
    title: row.title,
    examWeight: Number(row.examWeight),
    estimatedMinutes: row.estimatedMinutes,
    status: row.status,
  };
}

export function toCoreEdge(row: ConceptEdgeRow): CoreConceptEdge {
  return {
    fromConceptId: row.fromConceptId,
    toConceptId: row.toConceptId,
    type: row.type,
    strength: Number(row.strength),
  };
}

export function toCoreMasteryState(row: MasteryStateRow): CoreMasteryState {
  return {
    conceptId: row.conceptId,
    mastery: Number(row.mastery),
    confidence: Number(row.confidence),
    evidenceCount: row.evidenceCount,
    distinctSources: row.distinctSources,
    outcomeVariance: Number(row.outcomeVariance),
    lastEvidenceAt: row.lastEvidenceAt,
  };
}

export function toCoreMemoryState(row: MemoryStateRow): CoreMemoryState {
  return {
    conceptId: row.conceptId,
    stability: Number(row.stability),
    difficulty: Number(row.difficulty),
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    lastReviewAt: row.lastReviewAt,
    dueAt: row.dueAt,
  };
}

/** Prerequisite out-degree per concept — the depth-1 leverage input (M0 §1.1). */
export function buildOutDegree(edges: ConceptEdgeRow[]): Map<string, number> {
  const outDegree = new Map<string, number>();
  for (const edge of edges) {
    if (edge.type !== 'prerequisite_of') continue;
    outDegree.set(edge.fromConceptId, (outDegree.get(edge.fromConceptId) ?? 0) + 1);
  }
  return outDegree;
}
