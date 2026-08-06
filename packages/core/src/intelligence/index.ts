/**
 * `core/intelligence` — weighted progress and weak-concept ranking.
 * IMPLEMENTATION_ROADMAP 2.1, 2.2.
 *
 * These are deterministic derivations over learner state, so they live in the
 * domain core rather than in a service (ADR-003). The Diagnostician *interprets*
 * these numbers in Phase 3; it does not produce them (DP1).
 */

import { effectiveMastery } from '../mastery';
import type { ConceptNode, MasteryState } from '../types';

export interface ProgressInput {
  concept: ConceptNode;
  masteryState: MasteryState | null;
  /** Retrievability at read time, from `core/retention`. */
  retrievability: number;
}

export interface WeightedProgress {
  /** Exam-weight-weighted mean of effective mastery, in [0,1]. */
  weightedProgress: number;
  /** Raw mean mastery, unweighted — reported for contrast, never as the headline. */
  rawProgress: number;
  conceptsTotal: number;
  conceptsMastered: number;
  conceptsInProgress: number;
  conceptsNotStarted: number;
}

/** A concept counts as mastered at this effective-mastery level. */
export const MASTERY_THRESHOLD = 0.85;

/**
 * §4.7: progress is **exam-weight-weighted mastery, not percentage of tasks
 * done**. Task completion measures activity; this measures knowledge. A learner
 * who has completed 80% of their tasks but retained little is not 80% done, and
 * telling them so would be the single most damaging lie the product could tell.
 */
export function computeWeightedProgress(inputs: ProgressInput[], phi: number): WeightedProgress {
  const scored = inputs.filter(
    (i) => i.concept.status !== 'excluded' && i.concept.status !== 'already_known',
  );

  if (scored.length === 0) {
    return {
      weightedProgress: 0,
      rawProgress: 0,
      conceptsTotal: 0,
      conceptsMastered: 0,
      conceptsInProgress: 0,
      conceptsNotStarted: 0,
    };
  }

  let totalWeight = 0;
  let earnedWeight = 0;
  let rawSum = 0;
  let mastered = 0;
  let inProgress = 0;
  let notStarted = 0;

  for (const input of scored) {
    const raw = input.masteryState?.mastery ?? 0;
    const mEff = effectiveMastery(raw, input.retrievability, phi);
    const weight = input.concept.examWeight;

    totalWeight += weight;
    earnedWeight += weight * mEff;
    rawSum += mEff;

    if (mEff >= MASTERY_THRESHOLD) mastered++;
    else if (raw > 0) inProgress++;
    else notStarted++;
  }

  return {
    weightedProgress: totalWeight > 0 ? earnedWeight / totalWeight : 0,
    rawProgress: rawSum / scored.length,
    conceptsTotal: scored.length,
    conceptsMastered: mastered,
    conceptsInProgress: inProgress,
    conceptsNotStarted: notStarted,
  };
}

export interface WeakConceptInput extends ProgressInput {
  /** Direct out-degree, for the leverage term. */
  directUnlockCount: number;
}

export interface WeakConcept {
  conceptId: string;
  title: string;
  mastery: number;
  effectiveMastery: number;
  examWeight: number;
  /** How much fixing this is worth: `examWeight × gap × leverage`. */
  weaknessScore: number;
  /** Evidence backing the estimate — the drill-down half of roadmap 2.2. */
  evidence: {
    evidenceCount: number;
    beliefConfidence: number;
    lastEvidenceAt: Date | null;
    /** True when there is too little evidence to be confident this is genuinely weak. */
    provisional: boolean;
  };
}

/** Below this belief confidence, a "weak" label is a guess and is marked as one. */
export const PROVISIONAL_CONFIDENCE = 0.35;

/**
 * Below this many observations, a "weak" label is provisional regardless of κ.
 *
 * κ alone is not sufficient here. Its consistency input (§5.3) is derived from
 * variance across outcomes, and a single observation has no variance — so it
 * scores as *perfectly* consistent and inflates κ above the threshold. One
 * answer to one question is not evidence that someone is weak at a concept,
 * whatever the arithmetic says, so the count is checked directly.
 */
export const PROVISIONAL_EVIDENCE_COUNT = 3;

