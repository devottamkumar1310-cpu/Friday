import { describe, expect, it } from 'vitest';
import { DEFAULT_PRIORITY_CONFIG } from '../config';
import {
  AT_RISK_RETRIEVABILITY,
  MASTERY_THRESHOLD,
  PROVISIONAL_CONFIDENCE,
  computeRetentionHealth,
  computeVelocity,
  computeWeightedProgress,
  rankWeakConcepts,
  type ProgressInput,
  type WeakConceptInput,
} from '../intelligence';
import type { ConceptNode, MasteryState } from '../types';

const { phi, lambda } = DEFAULT_PRIORITY_CONFIG;

function concept(id: string, overrides: Partial<ConceptNode> = {}): ConceptNode {
  return {
    id,
    title: id,
    examWeight: 0.5,
    estimatedMinutes: 30,
    status: 'in_progress',
    ...overrides,
  };
}

function mastery(value: number, overrides: Partial<MasteryState> = {}): MasteryState {
  return {
    conceptId: 'c',
    mastery: value,
    confidence: 0.6,
    evidenceCount: 5,
    distinctSources: 2,
    outcomeVariance: 0.1,
    lastEvidenceAt: new Date('2026-08-01'),
    ...overrides,
  };
}

describe('core/intelligence — weighted progress (roadmap 2.1)', () => {
  it('weights by exam weight, not by concept count', () => {
    const inputs: ProgressInput[] = [
      // Heavy concept fully mastered, light concept untouched.
      {
        concept: concept('heavy', { examWeight: 0.9 }),
        masteryState: mastery(1),
        retrievability: 1,
      },
      {
        concept: concept('light', { examWeight: 0.1 }),
        masteryState: mastery(0),
        retrievability: 0,
      },
    ];
    const result = computeWeightedProgress(inputs, phi);
    // Hand-check: earned = 0.9x1 + 0.1x0 = 0.9; total = 1.0 -> 0.9
    expect(result.weightedProgress).toBeCloseTo(0.9, 6);
    // The unweighted mean would be 0.5 — materially more pessimistic.
    expect(result.rawProgress).toBeCloseTo(0.5, 6);
  });

  it('excludes excluded and already_known concepts from the denominator', () => {
    const inputs: ProgressInput[] = [
      { concept: concept('a'), masteryState: mastery(1), retrievability: 1 },
      { concept: concept('b', { status: 'excluded' }), masteryState: null, retrievability: 0 },
      { concept: concept('c', { status: 'already_known' }), masteryState: null, retrievability: 0 },
    ];
    expect(computeWeightedProgress(inputs, phi).conceptsTotal).toBe(1);
  });

  it('counts a concept mastered only at the threshold', () => {
    const justUnder: ProgressInput[] = [
      { concept: concept('a'), masteryState: mastery(MASTERY_THRESHOLD - 0.01), retrievability: 1 },
    ];
    const justOver: ProgressInput[] = [
      { concept: concept('a'), masteryState: mastery(MASTERY_THRESHOLD + 0.01), retrievability: 1 },
    ];
    expect(computeWeightedProgress(justUnder, phi).conceptsMastered).toBe(0);
    expect(computeWeightedProgress(justOver, phi).conceptsMastered).toBe(1);
  });

  it('separates never-started from in-progress', () => {
    const inputs: ProgressInput[] = [
      { concept: concept('a'), masteryState: mastery(0.4), retrievability: 1 },
      { concept: concept('b'), masteryState: null, retrievability: 0 },
    ];
    const result = computeWeightedProgress(inputs, phi);
    expect(result.conceptsInProgress).toBe(1);
    expect(result.conceptsNotStarted).toBe(1);
  });

  it('returns zero, not NaN, for an empty curriculum', () => {
    const result = computeWeightedProgress([], phi);
    expect(result.weightedProgress).toBe(0);
    expect(Number.isNaN(result.rawProgress)).toBe(false);
  });

  it('reflects decay — the same raw mastery scores lower when retrievability drops', () => {
    const fresh = computeWeightedProgress(
      [{ concept: concept('a'), masteryState: mastery(0.8), retrievability: 1 }],
      phi,
    );
    const stale = computeWeightedProgress(
      [{ concept: concept('a'), masteryState: mastery(0.8), retrievability: 0 }],
      phi,
    );
    expect(stale.weightedProgress).toBeLessThan(fresh.weightedProgress);
  });
});

