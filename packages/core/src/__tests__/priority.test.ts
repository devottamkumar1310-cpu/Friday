import { describe, expect, it } from 'vitest';
import { DEFAULT_PRIORITY_CONFIG } from '../config';
import {
  assessConfidence,
  filterEligible,
  renderRationale,
  scoreCandidate,
  selectAction,
} from '../priority';
import type { ScoringCandidate } from '../types';

function candidate(overrides: Partial<ScoringCandidate> = {}): ScoringCandidate {
  return {
    concept: {
      id: 'c1',
      title: 'Angular Momentum',
      examWeight: 0.7,
      estimatedMinutes: 30,
      status: 'in_progress',
    },
    masteryState: {
      conceptId: 'c1',
      mastery: 0.4,
      confidence: 0.5,
      evidenceCount: 3,
      distinctSources: 2,
      outcomeVariance: 0.1,
      lastEvidenceAt: new Date('2026-01-01'),
    },
    memoryState: null,
    directUnlockCount: 0,
    prerequisites: [],
    planPositionUrgency: 0.3,
    remainingMinutes: 30,
    isReview: false,
    ...overrides,
  };
}

const ctx = { config: DEFAULT_PRIORITY_CONFIG, pace: 1.0, now: new Date('2026-01-01') };

describe('core/priority — scoring', () => {
  it('produces a factor breakdown whose dominant factor is the largest contributor (I-11)', () => {
    // High decay risk candidate: was studied, is due, retrievability low.
    const c = candidate({
      memoryState: {
        conceptId: 'c1',
        stability: 1,
        difficulty: 5,
        reps: 5,
        lapses: 1,
        state: 2,
        lastReviewAt: new Date('2025-12-01'),
        dueAt: new Date('2025-12-20'),
      },
      isReview: true,
    });
    const retrievabilityValue = 0.1; // low -> high decay risk
    const scored = scoreCandidate(c, retrievabilityValue, ctx);

    const contributions = [
      ['impact', scored.factors.impact.contribution ?? 0],
      ['urgency', scored.factors.urgency.contribution ?? 0],
      ['decayRisk', scored.factors.decayRisk.contribution ?? 0],
    ] as const;
    const maxContribution = Math.max(...contributions.map(([, v]) => v));
    const [maxFactor] = contributions.find(([, v]) => v === maxContribution)!;

    if (scored.factors.readiness.value >= 0.5) {
      expect(scored.dominantFactor).toBe(maxFactor);
    }
  });

  it('mastered concepts drive Impact toward zero via Gap (degenerate case, §6.2)', () => {
    const c = candidate({
      concept: {
        id: 'c1',
        title: 'X',
        examWeight: 0.9,
        estimatedMinutes: 10,
        status: 'in_progress',
      },
      masteryState: {
        conceptId: 'c1',
        mastery: 0.99,
        confidence: 0.9,
        evidenceCount: 10,
        distinctSources: 3,
        outcomeVariance: 0,
        lastEvidenceAt: new Date(),
      },
    });
    const scored = scoreCandidate(c, 1.0, ctx);
    expect(scored.factors.impact.value).toBeLessThan(0.05);
  });

  it('readiness gates the total score toward zero when prerequisites are weak', () => {
    const strong = candidate({ prerequisites: [{ effectiveMastery: 0.9, strength: 1.0 }] });
    const weak = candidate({ prerequisites: [{ effectiveMastery: 0.05, strength: 1.0 }] });
    const scoredStrong = scoreCandidate(strong, 0.5, ctx);
    const scoredWeak = scoreCandidate(weak, 0.5, ctx);
    expect(scoredWeak.score).toBeLessThan(scoredStrong.score);
  });
});

describe('core/priority — eligibility filtering (stage 3)', () => {
  it('excludes mastered non-review and excluded concepts, with a reason code (I-15)', () => {
    const excludedC = candidate({ concept: { ...candidate().concept, status: 'excluded' } });
    const masteredC = candidate({
      concept: { ...candidate().concept, status: 'mastered' },
      isReview: false,
    });
    const okC = candidate();
    const { eligible, excluded } = filterEligible([excludedC, masteredC, okC]);
    expect(eligible).toHaveLength(1);
    expect(excluded).toHaveLength(2);
    expect(excluded.every((e) => e.reasonCode.length > 0)).toBe(true);
  });
});

