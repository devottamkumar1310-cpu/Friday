import { describe, expect, it } from 'vitest';
import {
  assessFeasibility,
  computeAvailableMinutes,
  computeRequiredMinutes,
  computeScopeTriage,
  computeVerdict,
  projectCompletionDate,
} from '../feasibility';

// Hand-computed fixtures — IMPLEMENTATION_ROADMAP §7.3 test 2: feasibility
// arithmetic is the most trust-critical in the product.

describe('core/feasibility — hand-verified arithmetic (I-7)', () => {
  it('required minutes sums learn+practice+review, scaled by pace', () => {
    const concepts = [
      {
        conceptId: 'a',
        remainingLearnMinutes: 100,
        remainingPracticeMinutes: 20,
        projectedReviewMinutes: 10,
        impactTimesLeverage: 0.5,
      },
      {
        conceptId: 'b',
        remainingLearnMinutes: 50,
        remainingPracticeMinutes: 0,
        projectedReviewMinutes: 0,
        impactTimesLeverage: 0.2,
      },
    ];
    // raw = (100+20+10) + (50+0+0) = 180; pace 1.4 => 252
    expect(computeRequiredMinutes(concepts, 1.4)).toBeCloseTo(252, 6);
  });

  it('available minutes sums daily capacity scaled by reliability', () => {
    const windows = [
      { date: '2026-01-01', capacityMinutes: 60 },
      { date: '2026-01-02', capacityMinutes: 90 },
    ];
    // raw = 150, reliability 0.8 => 120
    expect(computeAvailableMinutes(windows, 0.8)).toBeCloseTo(120, 6);
  });

  it('verdict boundaries: on_track >= 15% buffer, at_risk in [0,15%), not_feasible < 0', () => {
    expect(computeVerdict(1000, 1150, 0.15)).toBe('on_track'); // slack exactly 15%
    expect(computeVerdict(1000, 1100, 0.15)).toBe('at_risk'); // slack 10%
    expect(computeVerdict(1000, 999, 0.15)).toBe('not_feasible'); // negative slack
    expect(computeVerdict(1000, 1000, 0.15)).toBe('at_risk'); // slack exactly 0
  });

  it('projected completion is the earliest day cumulative capacity meets the requirement', () => {
    const windows = [
      { date: '2026-01-01', capacityMinutes: 50 },
      { date: '2026-01-02', capacityMinutes: 50 },
      { date: '2026-01-03', capacityMinutes: 50 },
    ];
    // reliability 1.0, required 120 -> cumulative 50,100,150 -> day 3
    expect(projectCompletionDate(windows, 1.0, 120)).toBe('2026-01-03');
    expect(projectCompletionDate(windows, 1.0, 1000)).toBeNull();
  });

  it('full assessment matches the hand-computed on_track example', () => {
    const concepts = [
      {
        conceptId: 'a',
        remainingLearnMinutes: 400,
        remainingPracticeMinutes: 100,
        projectedReviewMinutes: 100,
        impactTimesLeverage: 0.6,
      },
    ];
    const windows = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      capacityMinutes: 90,
    }));
    // required = 600 * pace(1.0) = 600; available = 900 * reliability(1.0) = 900
    // slack = 300, 300/600 = 50% >= 15% -> on_track
    const result = assessFeasibility(concepts, windows, { reliability: 1.0, pace: 1.0 }, 0.15);
    expect(result.requiredMinutes).toBe(600);
    expect(result.availableMinutes).toBe(900);
    expect(result.slackMinutes).toBe(300);
    expect(result.verdict).toBe('on_track');
  });

  it('scope triage ranks by ascending Impact x Leverage and reports the arithmetic effect', () => {
    const concepts = [
      {
        conceptId: 'high-value',
        remainingLearnMinutes: 100,
        remainingPracticeMinutes: 0,
        projectedReviewMinutes: 0,
        impactTimesLeverage: 0.9,
      },
      {
        conceptId: 'low-value',
        remainingLearnMinutes: 100,
        remainingPracticeMinutes: 0,
        projectedReviewMinutes: 0,
        impactTimesLeverage: 0.1,
      },
    ];
    // required = 200, available = 150 -> not_feasible; cutting low-value (100) -> required 100 <= 150 -> feasible
    const options = computeScopeTriage(concepts, 150, 0.15, 1.0);
    expect(options[0]!.conceptId).toBe('low-value');
    expect(options[0]!.verdictAfterCut).not.toBe('not_feasible');
  });
});
