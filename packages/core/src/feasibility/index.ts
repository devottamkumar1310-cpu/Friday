/**
 * `core/feasibility` — required vs. available minutes, forecast, verdict.
 * AI_DECISION_ENGINE §9. IMPLEMENTATION_ROADMAP 1.6.
 *
 * "The most trust-critical arithmetic in the product" (§9) — every number here
 * must be hand-verifiable (I-7). No shortcuts, no rounding toward comfort (DP6).
 */

import type { AvailabilityWindow, LearnerFactors } from '../types';

export interface FeasibilityConceptInput {
  conceptId: string;
  remainingLearnMinutes: number;
  remainingPracticeMinutes: number;
  projectedReviewMinutes: number;
  /** For scope triage (D8): Impact x Leverage, ascending = cut first. */
  impactTimesLeverage: number;
}

export type FeasibilityVerdict = 'on_track' | 'at_risk' | 'not_feasible';

export interface FeasibilityResult {
  requiredMinutes: number;
  availableMinutes: number;
  slackMinutes: number;
  slackFraction: number;
  verdict: FeasibilityVerdict;
  projectedCompletionDate: string | null;
  confidenceIntervalDays: number;
}

/**
 * §9: `RequiredMinutes = Σ_c [remainingLearn + remainingPractice + projectedReviews] · π`
 *     `AvailableMinutes = Σ_days capacity(d) · ρ`
 */
export function computeRequiredMinutes(concepts: FeasibilityConceptInput[], pace: number): number {
  const raw = concepts.reduce(
    (sum, c) =>
      sum + c.remainingLearnMinutes + c.remainingPracticeMinutes + c.projectedReviewMinutes,
    0,
  );
  return raw * pace;
}

export function computeAvailableMinutes(
  windows: AvailabilityWindow[],
  reliability: number,
): number {
  const raw = windows.reduce((sum, w) => sum + w.capacityMinutes, 0);
  return raw * reliability;
}

export function computeVerdict(
  requiredMinutes: number,
  availableMinutes: number,
  bufferFraction: number,
): FeasibilityVerdict {
  const slack = availableMinutes - requiredMinutes;
  if (slack < 0) return 'not_feasible';
  if (slack >= bufferFraction * requiredMinutes) return 'on_track';
  return 'at_risk';
}

/** §9.2: earliest date where cumulative capacity >= RequiredMinutes. */
export function projectCompletionDate(
  windows: AvailabilityWindow[],
  reliability: number,
  requiredMinutes: number,
): string | null {
  let cumulative = 0;
  for (const window of windows) {
    cumulative += window.capacityMinutes * reliability;
    if (cumulative >= requiredMinutes) return window.date;
  }
  return null; // never reaches it within the supplied horizon
}

/**
 * §9.2: confidence interval derived from variance in ρ and π. Wider variance
 * (less predictable learner behaviour) widens the interval. Bounded so it
 * never claims false precision or unbounded uncertainty.
 */
export function confidenceIntervalDays(
  requiredMinutes: number,
  availableMinutesPerDay: number,
  reliabilityVariance: number,
  paceVariance: number,
): number {
  if (availableMinutesPerDay <= 0) return 0;
  const daysToComplete = requiredMinutes / availableMinutesPerDay;
  const combinedVariance = Math.min(1, reliabilityVariance + paceVariance);
  return Math.round(daysToComplete * combinedVariance * 0.5);
}

export function assessFeasibility(
  concepts: FeasibilityConceptInput[],
  windows: AvailabilityWindow[],
  learner: LearnerFactors,
  bufferFraction: number,
  reliabilityVariance = 0.1,
  paceVariance = 0.1,
): FeasibilityResult {
  const requiredMinutes = computeRequiredMinutes(concepts, learner.pace);
  const availableMinutes = computeAvailableMinutes(windows, learner.reliability);
  const slackMinutes = availableMinutes - requiredMinutes;
  const slackFraction = requiredMinutes > 0 ? slackMinutes / requiredMinutes : 1;
  const verdict = computeVerdict(requiredMinutes, availableMinutes, bufferFraction);
  const projectedCompletionDate = projectCompletionDate(
    windows,
    learner.reliability,
    requiredMinutes,
  );
  const avgDailyCapacity = windows.length > 0 ? availableMinutes / windows.length || 1 : 1;

  return {
    requiredMinutes,
    availableMinutes,
    slackMinutes,
    slackFraction,
    verdict,
    projectedCompletionDate,
    confidenceIntervalDays: confidenceIntervalDays(
      requiredMinutes,
      avgDailyCapacity,
      reliabilityVariance,
      paceVariance,
    ),
  };
}

export interface ScopeCutOption {
  conceptId: string;
  impactTimesLeverage: number;
  cumulativeMinutesFreed: number;
  verdictAfterCut: FeasibilityVerdict;
}

/**
 * D8 — scope triage. Ranks concepts by ascending `Impact x Leverage` (lowest
 * value, least-blocking first) and reports the arithmetic effect of cutting
 * each prefix. The engine never chooses among remediation levers (§9.3) — it
 * only computes what each option would do.
 */
export function computeScopeTriage(
  concepts: FeasibilityConceptInput[],
  availableMinutes: number,
  bufferFraction: number,
  pace: number,
): ScopeCutOption[] {
  const ranked = [...concepts].sort((a, b) => a.impactTimesLeverage - b.impactTimesLeverage);
  let remainingRequired = computeRequiredMinutes(concepts, pace);
  let cumulativeFreed = 0;
  const options: ScopeCutOption[] = [];

  for (const concept of ranked) {
    const conceptMinutes =
      (concept.remainingLearnMinutes +
        concept.remainingPracticeMinutes +
        concept.projectedReviewMinutes) *
      pace;
    cumulativeFreed += conceptMinutes;
    remainingRequired -= conceptMinutes;
    options.push({
      conceptId: concept.conceptId,
      impactTimesLeverage: concept.impactTimesLeverage,
      cumulativeMinutesFreed: cumulativeFreed,
      verdictAfterCut: computeVerdict(
        Math.max(0, remainingRequired),
        availableMinutes,
        bufferFraction,
      ),
    });
    if (options[options.length - 1]!.verdictAfterCut !== 'not_feasible') break;
  }

  return options;
}
