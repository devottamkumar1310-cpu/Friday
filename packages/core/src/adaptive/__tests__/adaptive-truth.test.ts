import { describe, expect, it } from 'vitest';
import {
  computeAdaptiveProfile,
  renderDirective,
  type AdaptiveProfile,
  type SessionObservation,
} from '../index';

/**
 * The truth guard.
 *
 * An audit found FRIDAY announcing three plan changes it never made: "cut your
 * daily load to 60%", "put easier material first", "turned up how much I
 * explain". Nothing in the product read `workloadMultiplier`, `difficultyBias`
 * or `guidance` — the dials were computed, printed, and ignored. Three of the
 * four things the panel claimed were fiction, on the one screen whose entire
 * job is to be believed.
 *
 * This file is the regression that makes reintroducing that class of lie fail
 * CI rather than ship. It asserts over every learner-facing string the engine
 * can emit, for every persona, that:
 *
 *   1. no vocabulary from an unenforced dial appears, and
 *   2. every minute figure quoted is one the planner is actually given.
 *
 * The invariant, stated once:
 *
 *   OBSERVATION -> DECISION -> ACTUAL PLANNER CHANGE -> EXPLANATION
 *
 * If a future dial earns a real consumer, add it to `ENFORCED` deliberately —
 * that edit is the moment somebody has to prove the consumer exists.
 */

const TZ = 'Asia/Kolkata';
const NOW = new Date('2026-08-10T12:00:00Z');

function s(
  daysAgo: number,
  status: SessionObservation['status'],
  activeMinutes = 30,
  localHour = 17,
): SessionObservation {
  const utcHour = localHour - 5.5;
  const day = new Date(NOW.getTime() - daysAgo * 86_400_000);
  day.setUTCHours(Math.floor(utcHour), (utcHour % 1) * 60, 0, 0);
  return { startedAt: day, status, activeMinutes, plannedMinutes: 30 };
}

/**
 * Vocabulary that may not appear in anything a learner reads, because the
 * product does not do any of it. Each pattern is a claim, not a topic — the
 * point is to catch "I raised your workload", not to ban the word "plan".
 */
const FORBIDDEN: { pattern: RegExp; claim: string }[] = [
  { pattern: /daily load/i, claim: 'workload was changed' },
  { pattern: /% of plan/i, claim: 'workload was scaled' },
  { pattern: /\bworkload\b/i, claim: 'workload was changed' },
  { pattern: /easier material/i, claim: 'task difficulty was reordered' },
  { pattern: /harder (concepts|material)/i, claim: 'task difficulty was reordered' },
  { pattern: /up the queue/i, claim: 'task ordering was changed' },
  { pattern: /guidance/i, claim: 'guidance level was changed' },
  { pattern: /hand-holding/i, claim: 'guidance level was changed' },
  { pattern: /step-by-step/i, claim: 'guidance level was changed' },
  { pattern: /how much I explain/i, claim: 'guidance level was changed' },
  { pattern: /difficulty/i, claim: 'difficulty was changed' },
];

/** Every persona the engine can land on, including the awkward middles. */
const PERSONAS: Record<string, SessionObservation[]> = {
  new: [],
  'one session': [s(1, 'completed', 20)],
  'just under threshold': [s(1, 'completed', 20), s(2, 'completed', 20)],
  struggling: [
    ...[8, 9, 10, 11].map((d) => s(d, 'abandoned', 3)),
    s(1, 'completed', 12),
    s(3, 'completed', 10),
  ],
  'struggling at the floor': [
    ...[1, 2, 3, 4, 5, 6].map((d) => s(d, 'abandoned', 2)),
    s(8, 'completed', 4),
  ],
  declining: [
    ...[6, 7, 8, 9, 10, 11].map((d) => s(d, 'completed', 40)),
    s(1, 'abandoned', 3),
    s(2, 'abandoned', 4),
    s(3, 'completed', 6),
  ],
  improving: [
    ...[6, 7, 8, 9, 10].map((d) => s(d, 'abandoned', 4)),
    ...[1, 2, 3].map((d) => s(d, 'completed', 45)),
  ],
  'improving at the ceiling': [
    ...[6, 7, 8, 9, 10].map((d) => s(d, 'completed', 55)),
    ...[1, 2, 3].map((d) => s(d, 'completed', 60)),
  ],
  steady: [1, 3, 5, 8, 10].map((d) => s(d, 'completed', 30)),
  thriving: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => s(d, 'completed', 40)),
  'missed a week then returned': [
    ...[16, 17, 18, 19].map((d) => s(d, 'completed', 35)),
    ...[1, 2, 3].map((d) => s(d, 'completed', 35)),
  ],
  'slid backwards across fortnights': [
    ...[16, 17, 18, 19, 20, 21, 22, 23].map((d) => s(d, 'completed', 40)),
    ...[1, 3, 5].map((d) => s(d, 'abandoned', 3)),
    s(7, 'completed', 10),
  ],
};

