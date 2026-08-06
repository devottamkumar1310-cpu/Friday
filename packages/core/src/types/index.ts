/**
 * Plain domain types shared across `packages/core`.
 *
 * Nothing here is a database row — repositories map rows to (and from) these
 * shapes at the boundary, so the engine never sees an ORM type (ADR-003).
 */

/** A node in the knowledge graph — DATABASE_DESIGN §4.2 `concepts`. */
export interface ConceptNode {
  id: string;
  title: string;
  /** How much this matters for the goal, in [0,1]. `concepts.exam_weight`. */
  examWeight: number;
  /** Estimated minutes remaining to learn this concept from scratch. */
  estimatedMinutes: number;
  status: 'not_started' | 'in_progress' | 'learned' | 'mastered' | 'excluded' | 'already_known';
}

/** An edge in the prerequisite graph — `concept_edges`. */
export interface ConceptEdge {
  fromConceptId: string;
  toConceptId: string;
  type: 'prerequisite_of' | 'related_to' | 'applies_to' | 'specializes';
  /** Soft-prerequisite strength in (0,1]. `concept_edges.strength`. */
  strength: number;
}

/** `mastery_states` row, mapped to plain data. */
export interface MasteryState {
  conceptId: string;
  /** Raw mastery `m` ∈ [0,1]. */
  mastery: number;
  /** Belief confidence `κ` ∈ [0,1]. */
  confidence: number;
  evidenceCount: number;
  /** Distinct evidence sources seen, for the diversity input to κ. */
  distinctSources: number;
  /** Recent-outcome variance, for the consistency input to κ (already computed). */
  outcomeVariance: number;
  lastEvidenceAt: Date | null;
}

/** `memory_states` row — FSRS-5 state for one `(user, concept)`. Never stores `R`. */
export interface MemoryState {
  conceptId: string;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  /** 0 new, 1 learning, 2 review, 3 relearning — ts-fsrs `State`. */
  state: number;
  lastReviewAt: Date | null;
  dueAt: Date;
}

export type EvidenceSource =
  'self_rating' | 'question_response' | 'assessment' | 'coach_check' | 'inferred';

/** An Evidence Event — the input to the mastery update (§5.2). */
export interface EvidenceEvent {
  conceptId: string;
  source: EvidenceSource;
  /** Outcome ∈ [0,1]: correctness, or a rating mapped to a scalar. */
  outcome: number;
  /** Item difficulty 1-5, when known — scales `w_difficulty`. */
  difficulty?: number;
  occurredAt: Date;
}

export type FsrsRating = 'again' | 'hard' | 'good' | 'easy';

/** A candidate concept fully resolved for scoring — the Stage 2 (MODEL) output. */
export interface ScoringCandidate {
  concept: ConceptNode;
  masteryState: MasteryState;
  memoryState: MemoryState | null;
  /** Direct out-degree (M0 leverage depth) — count of concepts this directly unlocks. */
  directUnlockCount: number;
  /** Prerequisite readiness inputs: [{ masteryEffective, strength }]. */
  prerequisites: { effectiveMastery: number; strength: number }[];
  /** M0: derived from plan position (§1.1). 0 = not yet placed / no urgency signal. */
  planPositionUrgency: number;
  /** Remaining cost in minutes, before the learner's pace factor. */
  remainingMinutes: number;
  /** Whether this candidate is a due/overdue review vs. new learning. */
  isReview: boolean;
}

/** Per-factor value + contribution — the object §12 explanations are projected from. */
export interface FactorBreakdown {
  impact: { value: number; contribution: number; detail: string };
  urgency: { value: number; contribution: number; detail: string };
  decayRisk: { value: number; contribution: number; detail: string };
  readiness: { value: number; contribution: null; detail: string };
  cost: { value: number; contribution: number; detail: string };
}

export type DominantFactor = 'impact' | 'urgency' | 'decayRisk' | 'readiness' | 'cost';

export interface ScoredCandidate {
  conceptId: string;
  taskId?: string;
  score: number;
  /** Score after selection-stage modifiers (§7). Equal to `score` at M0 except for hysteresis. */
  adjustedScore: number;
  factors: FactorBreakdown;
  dominantFactor: DominantFactor;
  modifiersApplied: { id: string; multiplier: number; reason: string }[];
}

export interface ExcludedCandidate {
  conceptId: string;
  reasonCode: string;
  reason: string;
}

export interface ConfidenceBreakdown {
  score: number;
  band: 'exploratory' | 'low' | 'moderate' | 'high';
  inputs: {
    beliefConfidence: number;
    margin: number;
    dataSufficiency: number;
    stability: number;
    constraintHealth: number;
  };
}

/** Learner-level state feeding cost personalisation and feasibility (§5.5). */
export interface LearnerFactors {
  /** ρ — reliability factor, planned vs. actual minutes. */
  reliability: number;
  /** π — pace factor, actual vs. estimated minutes to mastery. */
  pace: number;
}

export interface AvailabilityWindow {
  date: string;
  capacityMinutes: number;
}
