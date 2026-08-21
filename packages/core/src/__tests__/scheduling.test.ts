import { describe, expect, it } from 'vitest';
import { DEFAULT_PRIORITY_CONFIG } from '../config';
import { generatePlan, type SchedulingInput } from '../scheduling';
import type { ConceptEdge, ConceptNode } from '../types';

function node(id: string, overrides: Partial<ConceptNode> = {}): ConceptNode {
  return {
    id,
    title: id,
    examWeight: 0.6,
    estimatedMinutes: 30,
    status: 'not_started',
    ...overrides,
  };
}

function baseInput(overrides: Partial<SchedulingInput> = {}): SchedulingInput {
  return {
    today: new Date('2026-01-01T00:00:00Z'),
    windowDays: 14,
    targetDate: new Date('2026-06-01T00:00:00Z'),
    concepts: [],
    edges: [],
    masteryStates: new Map(),
    memoryStates: new Map(),
    windowCapacity: Array.from({ length: 14 }, (_, i) => ({
      date: new Date(new Date('2026-01-01T00:00:00Z').getTime() + i * 86_400_000)
        .toISOString()
        .slice(0, 10),
      capacityMinutes: 60,
    })),
    projectionDailyCapacityMinutes: 60,
    learner: { reliability: 1.0, pace: 1.0 },
    config: DEFAULT_PRIORITY_CONFIG,
    ...overrides,
  };
}

