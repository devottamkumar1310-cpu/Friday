/**
 * `core/priority` — the Next Action ranking function. The crown jewel
 * (SYSTEM_ARCHITECTURE §6.3), fully specified in AI_DECISION_ENGINE §6-§7,
 * §11-§12. IMPLEMENTATION_ROADMAP 1.5 — **M0 subset only** (§1.1):
 *
 *   - Urgency:    derived from plan position, not a full DAG backward pass.
 *   - Leverage:   direct out-degree (depth 1), not transitive descendants.
 *   - Selection:  hysteresis (M3) only — no continuity/variety/override/energy/
 *                 freshness modifiers.
 *   - Confidence: computed and traced, not surfaced in the UI.
 *
 * DP1: no LLM anywhere in this file. DP2: pure functions of the state passed
 * in. DP3: the explanation is a projection of the factors computed here, never
 * generated independently.
 */

import type { PriorityConfig } from '../config';
import { computeReadiness } from '../graph';
import { effectiveMastery } from '../mastery';
import {
  type ConfidenceBreakdown,
  type DominantFactor,
  type ExcludedCandidate,
  type FactorBreakdown,
  type ScoredCandidate,
  type ScoringCandidate,
} from '../types';

// ---------------------------------------------------------------------------
// Stage 4: SCORE
// ---------------------------------------------------------------------------

function normaliseLeverageCount(count: number): number {
  // No count normalises to 1.0 by itself; caps growth so one enormous hub
  // concept cannot dominate every other factor. Ten direct unlocks is treated
  // as "very high leverage" for M0's depth-1 measure.
  return Math.min(1, count / 10);
}

function computeImpact(
  examWeight: number,
  gap: number,
  directUnlockCount: number,
  lambda: number,
): { value: number; leverage: number } {
  const leverage = 1 + lambda * normaliseLeverageCount(directUnlockCount);
  return { value: clamp01(examWeight * gap * leverage), leverage };
}

/** M0 urgency: the plan-position-derived value supplied by the scheduler (§1.1). */
function computeUrgency(planPositionUrgency: number): number {
  return clamp01(planPositionUrgency);
}

/** §6.4. `Established` ramps 0->1 over the first `repsMin` exposures. */
export function computeDecayRisk(
  retrievabilityValue: number,
  reps: number,
  repsMin: number,
): number {
  const established = Math.min(1, reps / repsMin);
  return clamp01((1 - retrievabilityValue) * established);
}

