import { describe, expect, it } from 'vitest';
import {
  TOKEN_BUDGET,
  buildContextPacket,
  estimateTokens,
  redactPacketForLog,
  renderPacket,
  type BuildPacketInput,
} from '../context';

function baseInput(overrides: Partial<BuildPacketInput> = {}): BuildPacketInput {
  return {
    identity: { displayName: 'Aarav', timezone: 'Asia/Kolkata', locale: 'en' },
    goal: {
      title: 'JEE Advanced 2027',
      type: 'exam',
      targetDate: '2027-05-23',
      daysRemaining: 290,
      intensity: 900,
    },
    status: {
      progressPct: 0.238,
      onTrack: 'at_risk',
      projectedCompletion: '2027-05-11',
      weeklyAdherence: 0.71,
    },
    plan: {
      currentPlanVersion: 7,
      todayTasks: [{ title: 'Learn: SHM', type: 'learn', estimatedMinutes: 45, status: 'pending' }],
      thisWeekSummary: 'Five sessions planned, 320 minutes.',
    },
    mastery: {
      strongest: [{ id: 'c1', title: 'Kinematics', mastery: 0.9 }],
      weakest: [{ id: 'c2', title: 'Angular Momentum', mastery: 0.4 }],
      dueForReview: 3,
    },
    recent: {
      last5Sessions: [{ date: '2026-08-05', minutes: 45, rating: 'hard' }],
      last3Assessments: [{ date: '2026-08-01', score: 7, maxScore: 10 }],
    },
    facts: [
      {
        id: 'f1',
        category: 'misconception',
        statement: 'Applies conservation too eagerly.',
        confidence: 0.8,
      },
      { id: 'f2', category: 'preference', statement: 'Prefers evening study.', confidence: 0.3 },
    ],
    ...overrides,
  };
}

describe('context packet — assembly', () => {
  it('caps strongest at 5 and weakest at 10', () => {
    const packet = buildContextPacket(
      baseInput({
        mastery: {
          strongest: Array.from({ length: 20 }, (_, i) => ({
            id: `s${i}`,
            title: `S${i}`,
            mastery: 0.9,
          })),
          weakest: Array.from({ length: 20 }, (_, i) => ({
            id: `w${i}`,
            title: `W${i}`,
            mastery: 0.2,
          })),
          dueForReview: 1,
        },
      }),
      { agent: 'coach' },
    );
    expect(packet.mastery.strongest).toHaveLength(5);
    expect(packet.mastery.weakest).toHaveLength(10);
  });

  it('sorts facts by confidence, highest first', () => {
    const packet = buildContextPacket(baseInput(), { agent: 'coach' });
    expect(packet.facts[0]!.confidence).toBeGreaterThanOrEqual(packet.facts[1]!.confidence);
  });

  it('is deterministic — same input and clock produce the same packet (ADR-013)', () => {
    const now = new Date('2026-08-06T00:00:00Z');
    const a = buildContextPacket(baseInput(), { agent: 'coach', now });
    const b = buildContextPacket(baseInput(), { agent: 'coach', now });
    expect(renderPacket(a)).toBe(renderPacket(b));
    expect(a.meta).toEqual(b.meta);
  });

  it('reports its own token count', () => {
    const packet = buildContextPacket(baseInput(), { agent: 'coach' });
    expect(packet.meta.tokenCount).toBe(estimateTokens(renderPacket(packet)));
  });
});