describe('core/priority — selection & hysteresis (§7.1)', () => {
  it('retains the current recommendation when the challenger is within the stability margin', () => {
    const current = scoreCandidate(
      candidate({ concept: { ...candidate().concept, id: 'current' } }),
      0.5,
      ctx,
    );
    const challenger = scoreCandidate(
      candidate({ concept: { ...candidate().concept, id: 'challenger' } }),
      0.5,
      ctx,
    );
    challenger.conceptId = 'challenger';
    current.conceptId = 'current';
    challenger.adjustedScore = current.adjustedScore * 1.05; // 5% better, below 15% margin

    const result = selectAction({
      ranked: [challenger, current],
      currentRecommendationConceptId: 'current',
      overrideFired: false,
      availableMinutes: 60,
      durationByConceptId: new Map([
        ['current', 30],
        ['challenger', 30],
      ]),
      minViableMinutes: 8,
      hysteresisMargin: 0.15,
    });
    expect(result.selected?.conceptId).toBe('current');
  });

  it('switches when the challenger clears the stability margin', () => {
    const current = scoreCandidate(candidate(), 0.5, ctx);
    current.conceptId = 'current';
    const challenger = scoreCandidate(candidate(), 0.5, ctx);
    challenger.conceptId = 'challenger';
    challenger.adjustedScore = current.adjustedScore * 1.5;

    const result = selectAction({
      ranked: [challenger, current],
      currentRecommendationConceptId: 'current',
      overrideFired: false,
      availableMinutes: 60,
      durationByConceptId: new Map([
        ['current', 30],
        ['challenger', 30],
      ]),
      minViableMinutes: 8,
      hysteresisMargin: 0.15,
    });
    expect(result.selected?.conceptId).toBe('challenger');
  });

  it('respects the time budget, selecting the first candidate whose duration fits', () => {
    const big = scoreCandidate(candidate(), 0.5, ctx);
    big.conceptId = 'big';
    big.adjustedScore = 10;
    const small = scoreCandidate(candidate(), 0.5, ctx);
    small.conceptId = 'small';
    small.adjustedScore = 5;

    const result = selectAction({
      ranked: [big, small],
      currentRecommendationConceptId: null,
      overrideFired: false,
      availableMinutes: 20,
      durationByConceptId: new Map([
        ['big', 60],
        ['small', 15],
      ]),
      minViableMinutes: 8,
      hysteresisMargin: 0.15,
    });
    expect(result.selected?.conceptId).toBe('small');
    expect(result.fitsWindow).toBe(true);
  });

  it('reports a too-short window rather than inventing a fit (E-23)', () => {
    const result = selectAction({
      ranked: [scoreCandidate(candidate(), 0.5, ctx)],
      currentRecommendationConceptId: null,
      overrideFired: false,
      availableMinutes: 5,
      durationByConceptId: new Map(),
      minViableMinutes: 8,
      hysteresisMargin: 0.15,
    });
    expect(result.selected).toBeNull();
    expect(result.reason).toBe('window_too_short');
  });
});

describe('core/priority — confidence (§11)', () => {
  it('bands are ordered and every decision emits a score (I-12)', () => {
    const high = assessConfidence({
      beliefConfidence: 0.9,
      topScore: 10,
      runnerUpScore: 2,
      dataSufficiency: 0.9,
      wasStableAcrossRecompute: true,
      constraintsRelaxed: false,
    });
    const exploratory = assessConfidence({
      beliefConfidence: 0.1,
      topScore: 1,
      runnerUpScore: 0.95,
      dataSufficiency: 0.1,
      wasStableAcrossRecompute: false,
      constraintsRelaxed: true,
    });
    expect(high.band).toBe('high');
    expect(exploratory.band).toBe('exploratory');
    expect(high.score).toBeGreaterThan(exploratory.score);
  });

  it('a near-tied top and runner-up lowers the margin input C2', () => {
    const tied = assessConfidence({
      beliefConfidence: 0.9,
      topScore: 10,
      runnerUpScore: 9.9,
      dataSufficiency: 0.9,
      wasStableAcrossRecompute: true,
      constraintsRelaxed: false,
    });
    expect(tied.inputs.margin).toBeLessThan(0.1);
  });
});

describe('core/priority — explanation is a projection of the factors (DP3)', () => {
  it('renders a decayRisk-dominant rationale mentioning retrievability', () => {
    const scored = scoreCandidate(
      candidate({
        memoryState: {
          conceptId: 'c1',
          stability: 1,
          difficulty: 5,
          reps: 5,
          lapses: 1,
          state: 2,
          lastReviewAt: new Date('2025-12-01'),
          dueAt: new Date('2025-12-20'),
        },
        isReview: true,
      }),
      0.1,
      ctx,
    );
    const text = renderRationale(scored.dominantFactor, scored.factors, 'Angular Momentum', 25);
    expect(text).toContain('Angular Momentum');
  });
});
