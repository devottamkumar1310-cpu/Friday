import { describe, expect, it } from 'vitest';
import {
  generateCurriculum,
  validateCurriculum,
  type GeneratedCurriculum,
} from '../agents/curriculum-architect';
import { generateQuestions, validateQuestions } from '../agents/content-generator';
import { runCoachTurn, type CoachEvent } from '../agents/coach';
import { buildContextPacket } from '../context';
import { createFailingProvider, createFixtureProvider } from '../provider/fixture';
import type { CoachExecutors } from '../tools/read-tools';

const CANONICAL = new Set(['physics.mechanics.kinematics-1d', 'physics.mechanics.newtons-laws']);

function curriculum(overrides: Partial<GeneratedCurriculum> = {}): GeneratedCurriculum {
  return {
    subjects: [
      {
        title: 'Physics',
        weight: 1,
        units: [
          {
            title: 'Mechanics',
            topics: [
              {
                title: 'Kinematics',
                concepts: [
                  {
                    key: 'kin',
                    conceptKey: 'physics.mechanics.kinematics-1d',
                    title: 'Kinematics in 1D',
                    estimatedMinutes: 40,
                    difficulty: 2,
                    examWeight: 0.5,
                  },
                  {
                    key: 'newton',
                    conceptKey: 'physics.mechanics.newtons-laws',
                    title: "Newton's Laws",
                    estimatedMinutes: 50,
                    difficulty: 3,
                    examWeight: 0.7,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    edges: [{ from: 'kin', to: 'newton', strength: 1 }],
    ...overrides,
  };
}

describe('Curriculum Architect — structural validation (NFR-7.2)', () => {
  it('accepts a well-formed acyclic curriculum', () => {
    const result = validateCurriculum(curriculum(), CANONICAL);
    expect(result.valid).toBe(true);
    expect(result.conceptCount).toBe(2);
    expect(result.acyclicEdges).toHaveLength(1);
  });

  it('rejects an invented concept_key — the model may not expand the vocabulary (ADR-016)', () => {
    const bad = curriculum();
    bad.subjects[0]!.units[0]!.topics[0]!.concepts[0]!.conceptKey = 'physics.invented.key';
    const result = validateCurriculum(bad, CANONICAL);
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('unknown_concept_key');
  });

  it('accepts a null concept_key — a private concept is a valid, expected state', () => {
    const withNull = curriculum();
    withNull.subjects[0]!.units[0]!.topics[0]!.concepts[0]!.conceptKey = null;
    expect(validateCurriculum(withNull, CANONICAL).valid).toBe(true);
  });

  it('rejects a prerequisite cycle rather than silently repairing it', () => {
    const cyclic = curriculum({
      edges: [
        { from: 'kin', to: 'newton', strength: 1 },
        { from: 'newton', to: 'kin', strength: 1 },
      ],
    });
    const result = validateCurriculum(cyclic, CANONICAL);
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('cycle_detected');
    expect(result.acyclicEdges).toBeUndefined();
  });

  it('rejects an edge pointing at a concept that is not in the tree', () => {
    const dangling = curriculum({ edges: [{ from: 'kin', to: 'ghost', strength: 1 }] });
    const result = validateCurriculum(dangling, CANONICAL);
    expect(result.issues.map((i) => i.code)).toContain('edge_endpoint_missing');
  });

  it('rejects a self-loop', () => {
    const selfLoop = curriculum({ edges: [{ from: 'kin', to: 'kin', strength: 1 }] });
    expect(validateCurriculum(selfLoop, CANONICAL).issues.map((i) => i.code)).toContain(
      'self_loop',
    );
  });

  it('rejects duplicate tree-local keys', () => {
    const dup = curriculum();
    dup.subjects[0]!.units[0]!.topics[0]!.concepts[1]!.key = 'kin';
    expect(validateCurriculum(dup, CANONICAL).issues.map((i) => i.code)).toContain(
      'duplicate_concept_key',
    );
  });

  it('rejects an empty curriculum', () => {
    const empty: GeneratedCurriculum = { subjects: [], edges: [] };
    expect(validateCurriculum(empty, CANONICAL).issues.map((i) => i.code)).toContain(
      'empty_curriculum',
    );
  });
});

describe('Curriculum Architect — generation with repair', () => {
  const input = {
    goalTitle: 'JEE Physics',
    goalType: 'exam',
    scope: 'Mechanics fundamentals',
    targetDate: '2027-05-23',
    canonicalConcepts: [
      { key: 'physics.mechanics.kinematics-1d', title: 'Kinematics 1D', domain: 'physics' },
      { key: 'physics.mechanics.newtons-laws', title: "Newton's Laws", domain: 'physics' },
    ],
  };

  it('returns a validated curriculum on a clean first pass', async () => {
    const provider = createFixtureProvider({
      objects: [
        { agent: 'curriculum_architect', key: 'curriculum_architect', object: curriculum() },
      ],
    });
    const result = await generateCurriculum(provider, input);
    expect(result.validation.valid).toBe(true);
    expect(result.repaired).toBe(false);
  });

  it('propagates a validation failure rather than persisting a broken tree', async () => {
    const cyclic = curriculum({
      edges: [
        { from: 'kin', to: 'newton', strength: 1 },
        { from: 'newton', to: 'kin', strength: 1 },
      ],
    });
    const provider = createFixtureProvider({
      objects: [{ agent: 'curriculum_architect', key: 'curriculum_architect', object: cyclic }],
    });
    const result = await generateCurriculum(provider, input);
    expect(result.repaired).toBe(true); // it tried
    expect(result.validation.valid).toBe(false); // and still refuses to pass it on
  });

  it('surfaces provider failure so the caller can fall back to a template (A6)', async () => {
    await expect(generateCurriculum(createFailingProvider(), input)).rejects.toThrow();
  });
});

describe('Content Generator — self-check (§5.7)', () => {
  const good = {
    type: 'mcq_single' as const,
    difficulty: 3,
    stem: 'A block slides down a frictionless incline. What is its acceleration?',
    options: [
      { id: 'a', text: 'g' },
      { id: 'b', text: 'g sin(theta)' },
    ],
    correctAnswer: { selected: ['b'] },
    explanation: 'Only the component of gravity along the incline accelerates the block.',
  };

  it('passes a well-formed question', () => {
    expect(validateQuestions({ questions: [good] })).toHaveLength(0);
  });

  it('catches an answer key pointing at a non-existent option', () => {
    const issues = validateQuestions({
      questions: [{ ...good, correctAnswer: { selected: ['z'] } }],
    });
    expect(issues.map((i) => i.code)).toContain('answer_not_in_options');
  });

  it('catches an mcq_single with two correct answers', () => {
    const issues = validateQuestions({
      questions: [{ ...good, correctAnswer: { selected: ['a', 'b'] } }],
    });
    expect(issues.map((i) => i.code)).toContain('no_correct_answer');
  });

  it('catches a duplicate stem within one set', () => {
    const issues = validateQuestions({ questions: [good, { ...good }] });
    expect(issues.map((i) => i.code)).toContain('duplicate_stem');
  });

  it('catches a stem the learner has already seen', () => {
    const issues = validateQuestions(
      { questions: [good] },
      new Set([good.stem.trim().toLowerCase()]),
    );
    expect(issues.map((i) => i.code)).toContain('excluded_stem');
  });

  it('drops invalid questions and keeps the good ones', async () => {
    const provider = createFixtureProvider({
      objects: [
        {
          agent: 'content_generator',
          key: 'content_generator',
          object: {
            questions: [
              good,
              { ...good, stem: 'Another question entirely?', correctAnswer: { selected: ['z'] } },
            ],
          },
        },
      ],
    });
    const result = await generateQuestions(provider, {
      conceptKey: 'physics.mechanics.newtons-laws',
      conceptTitle: "Newton's Laws",
      difficulty: 3,
      count: 2,
    });
    expect(result.questions).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
  });
});

describe('Coach — tool-calling loop (§5.5, §5.6)', () => {
  const packet = buildContextPacket(
    { identity: { displayName: 'Aarav', timezone: 'Asia/Kolkata', locale: 'en' } },
    { agent: 'coach' },
  );

  const executors = {
    getGoalStatus: async () => ({
      title: 'JEE',
      targetDate: '2027-05-23',
      daysRemaining: 290,
      weightedProgress: 0.2,
      verdict: 'at_risk' as const,
      projectedCompletionDate: null,
    }),
    getPlan: async () => ({ planVersion: 1, tasks: [] }),
    getMastery: async () => ({ concepts: [] }),
    getWeakConcepts: async () => ({
      concepts: [
        {
          id: '018f3a2b-7c4d-7e1f-9a2b-3c4d5e6f7a8b',
          title: 'Angular Momentum',
          mastery: 0.4,
          examWeight: 0.75,
          evidenceCount: 3,
        },
      ],
    }),
    getDueReviews: async () => ({ dueNow: 0, overdue: 0, concepts: [] }),
    getSessionHistory: async () => ({ sessions: [] }),
    getNextAction: async () => ({
      title: null,
      type: null,
      estimatedMinutes: null,
      rationale: null,
      dominantFactor: null,
    }),
  } satisfies CoachExecutors;

  async function collect(stream: AsyncIterable<CoachEvent>): Promise<CoachEvent[]> {
    const events: CoachEvent[] = [];
    for await (const event of stream) events.push(event);
    return events;
  }

  it('streams start → delta → done for a plain answer', async () => {
    const provider = createFixtureProvider({
      streams: [
        {
          agent: 'coach',
          key: 'coach',
          events: [
            { type: 'delta', text: 'Focus on ' },
            { type: 'delta', text: 'angular momentum.' },
            { type: 'done', usage: { inputTokens: 100, outputTokens: 20, cachedTokens: 80 } },
          ],
        },
      ],
    });

    const events = await collect(
      runCoachTurn({
        provider,
        packet,
        history: [],
        userMessage: 'What should I work on?',
        executors,
        userId: 'user-1',
        messageId: 'msg-1',
      }),
    );

    expect(events[0]).toMatchObject({ type: 'start' });
    expect(events.filter((e) => e.type === 'delta')).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });

  it('executes a requested tool and reports the result', async () => {
    let call = 0;
    const provider = {
      id: 'scripted',
      generateObject: async () => {
        throw new Error('unused');
      },
      async *streamText() {
        call += 1;
        if (call === 1) {
          yield {
            type: 'tool_call' as const,
            toolCallId: 't1',
            name: 'get_weak_concepts',
            args: { limit: 5 },
          };
          yield {
            type: 'done' as const,
            usage: { inputTokens: 50, outputTokens: 5, cachedTokens: 0 },
          };
        } else {
          yield { type: 'delta' as const, text: 'Angular momentum is weakest.' };
          yield {
            type: 'done' as const,
            usage: { inputTokens: 80, outputTokens: 10, cachedTokens: 0 },
          };
        }
      },
    };

    const events = await collect(
      runCoachTurn({
        provider,
        packet,
        history: [],
        userMessage: 'What is my weakest topic?',
        executors,
        userId: 'user-1',
        messageId: 'msg-2',
      }),
    );

    expect(events.some((e) => e.type === 'tool_call' && e.name === 'get_weak_concepts')).toBe(true);
    expect(
      events.some((e) => e.type === 'tool_result' && e.summary === '1 concepts returned'),
    ).toBe(true);
    expect(events.some((e) => e.type === 'delta')).toBe(true);
  });

  it('rejects tool arguments that fail the declared schema, without calling the executor', async () => {
    let executed = false;
    const provider = {
      id: 'scripted',
      generateObject: async () => {
        throw new Error('unused');
      },
      async *streamText() {
        yield {
          type: 'tool_call' as const,
          toolCallId: 't1',
          name: 'get_weak_concepts',
          args: { limit: 999 }, // max is 20
        };
        yield {
          type: 'done' as const,
          usage: { inputTokens: 10, outputTokens: 1, cachedTokens: 0 },
        };
      },
    };

    const events = await collect(
      runCoachTurn({
        provider,
        packet,
        history: [],
        userMessage: 'hi',
        executors: {
          ...executors,
          getWeakConcepts: async () => {
            executed = true;
            return { concepts: [] };
          },
        },
        userId: 'user-1',
        messageId: 'msg-3',
      }),
    );

    expect(executed).toBe(false);
    expect(events.some((e) => e.type === 'tool_call')).toBe(false);
  });

  it('degrades honestly when the provider fails — the core loop is untouched (E-16)', async () => {
    const events = await collect(
      runCoachTurn({
        provider: createFailingProvider(),
        packet,
        history: [],
        userMessage: 'hello',
        executors,
        userId: 'user-1',
        messageId: 'msg-4',
      }),
    );

    const error = events.find((e) => e.type === 'error');
    expect(error).toMatchObject({ type: 'error', code: 'AI_UNAVAILABLE' });
  });

  it('survives a failing tool by telling the model, not by crashing the turn', async () => {
    let pass = 0;
    const provider = {
      id: 'scripted',
      generateObject: async () => {
        throw new Error('unused');
      },
      async *streamText() {
        pass += 1;
        if (pass === 1) {
          yield {
            type: 'tool_call' as const,
            toolCallId: 't1',
            name: 'get_weak_concepts',
            args: { limit: 5 },
          };
          yield {
            type: 'done' as const,
            usage: { inputTokens: 10, outputTokens: 1, cachedTokens: 0 },
          };
        } else {
          yield { type: 'delta' as const, text: 'I could not look that up.' };
          yield {
            type: 'done' as const,
            usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0 },
          };
        }
      },
    };

    const events = await collect(
      runCoachTurn({
        provider,
        packet,
        history: [],
        userMessage: 'weak topics?',
        executors: {
          ...executors,
          getWeakConcepts: async () => {
            throw new Error('db down');
          },
        },
        userId: 'user-1',
        messageId: 'msg-5',
      }),
    );

    expect(events.some((e) => e.type === 'tool_result' && e.summary === 'lookup failed')).toBe(
      true,
    );
    expect(events.some((e) => e.type === 'done')).toBe(true);
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });
});
