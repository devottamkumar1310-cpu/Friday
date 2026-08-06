import { describe, expect, it } from 'vitest';
import { deriveRatingFromAccuracy, isDue, retrievability, review } from '../retention';

describe('core/retention — FSRS-5 wrapper', () => {
  it('a new review produces a due date in the future', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const state = review('c1', null, 'good', now);
    expect(state.dueAt.getTime()).toBeGreaterThan(now.getTime());
    expect(state.reps).toBe(1);
  });

  it('I-3: repeated successful review monotonically increases the interval', () => {
    let now = new Date('2026-01-01T00:00:00Z');
    let state = review('c1', null, 'good', now);
    let previousInterval = state.dueAt.getTime() - now.getTime();

    for (let i = 0; i < 5; i++) {
      now = state.dueAt;
      state = review('c1', state, 'good', now);
      const interval = state.dueAt.getTime() - now.getTime();
      expect(interval).toBeGreaterThanOrEqual(previousInterval);
      previousInterval = interval;
    }
  });

  it('an "again" rating shortens the next interval relative to "easy"', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const base = review('c1', null, 'good', now);
    const again = review('c1', base, 'again', base.dueAt);
    const easy = review('c1', base, 'easy', base.dueAt);
    const againInterval = again.dueAt.getTime() - base.dueAt.getTime();
    const easyInterval = easy.dueAt.getTime() - base.dueAt.getTime();
    expect(againInterval).toBeLessThan(easyInterval);
  });

  it('retrievability is 1.0 immediately after a review and decays over time', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const state = review('c1', null, 'good', now);
    const immediate = retrievability(state, now);
    const later = retrievability(state, new Date(now.getTime() + 30 * 86_400_000));
    expect(immediate).toBeCloseTo(1.0, 1);
    expect(later).toBeLessThan(immediate);
    expect(later).toBeGreaterThanOrEqual(0);
  });

  it('never-studied concepts have zero retrievability (§6.4 "cannot be forgotten")', () => {
    expect(retrievability(null, new Date())).toBe(0);
  });

  it('isDue reflects the stored due date', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const state = review('c1', null, 'again', now); // short interval
    expect(isDue(state, new Date(state.dueAt.getTime() + 1000))).toBe(true);
    expect(isDue(state, new Date(state.dueAt.getTime() - 1000))).toBe(false);
  });

  it('derives FSRS ratings from assessment accuracy per §5.4', () => {
    expect(deriveRatingFromAccuracy(0.2)).toBe('again');
    expect(deriveRatingFromAccuracy(0.5)).toBe('hard');
    expect(deriveRatingFromAccuracy(0.8)).toBe('good');
    expect(deriveRatingFromAccuracy(0.95)).toBe('easy');
  });
});
