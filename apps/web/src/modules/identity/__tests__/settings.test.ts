import { describe, expect, it } from 'vitest';
import { weeklyMinutes } from '../settings.service';

/**
 * Availability arithmetic.
 *
 * This number is not cosmetic: it is the `AvailableMinutes` term in the
 * feasibility verdict (§9). If it is wrong, FRIDAY lies to a learner about
 * whether they will finish — which the roadmap calls the worst possible bug in
 * the product (§7.3, test 2).
 */

function rule(startTime: string, endTime: string, kind: 'available' | 'blocked' = 'available') {
  return { startTime, endTime, kind };
}

describe('weeklyMinutes', () => {
  it('sums available slots', () => {
    // 18:00–20:30 is 150 minutes, five times over.
    expect(weeklyMinutes(Array.from({ length: 5 }, () => rule('18:00', '20:30')))).toBe(750);
  });

  it('subtracts blocked slots', () => {
    expect(weeklyMinutes([rule('09:00', '17:00'), rule('12:00', '13:00', 'blocked')])).toBe(
      480 - 60,
    );
  });

  it('handles the seeded weekly pattern', () => {
    // Five weekday evenings at 2.5h plus a 3h Saturday = 15.5h = 930 minutes.
    const rules = [
      ...Array.from({ length: 5 }, () => rule('18:00', '20:30')),
      rule('09:00', '12:00'),
    ];
    expect(weeklyMinutes(rules)).toBe(930);
  });

  it('handles half-hour boundaries without drift', () => {
    expect(weeklyMinutes([rule('18:30', '19:00')])).toBe(30);
    expect(weeklyMinutes([rule('23:00', '23:30')])).toBe(30);
  });

  it('treats an inverted slot as zero rather than negative', () => {
    // The service rejects these, but the arithmetic must not produce a negative
    // capacity if one ever reaches it — that would inflate feasibility.
    expect(weeklyMinutes([rule('20:00', '18:00')])).toBe(0);
  });

  it('returns zero for no rules — E-6, never invented capacity', () => {
    expect(weeklyMinutes([])).toBe(0);
  });
});