describe('core/scheduling — invariants (IMPLEMENTATION_ROADMAP §7.3 test 1)', () => {
  it('never schedules a concept before its hard prerequisite (I-4)', () => {
    const concepts = [node('algebra'), node('calculus')];
    const edges: ConceptEdge[] = [
      { fromConceptId: 'algebra', toConceptId: 'calculus', type: 'prerequisite_of', strength: 1.0 },
    ];
    const result = generatePlan(baseInput({ concepts, edges }));

    const dateOf = new Map<string, string>();
    for (const day of result.days) {
      for (const task of day.tasks) dateOf.set(task.conceptId, day.date);
    }
    if (dateOf.has('calculus')) {
      expect(dateOf.has('algebra')).toBe(true);
      expect(dateOf.get('algebra')! <= dateOf.get('calculus')!).toBe(true);
    }
  });

  it('never exceeds a day capacity', () => {
    const concepts = Array.from({ length: 20 }, (_, i) => node(`c${i}`, { estimatedMinutes: 45 }));
    const result = generatePlan(
      baseInput({ concepts, windowCapacity: [{ date: '2026-01-01', capacityMinutes: 60 }] }),
    );
    for (const day of result.days) {
      expect(day.plannedMinutes).toBeLessThanOrEqual(day.capacityMinutes);
    }
  });

  it('always terminates, including on a cyclic prerequisite graph (I-6)', () => {
    const concepts = [node('a'), node('b'), node('c')];
    const edges: ConceptEdge[] = [
      { fromConceptId: 'a', toConceptId: 'b', type: 'prerequisite_of', strength: 1.0 },
      { fromConceptId: 'b', toConceptId: 'c', type: 'prerequisite_of', strength: 1.0 },
      { fromConceptId: 'c', toConceptId: 'a', type: 'prerequisite_of', strength: 0.3 },
    ];
    const result = generatePlan(baseInput({ concepts, edges }));
    expect(result.brokenCycles.length).toBeGreaterThan(0);
    expect(result.days.length).toBe(14);
  });

  it('places due reviews before new learning on the same day (§6.3 step 3a, DP8)', () => {
    const concepts = [
      node('review-me', { status: 'in_progress', estimatedMinutes: 20 }),
      node('learn-me', { status: 'not_started', estimatedMinutes: 20 }),
    ];
    const result = generatePlan(
      baseInput({
        concepts,
        memoryStates: new Map([
          [
            'review-me',
            {
              conceptId: 'review-me',
              stability: 1,
              difficulty: 5,
              reps: 3,
              lapses: 0,
              state: 2,
              lastReviewAt: new Date('2025-12-20'),
              dueAt: new Date('2025-12-31'), // already due
            },
          ],
        ]),
        windowCapacity: [{ date: '2026-01-01', capacityMinutes: 20 }],
      }),
    );
    const day1 = result.days[0]!;
    expect(day1.tasks[0]?.conceptId).toBe('review-me');
    expect(day1.tasks[0]?.type).toBe('revise');
  });

  it('projects unplaced concepts beyond the window rather than dropping them silently', () => {
    const concepts = Array.from({ length: 50 }, (_, i) => node(`c${i}`, { estimatedMinutes: 30 }));
    const result = generatePlan(baseInput({ concepts }));
    const placed = new Set(result.days.flatMap((d) => d.tasks.map((t) => t.conceptId)));
    const projected = new Set(result.projection.flatMap((p) => p.conceptIds));
    const stillMissing = concepts.filter(
      (c) =>
        !placed.has(c.id) && !projected.has(c.id) && !result.unscheduledConceptIds.includes(c.id),
    );
    expect(stillMissing).toHaveLength(0);
  });

  it('schedules higher exam weight first when nothing else differs', () => {
    // The controlled version of "exam weight is prioritised". End-to-end the
    // claim is hard to isolate, because prerequisite order legitimately puts
    // low-weight foundations before high-weight advanced work — so it gets
    // proven here, where everything except the weight can be held equal.
    const plan = generatePlan(
      baseInput({
        concepts: [
          node('low', { examWeight: 0.1 }),
          node('high', { examWeight: 0.9 }),
          node('mid', { examWeight: 0.5 }),
        ],
      }),
    );

    const placedOrder = plan.days
      .flatMap((d) => d.tasks.map((t) => t.conceptId))
      .filter((id) => ['low', 'mid', 'high'].includes(id));

    expect(placedOrder).toStrictEqual(['high', 'mid', 'low']);
  });

  it('carries exam weight into the persisted impact factor', () => {
    // Guards the wire between the two: a plan can order correctly and still
    // record a factor breakdown that does not mention why.
    const plan = generatePlan(
      baseInput({ concepts: [node('a', { examWeight: 0.9 }), node('b', { examWeight: 0.1 })] }),
    );
    const tasks = plan.days.flatMap((d) => d.tasks);
    const a = tasks.find((t) => t.conceptId === 'a');
    const b = tasks.find((t) => t.conceptId === 'b');

    expect(a?.structuralFactors.impact).toBeGreaterThan(b!.structuralFactors.impact);
  });

  it('does not schedule a concept the learner already has work in flight on', () => {
    // Regression: a re-plan preserves an in-progress task *and* used to queue a
    // second task for the same concept, so the learner saw it twice.
    const withoutFlag = generatePlan(baseInput({ concepts: [node('a'), node('b')] }));
    expect(withoutFlag.days.flatMap((d) => d.tasks).map((t) => t.conceptId)).toContain('a');

    const plan = generatePlan(
      baseInput({ concepts: [node('a'), node('b')], inFlightConceptIds: new Set(['a']) }),
    );
    const placed = plan.days.flatMap((d) => d.tasks).map((t) => t.conceptId);

    expect(placed).not.toContain('a');
    expect(placed).toContain('b');
  });

  it('lets dependents follow a prerequisite the learner is already working on', () => {
    /**
     * An in-flight concept counts as covered, not as absent.
     *
     * The first implementation filtered in-flight concepts out of the eligible
     * queue, which stopped the duplicate task but also erased them from the
     * graph's notion of what was handled — so every dependent failed its
     * prerequisite check. Because a curriculum typically hangs off one or two
     * roots, that turned "the learner started the first task" into **an empty
     * plan**: a database-backed availability change produced a plan with no
     * tasks in it at all.
     *
     * The learner is working through the prerequisite right now. Its dependents
     * are exactly what should come next.
     */
    const plan = generatePlan(
      baseInput({
        concepts: [node('prereq'), node('dependent')],
        edges: [
          {
            fromConceptId: 'prereq',
            toConceptId: 'dependent',
            type: 'prerequisite_of',
            strength: 0.9,
          },
        ],
        inFlightConceptIds: new Set(['prereq']),
      }),
    );
    const placed = plan.days.flatMap((d) => d.tasks).map((t) => t.conceptId);

    expect(placed, 'no second task for work already underway').not.toContain('prereq');
    expect(placed, 'its dependents are unblocked, not stranded').toContain('dependent');

    // And it is not reported as dropped work — it is being done.
    expect(plan.unscheduledConceptIds).not.toContain('prereq');
  });

  it('assigns structural factors including a plan-position-derived urgency (M0 §1.1)', () => {
    const concepts = [node('a'), node('b')];
    const result = generatePlan(baseInput({ concepts }));
    const allTasks = result.days.flatMap((d) => d.tasks);
    for (const task of allTasks) {
      expect(task.structuralFactors.urgency).toBeGreaterThanOrEqual(0);
      expect(task.structuralFactors.urgency).toBeLessThanOrEqual(1);
    }
  });
});