describe('context packet — token budgeting (§5.4)', () => {
  const bulky = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ source: 'note', content: 'x'.repeat(400) + i }));

  it('never exceeds the agent budget', () => {
    const packet = buildContextPacket(baseInput({ retrieved: bulky(200) }), { agent: 'coach' });
    expect(packet.meta.tokenCount).toBeLessThanOrEqual(TOKEN_BUDGET.coach);
  });

  it('drops `retrieved` first', () => {
    const packet = buildContextPacket(baseInput({ retrieved: bulky(200) }), { agent: 'coach' });
    expect(packet.meta.truncated).toContain('retrieved');
    expect(packet.retrieved).toHaveLength(0);
    // Cheaper tiers were not touched, because dropping `retrieved` sufficed.
    expect(packet.recent.last5Sessions.length).toBeGreaterThan(0);
  });

  it('drops `recent` before `facts`, and trims facts only as a last resort', () => {
    // `recent` is capped at 5 sessions during assembly, so it can never be the
    // thing that blows a budget. Facts are unbounded, so they are what forces
    // the lower tiers — which is the realistic shape of this failure.
    const manyFacts = Array.from({ length: 60 }, (_, i) => ({
      id: `f${i}`,
      category: 'misconception',
      statement: 'x'.repeat(400),
      confidence: i / 60,
    }));
    const packet = buildContextPacket(
      baseInput({ retrieved: bulky(20), facts: manyFacts }),
      { agent: 'content_generator' }, // the smallest budget, 4k
    );

    expect(packet.meta.truncated).toEqual(['retrieved', 'recent', 'facts']);
    expect(packet.recent.last5Sessions).toHaveLength(0);
    expect(packet.facts.length).toBeGreaterThan(0);
    expect(packet.facts.length).toBeLessThan(manyFacts.length);
    expect(packet.meta.tokenCount).toBeLessThanOrEqual(TOKEN_BUDGET.content_generator);
  });

  it('trims the least-confident facts first', () => {
    const manyFacts = Array.from({ length: 60 }, (_, i) => ({
      id: `f${i}`,
      category: 'misconception',
      statement: 'x'.repeat(400),
      confidence: i / 60,
    }));
    const packet = buildContextPacket(baseInput({ facts: manyFacts }), {
      agent: 'content_generator',
    });
    const survivingConfidences = packet.facts.map((f) => f.confidence);
    const lowest = Math.min(...survivingConfidences);
    const dropped = manyFacts
      .filter((f) => !packet.facts.some((s) => s.id === f.id))
      .map((f) => f.confidence);
    // Everything dropped was less trusted than everything kept.
    for (const d of dropped) expect(d).toBeLessThanOrEqual(lowest);
  });

  it('never drops goal or status, however tight the budget', () => {
    const packet = buildContextPacket(baseInput({ retrieved: bulky(500), facts: [] }), {
      agent: 'content_generator',
    });
    expect(packet.goal).not.toBeNull();
    expect(packet.status).not.toBeNull();
  });

  it('records what it truncated rather than shrinking silently', () => {
    const packet = buildContextPacket(baseInput({ retrieved: bulky(200) }), { agent: 'coach' });
    expect(packet.meta.truncated.length).toBeGreaterThan(0);
  });
});

describe('context packet — stable prefix for prompt caching', () => {
  it('orders sections identity → goal → status → plan → mastery → facts', () => {
    const rendered = renderPacket(buildContextPacket(baseInput(), { agent: 'coach' }));
    const order = [
      '## Learner',
      '## Goal',
      '## Status',
      '## Plan',
      '## Mastery',
      '## What I believe',
    ];
    const positions = order.map((heading) => rendered.indexOf(heading));
    for (const p of positions) expect(p).toBeGreaterThanOrEqual(0);
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });

  it('keeps the prefix byte-identical when only the tail changes', () => {
    const withoutFacts = renderPacket(
      buildContextPacket(baseInput({ facts: [] }), { agent: 'coach' }),
    );
    const withFacts = renderPacket(buildContextPacket(baseInput(), { agent: 'coach' }));
    // The cacheable prefix is everything up to the first divergence; it must
    // cover at least the identity/goal/status/plan/mastery block.
    expect(withFacts.startsWith(withoutFacts.split('\n## What I believe')[0]!)).toBe(true);
  });
});

describe('context packet — logging redaction (§13.4)', () => {
  it('logs structure and ids, never learner free text', () => {
    const packet = buildContextPacket(baseInput(), { agent: 'coach' });
    const logged = JSON.stringify(redactPacketForLog(packet));
    expect(logged).toContain('f1');
    expect(logged).not.toContain('Applies conservation too eagerly');
    expect(logged).not.toContain('Prefers evening study');
  });
});