function computeCost(remainingMinutes: number, pace: number): number {
  return Math.max(1, remainingMinutes * pace);
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export interface ScoreContext {
  config: PriorityConfig;
  /** π — this learner's pace factor (§5.5). Applied to cost only (per §6.6). */
  pace: number;
  now: Date;
}

/**
 * Scores one candidate. Returns the full factor breakdown so stage 4's "must
 * retain per-factor values and contributions" requirement (§4) holds, not
 * just the total.
 */
export function scoreCandidate(
  candidate: ScoringCandidate,
  retrievabilityValue: number,
  ctx: ScoreContext,
): ScoredCandidate {
  const { config } = ctx;
  const rawMastery = candidate.masteryState.mastery;
  const mEff = effectiveMastery(rawMastery, retrievabilityValue, config.phi);
  const gap = 1 - mEff;

  const { value: impact } = computeImpact(
    candidate.concept.examWeight,
    gap,
    candidate.directUnlockCount,
    config.lambda,
  );
  const urgency = computeUrgency(candidate.planPositionUrgency);
  const decayRisk = computeDecayRisk(
    retrievabilityValue,
    candidate.memoryState?.reps ?? 0,
    config.repsMin,
  );
  const readiness = computeReadiness(candidate.prerequisites, config.theta);
  const cost = computeCost(candidate.remainingMinutes, ctx.pace);

  return assembleScore(
    candidate.concept.id,
    { impact, urgency, decayRisk, readiness, cost },
    config,
    describeImpact(candidate.concept.examWeight, mEff),
    describeDecayRisk(retrievabilityValue, candidate.isReview),
  );
}

interface RawFactors {
  impact: number;
  urgency: number;
  decayRisk: number;
  readiness: number;
  cost: number;
}

/**
 * Assembles the score, contributions, and dominant factor from raw factor
 * values (§6, §12.2). Shared by `scoreCandidate` (computes every term fresh)
 * and `scoreFromStructural` (§6.0's request-time path: structural terms read
 * from storage, only DecayRisk recomputed) — both must agree by construction
 * (I-9, two-tier consistency).
 */
function assembleScore(
  conceptId: string,
  raw: RawFactors,
  config: PriorityConfig,
  impactDetail: string,
  decayRiskDetail: string,
): ScoredCandidate {
  const { impact, urgency, decayRisk, readiness, cost } = raw;
  const valueTerm = config.alpha * impact + config.beta * urgency + config.gamma * decayRisk;
  const score = readiness * (valueTerm / Math.pow(cost, config.delta));

  // Contribution: each additive term's share of the (unweighted-by-readiness)
  // value bracket, so "dominant factor" reflects what actually drove the
  // score rather than the post-gate total (I-11).
  const contributions = {
    impact: config.alpha * impact,
    urgency: config.beta * urgency,
    decayRisk: config.gamma * decayRisk,
  };
  const totalContribution = contributions.impact + contributions.urgency + contributions.decayRisk;

  const factors: FactorBreakdown = {
    impact: {
      value: impact,
      contribution: totalContribution > 0 ? contributions.impact / totalContribution : 0,
      detail: impactDetail,
    },
    urgency: {
      value: urgency,
      contribution: totalContribution > 0 ? contributions.urgency / totalContribution : 0,
      detail: describeUrgency(urgency),
    },
    decayRisk: {
      value: decayRisk,
      contribution: totalContribution > 0 ? contributions.decayRisk / totalContribution : 0,
      detail: decayRiskDetail,
    },
    readiness: { value: readiness, contribution: null, detail: describeReadiness(readiness) },
    cost: {
      value: cost,
      // Cost is a divisor, not additive — reported for transparency, no
      // contribution share of the value bracket.
      contribution: 0,
      detail: `Estimated ${Math.round(cost)} minutes.`,
    },
  };

  const dominantFactor = pickDominantFactor(factors);

  return {
    conceptId,
    score,
    adjustedScore: score,
    factors,
    dominantFactor,
    modifiersApplied: [],
  };
}

/**
 * §6.0's request-time path: structural terms (Impact, Urgency, Leverage folded
 * into Impact, Readiness, Cost) are read from `tasks.structural_factors` —
 * computed once per plan version — and only DecayRisk plus effective mastery's
 * downstream effect on Impact are recomputed live. Here Impact is passed
 * through as stored (it is pinned at plan-generation time by design; a
 * material mastery shift triggers a re-plan rather than a live Impact
 * recompute, per the evidence trigger class in AI_DECISION_ENGINE §10.1).
 */
export function scoreFromStructural(
  conceptId: string,
  structural: { impact: number; urgency: number; readiness: number; cost: number },
  liveDecayRisk: number,
  config: PriorityConfig,
  impactDetail: string,
  decayRiskDetail: string,
): ScoredCandidate {
  return assembleScore(
    conceptId,
    { ...structural, decayRisk: liveDecayRisk },
    config,
    impactDetail,
    decayRiskDetail,
  );
}

function pickDominantFactor(factors: FactorBreakdown): DominantFactor {
  const additive: [DominantFactor, number][] = [
    ['impact', factors.impact.contribution ?? 0],
    ['urgency', factors.urgency.contribution ?? 0],
    ['decayRisk', factors.decayRisk.contribution ?? 0],
  ];
  additive.sort((a, b) => b[1] - a[1]);
  const [topFactor, topShare] = additive[0]!;

  // Readiness dominates when it is the binding constraint (low gate value) —
  // otherwise the additive factor with the largest share of the value bracket
  // wins. Cost is never "dominant" in the explanatory sense (§12.3 has no
  // cost-as-blocker phrasing; cost only earns a mention via its own template).
  if (factors.readiness.value < 0.5 && factors.readiness.value < topShare) return 'readiness';
  return topFactor;
}

export function describeImpact(examWeight: number, mEff: number): string {
  return `Exam weight ${(examWeight * 100).toFixed(0)}%, currently at ${(mEff * 100).toFixed(0)}% mastery.`;
}

function describeUrgency(urgency: number): string {
  if (urgency > 0.75) return 'Running out of room to fit this before the deadline.';
  if (urgency > 0.4) return 'Moderate room remaining in the plan.';
  return 'Not yet urgent in the current plan window.';
}

export function describeDecayRisk(retrievabilityValue: number, isReview: boolean): string {
  if (!isReview) return 'Not yet studied — no decay risk.';
  return `Retrievability ${(retrievabilityValue * 100).toFixed(0)}%.`;
}

function describeReadiness(readiness: number): string {
  if (readiness >= 0.95) return 'All prerequisites met.';
  if (readiness >= 0.5) return 'Prerequisites are partially in place.';
  return 'Weak prerequisites — foundational work first is recommended.';
}

// ---------------------------------------------------------------------------
// Stage 3: GENERATE — hard eligibility filters, with a recorded reason (I-15)
// ---------------------------------------------------------------------------

export function filterEligible(
  candidates: ScoringCandidate[],
  readinessHardFloor = 0.05,
): { eligible: ScoringCandidate[]; excluded: ExcludedCandidate[] } {
  const eligible: ScoringCandidate[] = [];
  const excluded: ExcludedCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.concept.status === 'excluded') {
      excluded.push({
        conceptId: candidate.concept.id,
        reasonCode: 'excluded_by_learner',
        reason: 'Concept was excluded from the goal.',
      });
      continue;
    }
    if (candidate.concept.status === 'mastered' && !candidate.isReview) {
      excluded.push({
        conceptId: candidate.concept.id,
        reasonCode: 'already_mastered',
        reason: 'Concept is mastered and not currently due for review.',
      });
      continue;
    }
    const readiness = computeReadiness(candidate.prerequisites, 0.6);
    // I-4: a hard floor — soft everywhere above it (§6.5), but a request
    // still needs *a* boundary below which a concept cannot be surfaced at
    // all, or Readiness's "approaches zero" would let priority computation
    // divide effectively-zero value across noise candidates forever.
    if (readiness < readinessHardFloor) {
      excluded.push({
        conceptId: candidate.concept.id,
        reasonCode: 'readiness_below_floor',
        reason: `Readiness ${readiness.toFixed(3)} is below the hard floor.`,
      });
      continue;
    }
    eligible.push(candidate);
  }

  return { eligible, excluded };
}

