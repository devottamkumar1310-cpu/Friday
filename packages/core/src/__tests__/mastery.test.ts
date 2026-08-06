import { describe, expect, it } from 'vitest';
import { effectiveMastery, updateBeliefConfidence, updateMastery } from '../mastery';
import type { EvidenceEvent, MasteryState } from '../types';

function state(overrides: Partial<MasteryState> = {}): MasteryState {
  return {
    conceptId: 'c1',
    mastery: 0.4,
    confidence: 0.3,
    evidenceCount: 2,
    distinctSources: 1,
    outcomeVariance: 0.2,
    lastEvidenceAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function evidence(outcome: number, overrides: Partial<EvidenceEvent> = {}): EvidenceEvent {
  return {
    conceptId: 'c1',
    source: 'assessment',
    outcome,
    occurredAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

const config = { kBase: 0.3, kFloor: 0.05 };

describe('core/mastery — I-1 mastery bounds and monotonicity', () => {
  it('correct evidence never decreases mastery', () => {
    const before = state({ mastery: 0.4 });
    const result = updateMastery(before, evidence(1.0), config);
    expect(result.mastery).toBeGreaterThanOrEqual(before.mastery);
  });

  it('incorrect evidence never increases mastery', () => {
    const before = state({ mastery: 0.4 });
    const result = updateMastery(before, evidence(0.0), config);
    expect(result.mastery).toBeLessThanOrEqual(before.mastery);
  });

  it('mastery always stays within [0,1]', () => {
    let m = state({ mastery: 0.95, confidence: 0.1 });
    for (let i = 0; i < 50; i++) {
      const r = updateMastery(m, evidence(1.0), config);
      m = { ...m, mastery: r.mastery, confidence: r.confidence };
      expect(r.mastery).toBeGreaterThanOrEqual(0);
      expect(r.mastery).toBeLessThanOrEqual(1);
    }
    let m2 = state({ mastery: 0.05, confidence: 0.1 });
    for (let i = 0; i < 50; i++) {
      const r = updateMastery(m2, evidence(0.0), config);
      m2 = { ...m2, mastery: r.mastery, confidence: r.confidence };
      expect(r.mastery).toBeGreaterThanOrEqual(0);
      expect(r.mastery).toBeLessThanOrEqual(1);
    }
  });

  it('adaptive K: low confidence moves the estimate more than high confidence', () => {
    const lowConfidence = state({ mastery: 0.4, confidence: 0.05 });
    const highConfidence = state({ mastery: 0.4, confidence: 0.95 });
    const lowResult = updateMastery(lowConfidence, evidence(1.0), config);
    const highResult = updateMastery(highConfidence, evidence(1.0), config);
    expect(lowResult.mastery - lowConfidence.mastery).toBeGreaterThan(
      highResult.mastery - highConfidence.mastery,
    );
  });
});

describe('core/mastery — belief confidence', () => {
  it('grows with volume, diversity, consistency, and recency, and stays in [0,1]', () => {
    const low = updateBeliefConfidence(
      {
        evidenceCount: 1,
        distinctSources: 1,
        outcomeVariance: 0.8,
        lastEvidenceAt: new Date('2025-01-01T00:00:00Z'),
      },
      new Date('2026-01-01T00:00:00Z'),
    );
    const high = updateBeliefConfidence(
      {
        evidenceCount: 20,
        distinctSources: 3,
        outcomeVariance: 0.0,
        lastEvidenceAt: new Date('2026-01-01T00:00:00Z'),
      },
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(1);
    expect(high).toBeGreaterThan(low);
  });
});

describe('core/mastery — effective mastery (I-2, §5.2)', () => {
  it('equals raw mastery at full retrievability', () => {
    expect(effectiveMastery(0.8, 1.0, 0.35)).toBeCloseTo(0.8, 10);
  });

  it('never falls below phi x raw mastery, even at zero retrievability', () => {
    const phi = 0.35;
    const raw = 0.8;
    expect(effectiveMastery(raw, 0.0, phi)).toBeCloseTo(raw * phi, 10);
  });

  it('is bounded between phi*m and m for any retrievability', () => {
    const raw = 0.6;
    const phi = 0.35;
    for (const r of [0, 0.25, 0.5, 0.75, 1.0]) {
      const eff = effectiveMastery(raw, r, phi);
      expect(eff).toBeGreaterThanOrEqual(raw * phi - 1e-9);
      expect(eff).toBeLessThanOrEqual(raw + 1e-9);
    }
  });
});