/**
 * Adaptive task sizing — the Phase 4 capability.
 *
 * A learner who studies in fifteen-minute blocks should get a plan made of
 * fifteen-minute blocks, not a fifty-minute task with a fifteen-minute caption
 * above it. These are the controlled proofs; the database-backed ones live in
 * `apps/web`, where the number the panel quotes and the number on the persisted
 * row have to be the same number.
 */
describe('core/scheduling — adaptive task sizing', () => {
  it('A · no budget means no change — tasks keep their natural size', () => {
    const plan = generatePlan(baseInput({ concepts: [node('a', { estimatedMinutes: 45 })] }));
    const task = plan.days.flatMap((d) => d.tasks)[0];
    expect(task?.estimatedMinutes).toBe(45);
  });

  it('B · a tight budget caps every block, not just the first', () => {
    const plan = generatePlan(
      baseInput({
        concepts: [
          node('a', { estimatedMinutes: 45 }),
          node('b', { estimatedMinutes: 50 }),
          node('c', { estimatedMinutes: 40 }),
        ],
        sessionBudgetMinutes: 20,
      }),
    );
    const tasks = plan.days.flatMap((d) => d.tasks);
    expect(tasks.length).toBeGreaterThan(0);
    for (const t of tasks) expect(t.estimatedMinutes).toBeLessThanOrEqual(20);
  });

  it('D · a generous budget does not inflate anything beyond its estimate', () => {
    const plan = generatePlan(
      baseInput({ concepts: [node('a', { estimatedMinutes: 30 })], sessionBudgetMinutes: 240 }),
    );
    const task = plan.days.flatMap((d) => d.tasks)[0];
    expect(task?.estimatedMinutes).toBe(30);
  });

  it('E · a 50-minute concept under a 15-minute budget yields a real 15-minute block', () => {
    const plan = generatePlan(
      baseInput({ concepts: [node('a', { estimatedMinutes: 50 })], sessionBudgetMinutes: 15 }),
    );
    const tasks = plan.days.flatMap((d) => d.tasks).filter((t) => t.conceptId === 'a');

    expect(tasks[0]?.estimatedMinutes).toBe(15);
    // And the other 35 minutes are not silently forgiven — the concept keeps
    // being scheduled until it is paid off.
    expect(tasks.reduce((sum, t) => sum + t.estimatedMinutes, 0)).toBe(50);
  });

  it('E · the remainder spans days rather than doubling up on one', () => {
    const plan = generatePlan(
      baseInput({ concepts: [node('a', { estimatedMinutes: 50 })], sessionBudgetMinutes: 15 }),
    );
    for (const day of plan.days) {
      const forA = day.tasks.filter((t) => t.conceptId === 'a');
      expect(
        forA.length,
        `${day.date} must not hold two blocks of the same concept`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('F · a concept smaller than the floor is taken whole, never padded', () => {
    const plan = generatePlan(
      baseInput({ concepts: [node('tiny', { estimatedMinutes: 9 })], sessionBudgetMinutes: 15 }),
    );
    const tasks = plan.days.flatMap((d) => d.tasks).filter((t) => t.conceptId === 'tiny');

    expect(tasks[0]?.estimatedMinutes).toBe(9);
    expect(tasks).toHaveLength(1);
  });

  it('G · a budget below the floor fabricates nothing', () => {
    // Better to say "nothing fits" than to hand the learner a four-minute scrap
    // of a fifty-minute topic and call it a study session.
    const plan = generatePlan(
      baseInput({ concepts: [node('a', { estimatedMinutes: 50 })], sessionBudgetMinutes: 5 }),
    );
    expect(plan.days.flatMap((d) => d.tasks)).toStrictEqual([]);

    // Refusing to place it is not the same as losing it: the work still has to
    // show up somewhere the learner can see it, which here is the projection
    // beyond the window.
    const projected = plan.projection.flatMap((p) => p.conceptIds);
    expect([...projected, ...plan.unscheduledConceptIds]).toContain('a');
  });

  it('G · nothing is invented to fill a budget larger than the whole syllabus', () => {
    const plan = generatePlan(
      baseInput({ concepts: [node('a', { estimatedMinutes: 20 })], sessionBudgetMinutes: 120 }),
    );
    const total = plan.days.flatMap((d) => d.tasks).reduce((s, t) => s + t.estimatedMinutes, 0);
    expect(total).toBe(20);
  });

  it('a partially-scheduled prerequisite does not unblock its dependents (I-4)', () => {
    // The invariant most at risk from splitting: half a prerequisite is not a
    // prerequisite. `scheduledConceptIds` only admits fully-allocated concepts.
    const plan = generatePlan(
      baseInput({
        concepts: [
          node('prereq', { estimatedMinutes: 60 }),
          node('dependent', { estimatedMinutes: 20 }),
        ],
        edges: [
          {
            fromConceptId: 'prereq',
            toConceptId: 'dependent',
            type: 'prerequisite_of',
            strength: 0.9,
          },
        ],
        sessionBudgetMinutes: 15,
        windowCapacity: [{ date: '2026-01-01', capacityMinutes: 60 }],
      }),
    );
    const placed = plan.days.flatMap((d) => d.tasks).map((t) => t.conceptId);

    expect(placed).toContain('prereq');
    expect(placed, 'a dependent may not start on a half-finished prerequisite').not.toContain(
      'dependent',
    );
  });

  it('day capacity still wins when it is tighter than the session budget', () => {
    const plan = generatePlan(
      baseInput({
        concepts: [node('a', { estimatedMinutes: 60 })],
        sessionBudgetMinutes: 45,
        windowCapacity: [{ date: '2026-01-01', capacityMinutes: 20 }],
      }),
    );
    expect(plan.days[0]?.tasks[0]?.estimatedMinutes).toBe(20);
  });
});

describe('core/scheduling — the block floor bends to the learner', () => {
  it('a 10-minute budget produces 10-minute blocks, not an empty plan', () => {
    /**
     * Regression for the worst failure this engine has had.
     *
     * The adaptive dial bottoms out at 10 minutes; the block floor was a flat
     * 15. A struggling learner — whose budget had just been cut to 10 precisely
     * because they abandon everything after three minutes — could therefore be
     * given nothing at all, because no block could be smaller than 15. The
     * person most in need of one achievable task got an empty plan, and the
     * persona test hid it because `Math.max()` of an empty array is -Infinity,
     * which satisfies `<= 10`.
     */
    const plan = generatePlan(
      baseInput({ concepts: [node('a', { estimatedMinutes: 50 })], sessionBudgetMinutes: 10 }),
    );
    const tasks = plan.days.flatMap((d) => d.tasks);

    expect(tasks.length, 'a struggling learner must still get work').toBeGreaterThan(0);
    for (const t of tasks) expect(t.estimatedMinutes).toBeLessThanOrEqual(10);
    expect(tasks.reduce((s, t) => s + t.estimatedMinutes, 0)).toBe(50);
  });

  it('an unread learner keeps the default 15-minute floor', () => {
    // The floor only bends for a learner the engine has actually read. With no
    // budget there is no evidence to bend it with.
    const plan = generatePlan(baseInput({ concepts: [node('a', { estimatedMinutes: 12 })] }));
    expect(plan.days.flatMap((d) => d.tasks)[0]?.estimatedMinutes).toBe(12);
  });
});