// ---------------------------------------------------------------------------
// Stage 5: SELECT — hysteresis only at M0 (§7)
// ---------------------------------------------------------------------------

export interface SelectionInput {
  ranked: ScoredCandidate[];
  /** The currently-recommended concept, if any (for hysteresis, §7.1). */
  currentRecommendationConceptId: string | null;
  /** Any override condition that forces re-evaluation regardless of margin. */
  overrideFired: boolean;
  availableMinutes: number;
  /** `estimatedMinutes` per concept, for time-budget fitting (§7.2). */
  durationByConceptId: Map<string, number>;
  minViableMinutes: number;
  hysteresisMargin: number;
}

export interface SelectionResult {
  selected: ScoredCandidate | null;
  fitsWindow: boolean;
  decomposed: boolean;
  reason: string;
}

/**
 * §7.1-7.2: applies hysteresis, then walks the ranking for the first
 * candidate whose duration fits `availableMinutes`.
 */
export function selectAction(input: SelectionInput): SelectionResult {
  const { ranked, currentRecommendationConceptId, overrideFired, availableMinutes } = input;

  if (ranked.length === 0) {
    return { selected: null, fitsWindow: false, decomposed: false, reason: 'no_candidates' };
  }

  let ordered = [...ranked].sort((a, b) => b.adjustedScore - a.adjustedScore);

  if (!overrideFired && currentRecommendationConceptId) {
    const current = ordered.find((c) => c.conceptId === currentRecommendationConceptId);
    const best = ordered[0]!;
    if (current && best.conceptId !== current.conceptId) {
      const threshold = current.adjustedScore * (1 + input.hysteresisMargin);
      if (best.adjustedScore <= threshold) {
        // Stability rule: not enough of a margin to justify disruption (DP5).
        current.modifiersApplied = [
          ...current.modifiersApplied,
          { id: 'hysteresis', multiplier: 1.0, reason: 'Retained: below the stability margin.' },
        ];
        ordered = [current, ...ordered.filter((c) => c.conceptId !== current.conceptId)];
      }
    }
  }

  if (availableMinutes < input.minViableMinutes) {
    return { selected: null, fitsWindow: false, decomposed: false, reason: 'window_too_short' };
  }

  for (const candidate of ordered) {
    const duration = input.durationByConceptId.get(candidate.conceptId) ?? Infinity;
    if (duration <= availableMinutes) {
      return { selected: candidate, fitsWindow: true, decomposed: false, reason: 'fits_window' };
    }
  }

  // §7.2 step 3: nothing fits whole — offer the top candidate decomposed
  // rather than substituting a lesser one.
  return { selected: ordered[0]!, fitsWindow: false, decomposed: true, reason: 'decomposed' };
}