describe('core/intelligence — weak-concept ranking (roadmap 2.2)', () => {
  function weak(id: string, overrides: Partial<WeakConceptInput> = {}): WeakConceptInput {
    return {
      concept: concept(id),
      masteryState: mastery(0.4),
      retrievability: 1,
      directUnlockCount: 0,
      ...overrides,
    };
  }

  it('excludes never-studied concepts — unstarted is not weak (E-1)', () => {
    const ranked = rankWeakConcepts(
      [
        weak('studied', { masteryState: mastery(0.3, { evidenceCount: 4 }) }),
        weak('untouched', { masteryState: null }),
        weak('zero-evidence', { masteryState: mastery(0, { evidenceCount: 0 }) }),
      ],
      { phi, lambda },
    );
    expect(ranked.map((r) => r.conceptId)).toEqual(['studied']);
  });

  it('ranks by exam weight x gap x leverage, not by raw mastery alone', () => {
    const ranked = rankWeakConcepts(
      [
        // Lower mastery, but trivial exam weight and no leverage.
        weak('trivial', {
          concept: concept('trivial', { examWeight: 0.05 }),
          masteryState: mastery(0.1),
        }),
        // Higher mastery, but heavy and unlocks a lot.
        weak('pivotal', {
          concept: concept('pivotal', { examWeight: 0.9 }),
          masteryState: mastery(0.5),
          directUnlockCount: 10,
        }),
      ],
      { phi, lambda },
    );
    expect(ranked[0]!.conceptId).toBe('pivotal');
  });

  it('marks a low-confidence estimate provisional rather than asserting weakness', () => {
    const ranked = rankWeakConcepts(
      [weak('shaky', { masteryState: mastery(0.3, { confidence: 0.1, evidenceCount: 8 }) })],
      { phi, lambda },
    );
    expect(ranked[0]!.evidence.provisional).toBe(true);
  });

  it('marks a single observation provisional even when kappa looks healthy', () => {
    // Regression: with one data point there is no outcome variance, so the
    // consistency input to kappa scores as perfect and pushes it above the
    // threshold. One answer is not evidence of weakness, so the count is
    // checked directly rather than trusting kappa alone.
    const ranked = rankWeakConcepts(
      [weak('single', { masteryState: mastery(0.3, { confidence: 0.525, evidenceCount: 1 }) })],
      { phi, lambda },
    );
    expect(ranked[0]!.evidence.beliefConfidence).toBeGreaterThan(PROVISIONAL_CONFIDENCE);
    expect(ranked[0]!.evidence.provisional).toBe(true);
  });

  it('carries the evidence drill-down the deliverable calls for', () => {
    const ranked = rankWeakConcepts(
      [weak('c1', { masteryState: mastery(0.3, { evidenceCount: 7, confidence: 0.8 }) })],
      { phi, lambda },
    );
    expect(ranked[0]!.evidence).toMatchObject({
      evidenceCount: 7,
      beliefConfidence: 0.8,
      provisional: false,
    });
    expect(ranked[0]!.evidence.lastEvidenceAt).toBeInstanceOf(Date);
  });

  it('respects the limit and is deterministic on ties (DP2)', () => {
    const inputs = ['a', 'b', 'c', 'd'].map((id) => weak(id));
    const first = rankWeakConcepts(inputs, { phi, lambda, limit: 2 });
    const second = rankWeakConcepts(inputs, { phi, lambda, limit: 2 });
    expect(first).toHaveLength(2);
    expect(first.map((r) => r.conceptId)).toEqual(second.map((r) => r.conceptId));
  });
});

describe('core/intelligence — velocity', () => {
  it('compares observed pace against what the deadline requires', () => {
    const v = computeVelocity({
      progressStart: 0.2,
      progressEnd: 0.3,
      windowDays: 7,
      daysRemaining: 70,
    });
    // Gained 0.10 in one week; needs 0.70 over 10 weeks = 0.07/week.
    expect(v.perWeek).toBeCloseTo(0.1, 6);
    expect(v.requiredPerWeek).toBeCloseTo(0.07, 6);
    expect(v.trend).toBe('ahead');
  });

  it('reports declining when pace falls short', () => {
    const v = computeVelocity({
      progressStart: 0.2,
      progressEnd: 0.21,
      windowDays: 7,
      daysRemaining: 70,
    });
    expect(v.trend).toBe('declining');
  });

  it('does not divide by zero on the target date', () => {
    const v = computeVelocity({
      progressStart: 0.5,
      progressEnd: 0.5,
      windowDays: 7,
      daysRemaining: 0,
    });
    expect(Number.isFinite(v.requiredPerWeek)).toBe(true);
  });
});

describe('core/intelligence — retention health', () => {
  const now = new Date('2026-08-06T12:00:00Z');

  it('counts due, overdue, and at-risk separately', () => {
    const health = computeRetentionHealth(
      [
        { retrievability: 0.9, dueAt: new Date('2026-08-10'), reps: 3 }, // future
        { retrievability: 0.8, dueAt: new Date('2026-08-06T06:00:00Z'), reps: 3 }, // due today
        { retrievability: 0.3, dueAt: new Date('2026-08-01'), reps: 3 }, // overdue + at risk
      ],
      now,
    );
    expect(health.dueNow).toBe(2);
    expect(health.overdue).toBe(1);
    expect(health.atRisk).toBe(1);
  });

  it('ignores never-studied concepts entirely', () => {
    const health = computeRetentionHealth(
      [{ retrievability: 0, dueAt: new Date('2026-01-01'), reps: 0 }],
      now,
    );
    expect(health).toEqual({ dueNow: 0, overdue: 0, atRisk: 0 });
  });

  it('uses the documented at-risk threshold', () => {
    const justAbove = computeRetentionHealth(
      [{ retrievability: AT_RISK_RETRIEVABILITY + 0.01, dueAt: new Date('2026-08-10'), reps: 2 }],
      now,
    );
    const justBelow = computeRetentionHealth(
      [{ retrievability: AT_RISK_RETRIEVABILITY - 0.01, dueAt: new Date('2026-08-10'), reps: 2 }],
      now,
    );
    expect(justAbove.atRisk).toBe(0);
    expect(justBelow.atRisk).toBe(1);
  });
});