/**
 * Ranks concepts by how much is lost by leaving them weak.
 *
 * Deliberately **not** a plain ascending sort by mastery. The lowest-mastery
 * concept is often something barely started and barely examinable; the concept
 * worth surfacing is the one where low mastery, real exam weight, and
 * downstream leverage coincide. That is the same shape as the Impact factor in
 * the priority engine (§6.2), for the same reason.
 *
 * Concepts never studied are excluded: they are not *weak*, they are *unstarted*,
 * and conflating the two would fill the weak list with the entire syllabus on
 * day one (the E-1 cold-start failure).
 */
export function rankWeakConcepts(
  inputs: WeakConceptInput[],
  options: { phi: number; lambda: number; limit?: number },
): WeakConcept[] {
  const ranked: WeakConcept[] = [];

  for (const input of inputs) {
    if (input.concept.status === 'excluded' || input.concept.status === 'already_known') continue;

    const state = input.masteryState;
    // No evidence at all means unstarted, not weak.
    if (!state || state.evidenceCount === 0) continue;

    const raw = state.mastery;
    const mEff = effectiveMastery(raw, input.retrievability, options.phi);
    const gap = 1 - mEff;
    const leverage = 1 + options.lambda * Math.min(1, input.directUnlockCount / 10);
    const weaknessScore = input.concept.examWeight * gap * leverage;

    ranked.push({
      conceptId: input.concept.id,
      title: input.concept.title,
      mastery: raw,
      effectiveMastery: mEff,
      examWeight: input.concept.examWeight,
      weaknessScore,
      evidence: {
        evidenceCount: state.evidenceCount,
        beliefConfidence: state.confidence,
        lastEvidenceAt: state.lastEvidenceAt,
        provisional:
          state.confidence < PROVISIONAL_CONFIDENCE ||
          state.evidenceCount < PROVISIONAL_EVIDENCE_COUNT,
      },
    });
  }

  ranked.sort(
    (a, b) => b.weaknessScore - a.weaknessScore || a.conceptId.localeCompare(b.conceptId),
  );
  return options.limit ? ranked.slice(0, options.limit) : ranked;
}

export interface VelocityInput {
  /** Weighted progress at the start and end of the window. */
  progressStart: number;
  progressEnd: number;
  windowDays: number;
  daysRemaining: number;
}

export interface Velocity {
  /** Weighted-progress points gained per week over the window. */
  perWeek: number;
  /** Points per week needed to reach 100% by the target date. */
  requiredPerWeek: number;
  trend: 'ahead' | 'on_pace' | 'declining';
}

/**
 * Observed vs. required pace. Powers the "am I keeping up?" line on the
 * progress page, and does it from measured progress rather than from a promise
 * made at signup.
 */
export function computeVelocity(input: VelocityInput): Velocity {
  const weeks = Math.max(input.windowDays / 7, 1 / 7);
  const perWeek = (input.progressEnd - input.progressStart) / weeks;

  const remainingProgress = Math.max(0, 1 - input.progressEnd);
  const remainingWeeks = Math.max(input.daysRemaining / 7, 1 / 7);
  const requiredPerWeek = remainingProgress / remainingWeeks;

  let trend: Velocity['trend'];
  if (perWeek >= requiredPerWeek * 1.05) trend = 'ahead';
  else if (perWeek >= requiredPerWeek * 0.95) trend = 'on_pace';
  else trend = 'declining';

  return { perWeek, requiredPerWeek, trend };
}

export interface RetentionHealth {
  dueNow: number;
  overdue: number;
  /** Studied concepts whose retrievability has fallen below the at-risk line. */
  atRisk: number;
}

export const AT_RISK_RETRIEVABILITY = 0.6;

export function computeRetentionHealth(
  states: { retrievability: number; dueAt: Date; reps: number }[],
  now: Date,
): RetentionHealth {
  let dueNow = 0;
  let overdue = 0;
  let atRisk = 0;

  for (const state of states) {
    if (state.reps === 0) continue;
    const dueMs = state.dueAt.getTime();
    if (dueMs <= now.getTime()) {
      dueNow++;
      if (now.getTime() - dueMs > 86_400_000) overdue++;
    }
    if (state.retrievability < AT_RISK_RETRIEVABILITY) atRisk++;
  }

  return { dueNow, overdue, atRisk };
}