// ---------------------------------------------------------------------------
// Stage 6: ASSESS — confidence (§11)
// ---------------------------------------------------------------------------

export interface ConfidenceInputs {
  /** κ of the selected concept. */
  beliefConfidence: number;
  /** Top score vs. runner-up score, both non-negative. */
  topScore: number;
  runnerUpScore: number | null;
  /** Evidence volume / session count / days of history, pre-normalised [0,1]. */
  dataSufficiency: number;
  /** Whether this recommendation persisted across the last recompute. */
  wasStableAcrossRecompute: boolean;
  /** Whether eligibility rules were relaxed or the time budget forced a compromise. */
  constraintsRelaxed: boolean;
}

export function assessConfidence(inputs: ConfidenceInputs): ConfidenceBreakdown {
  const c1 = clamp01(inputs.beliefConfidence);
  const c2 =
    inputs.runnerUpScore === null || inputs.topScore === 0
      ? 1
      : clamp01((inputs.topScore - inputs.runnerUpScore) / inputs.topScore);
  const c3 = clamp01(inputs.dataSufficiency);
  const c4 = inputs.wasStableAcrossRecompute ? 1 : 0.5;
  const c5 = inputs.constraintsRelaxed ? 0.4 : 1;

  const score = clamp01((c1 + c2 + c3 + c4 + c5) / 5);

  let band: ConfidenceBreakdown['band'];
  if (score >= 0.75) band = 'high';
  else if (score >= 0.5) band = 'moderate';
  else if (score >= 0.3) band = 'low';
  else band = 'exploratory';

  return {
    score,
    band,
    inputs: {
      beliefConfidence: c1,
      margin: c2,
      dataSufficiency: c3,
      stability: c4,
      constraintHealth: c5,
    },
  };
}

// ---------------------------------------------------------------------------
// Stage 7: EXPLAIN — L1 headline, deterministic templates (§12.2-12.3)
// ---------------------------------------------------------------------------

/**
 * Renders the L1 headline rationale from the live factor table. Never stored
 * (API_SPECIFICATION §5.5) — computed fresh on every request so it cannot name
 * a factor that no longer dominates (I-11, T3).
 */
export function renderRationale(
  dominantFactor: DominantFactor,
  factors: FactorBreakdown,
  conceptTitle: string,
  availableMinutes: number,
): string {
  switch (dominantFactor) {
    case 'decayRisk':
      return `${factors.decayRisk.detail} Reviewing "${conceptTitle}" now protects what you already learned.`;
    case 'urgency':
      return `${factors.urgency.detail} "${conceptTitle}" is next in your plan.`;
    case 'impact':
      return `${factors.impact.detail} "${conceptTitle}" is the biggest gap that matters right now.`;
    case 'readiness':
      return `${factors.readiness.detail} Working on "${conceptTitle}" will make later topics easier.`;
    case 'cost':
      return `It fits your ${availableMinutes} minutes, and "${conceptTitle}" is the most valuable thing that does.`;
  }
}
