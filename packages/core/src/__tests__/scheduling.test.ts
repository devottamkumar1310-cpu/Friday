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
