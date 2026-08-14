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