/** Everything the learner can read, from one profile. */
function learnerFacingStrings(profile: AdaptiveProfile): string[] {
  const directive = renderDirective(profile, {
    taskTitle: "Newton's Third Law",
    estimatedMinutes: 50,
  });
  return [
    ...profile.observations.flatMap((o) => [o.statement, o.evidence]),
    ...profile.decisions.flatMap((d) => [d.change, d.because]),
    directive.text,
  ];
}

describe('adaptive truth', () => {
  for (const [name, sessions] of Object.entries(PERSONAS)) {
    it(`"${name}" claims nothing the product does not do`, () => {
      const profile = computeAdaptiveProfile({ sessions, timeZone: TZ, now: NOW });

      for (const text of learnerFacingStrings(profile)) {
        for (const { pattern, claim } of FORBIDDEN) {
          expect(
            pattern.test(text),
            `"${name}" tells the learner ${claim}, which nothing in the product does:\n  ${text}`,
          ).toBe(false);
        }
      }
    });

    it(`"${name}" quotes only minute figures the planner is actually given`, () => {
      const profile = computeAdaptiveProfile({ sessions, timeZone: TZ, now: NOW });
      const directive = renderDirective(profile, {
        taskTitle: "Newton's Third Law",
        estimatedMinutes: 50,
      });

      // The two numbers that reach a real consumer: the budget the Next Action
      // is ranked against, and the time box derived from it.
      const enforced = new Set([profile.targetSessionMinutes, directive.committedMinutes]);

      for (const decision of profile.decisions) {
        for (const match of decision.change.matchAll(/(\d+)\s*minute/g)) {
          expect(
            enforced.has(Number(match[1])),
            `"${name}" claims a ${match[1]}-minute change, but the planner is given ` +
              `${profile.targetSessionMinutes}:\n  ${decision.change}`,
          ).toBe(true);
        }
        // A percentage in a decision is a scaling claim, and nothing scales.
        expect(decision.change, `"${name}" quotes a percentage change`).not.toMatch(/\d+\s*%/);
      }
    });
  }

  it('the profile carries no dial without a consumer', () => {
    const profile = computeAdaptiveProfile({
      sessions: PERSONAS['thriving']!,
      timeZone: TZ,
      now: NOW,
    });

    // Structural, not cosmetic: these fields were deleted, and a field that
    // exists is one a future decision string will reach for.
    for (const dead of ['workloadMultiplier', 'difficultyBias', 'guidance']) {
      expect(
        Object.hasOwn(profile, dead),
        `${dead} is back on the profile — prove a consumer reads it before re-adding`,
      ).toBe(false);
    }
  });

  it('never claims a cut when the number did not move', () => {
    // A learner already pinned at the ten-minute floor: the trend fires, but
    // there is nowhere further down to go, and saying "cut to 10" would be the
    // same lie one level smaller.
    const profile = computeAdaptiveProfile({
      sessions: PERSONAS['struggling at the floor']!,
      timeZone: TZ,
      now: NOW,
    });

    const change = profile.decisions[0]?.change ?? '';
    if (/^Cut /.test(change)) {
      // If it claims a cut, the number must genuinely be below the band baseline.
      expect(profile.targetSessionMinutes).toBeLessThan(25);
    }
    expect(change).toMatch(/\d+ minutes/);
  });
});
