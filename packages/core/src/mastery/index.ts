/**
 * `core/mastery` — evidence → mastery update, belief confidence, effective
 * mastery. AI_DECISION_ENGINE §5.2, §5.3. IMPLEMENTATION_ROADMAP 1.4.
 */

import type { EvidenceEvent, EvidenceSource, MasteryState } from '../types';

/** §5.2 evidence weights by source. */
const W_SOURCE: Record<EvidenceSource, number> = {
  assessment: 1.0,
  question_response: 0.85,
  coach_check: 0.6,
  self_rating: 0.35,
  inferred: 0.15,
};

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * `w_difficulty` — succeeding at something hard is worth more than succeeding
 * at something easy. Scales relative to current mastery: item difficulty
 * (1-5, normalised to [0,1]) compared against `m` produces a multiplier in
 * roughly [0.7, 1.3].
 */
function difficultyWeight(itemDifficulty: number | undefined, mastery: number): number {
  if (itemDifficulty === undefined) return 1.0;
  const normalisedDifficulty = (itemDifficulty - 1) / 4; // 1..5 -> 0..1
  const relative = normalisedDifficulty - mastery;
  return clamp01(1.0 + 0.3 * relative + 0.3) || 1.0; // guard against a zero from clamp
}

/**
 * `w_recency` — decays older evidence within the same computation window so a
 * burst of activity does not overwhelm the estimate. `referenceTime` is
 * "now"; evidence more than 30 days old is down-weighted toward a floor.
 */
function recencyWeight(occurredAt: Date, referenceTime: Date): number {
  const ageDays = Math.max(0, (referenceTime.getTime() - occurredAt.getTime()) / 86_400_000);
  const halfLifeDays = 30;
  return Math.max(0.3, Math.pow(0.5, ageDays / halfLifeDays));
}

export interface MasteryUpdateResult {
  mastery: number;
  confidence: number;
  evidenceCount: number;
}

/**
 * The update rule (§5.2):
 *
 *   K       = K_base · (1 − κ) + K_floor
 *   m'      = clamp01( m + K · w · (observed − expected) )
 *
 * I-1: mastery stays in [0,1]; correct evidence never decreases it below its
 * prior value net of the signed delta, incorrect evidence never increases it —
 * both fall out of the formula because `(observed - expected)` is signed and
 * `K, w >= 0`.
 */
export function updateMastery(
  state: MasteryState,
  evidence: EvidenceEvent,
  config: { kBase: number; kFloor: number },
  referenceTime: Date = evidence.occurredAt,
): MasteryUpdateResult {
  const expected = state.mastery;
  const observed = clamp01(evidence.outcome);

  const w =
    W_SOURCE[evidence.source] *
    difficultyWeight(evidence.difficulty, state.mastery) *
    recencyWeight(evidence.occurredAt, referenceTime);

  const K = config.kBase * (1 - state.confidence) + config.kFloor;
  const mastery = clamp01(state.mastery + K * w * (observed - expected));

  const distinctSources = state.distinctSources; // diversity tracked by the caller across events
  const evidenceCount = state.evidenceCount + 1;
  const confidence = updateBeliefConfidence({
    ...state,
    evidenceCount,
    distinctSources,
  });

  return { mastery, confidence, evidenceCount };
}

/**
 * Belief confidence κ (§5.3) — four inputs, each in [0,1], combined by simple
 * average. Volume saturates (diminishing returns past ~10 events); diversity
 * and consistency are supplied by the caller from aggregated evidence;
 * recency decays with time since last evidence.
 */
export function updateBeliefConfidence(
  state: Pick<
    MasteryState,
    'evidenceCount' | 'distinctSources' | 'outcomeVariance' | 'lastEvidenceAt'
  >,
  now: Date = new Date(),
): number {
  const volume = Math.min(1, state.evidenceCount / 10);
  const diversity = Math.min(1, state.distinctSources / 3);
  const consistency = clamp01(1 - state.outcomeVariance);
  const daysSince = state.lastEvidenceAt
    ? Math.max(0, (now.getTime() - state.lastEvidenceAt.getTime()) / 86_400_000)
    : 0;
  const recency = Math.max(0, 1 - daysSince / 90);

  return clamp01((volume + diversity + consistency + recency) / 4);
}

/**
 * Effective mastery (§5.2) — **refines SYSTEM_ARCHITECTURE §6.3**. Uses a
 * retention floor `φ` rather than pure multiplication by `R`, because durable
 * residue from prior learning does not decay to zero.
 *
 *   m_eff = m · ( φ + (1 − φ) · R )
 *
 * I-2: `φ · m <= m_eff <= m`.
 */
export function effectiveMastery(rawMastery: number, retrievability: number, phi: number): number {
  return rawMastery * (phi + (1 - phi) * retrievability);
}
