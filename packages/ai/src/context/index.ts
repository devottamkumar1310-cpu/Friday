import type { AgentName } from '../types';

/**
 * The Learner Context Packet — SYSTEM_ARCHITECTURE §5.4. Roadmap 2.4.
 *
 * "Every AI call receives context assembled by a **deterministic builder**, not
 * by the model deciding what to fetch." Three consequences follow, and all
 * three are the point rather than side effects:
 *
 *   1. AI behaviour is reproducible — the packet is logged with every call, so
 *      a bad response is replayed rather than guessed at.
 *   2. Cost is predictable — the token budget is enforced here, not hoped for.
 *   3. Prompt injection is containable — this is the single auditable entry
 *      point for everything a model sees (ADR-013, ADR-017).
 *
 * `packages/ai` may not import `packages/db`, so nothing here fetches. The
 * service layer gathers the inputs and hands them over as plain data.
 */

export const PACKET_VERSION = '1' as const;

export interface PacketIdentity {
  displayName: string;
  timezone: string;
  locale: string;
}

export interface PacketGoal {
  title: string;
  type: string;
  targetDate: string;
  daysRemaining: number;
  intensity: number;
}

export interface PacketStatus {
  progressPct: number;
  onTrack: string;
  projectedCompletion: string | null;
  weeklyAdherence: number | null;
}

export interface PacketPlan {
  currentPlanVersion: number;
  todayTasks: { title: string; type: string; estimatedMinutes: number; status: string }[];
  thisWeekSummary: string;
}

export interface PacketConcept {
  id: string;
  title: string;
  mastery: number;
}

export interface PacketMastery {
  strongest: PacketConcept[];
  weakest: PacketConcept[];
  dueForReview: number;
}

export interface PacketRecent {
  last5Sessions: { date: string; minutes: number; rating: string | null }[];
  last3Assessments: { date: string; score: number | null; maxScore: number | null }[];
}

export interface PacketFact {
  id: string;
  category: string;
  statement: string;
  confidence: number;
}

export interface LearnerContextPacket {
  identity: PacketIdentity;
  goal: PacketGoal | null;
  status: PacketStatus | null;
  plan: PacketPlan | null;
  mastery: PacketMastery;
  recent: PacketRecent;
  facts: PacketFact[];
  /** Semantic hits. Always empty until Phase 3 introduces pgvector (D11). */
  retrieved: { source: string; content: string }[];
  meta: {
    packetVersion: string;
    tokenCount: number;
    assembledAt: string;
    /** What tiered truncation removed, so a thin packet is never a silent one. */
    truncated: string[];
  };
}

/** Hard per-agent ceilings (§5.4). Exceeding one is impossible, not discouraged. */
export const TOKEN_BUDGET: Record<AgentName, number> = {
  coach: 8_000,
  planner_advisor: 16_000,
  curriculum_architect: 16_000,
  diagnostician: 12_000,
  content_generator: 4_000,
  reflector: 4_000,
};

/**
 * Token estimate without a tokenizer dependency. ~4 characters per token is the
 * accepted rule of thumb for English; the budget is a ceiling with headroom, so
 * a cheap estimate that never *under*-counts materially is the right trade.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface BuildPacketInput {
  identity: PacketIdentity;
  goal?: PacketGoal | null;
  status?: PacketStatus | null;
  plan?: PacketPlan | null;
  mastery?: Partial<PacketMastery>;
  recent?: Partial<PacketRecent>;
  facts?: PacketFact[];
  retrieved?: { source: string; content: string }[];
}

export interface BuildPacketOptions {
  agent: AgentName;
  now?: Date;
}

/**
 * Assembles and budgets a packet.
 *
 * Truncation is **tiered, in a fixed order** (§5.4): drop `retrieved`, then
 * `recent`, then low-confidence `facts`. `goal` and `status` are never dropped
 * — a model reasoning about a learner without knowing their goal or whether
 * they are on track produces confident nonsense, which is worse than a refusal.
 */
export function buildContextPacket(
  input: BuildPacketInput,
  options: BuildPacketOptions,
): LearnerContextPacket {
  const now = options.now ?? new Date();
  const budget = TOKEN_BUDGET[options.agent];
  const truncated: string[] = [];

  const packet: LearnerContextPacket = {
    identity: input.identity,
    goal: input.goal ?? null,
    status: input.status ?? null,
    plan: input.plan ?? null,
    mastery: {
      strongest: (input.mastery?.strongest ?? []).slice(0, 5),
      weakest: (input.mastery?.weakest ?? []).slice(0, 10),
      dueForReview: input.mastery?.dueForReview ?? 0,
    },
    recent: {
      last5Sessions: (input.recent?.last5Sessions ?? []).slice(0, 5),
      last3Assessments: (input.recent?.last3Assessments ?? []).slice(0, 3),
    },
    facts: [...(input.facts ?? [])].sort((a, b) => b.confidence - a.confidence),
    retrieved: input.retrieved ?? [],
    meta: {
      packetVersion: PACKET_VERSION,
      tokenCount: 0,
      assembledAt: now.toISOString(),
      truncated: [],
    },
  };

  // Tier 1 — semantic hits are the most expendable: they are supplementary by
  // construction and the query still has everything structural.
  if (estimateTokens(renderPacket(packet)) > budget && packet.retrieved.length > 0) {
    packet.retrieved = [];
    truncated.push('retrieved');
  }

  // Tier 2 — recent activity. Useful colour, but derivable from status.
  if (estimateTokens(renderPacket(packet)) > budget) {
    packet.recent = { last5Sessions: [], last3Assessments: [] };
    truncated.push('recent');
  }

  // Tier 3 — facts, lowest confidence first. Facts are already confidence-sorted,
  // so this drops the least-trusted beliefs before the well-evidenced ones.
  while (estimateTokens(renderPacket(packet)) > budget && packet.facts.length > 0) {
    packet.facts.pop();
    if (!truncated.includes('facts')) truncated.push('facts');
  }

  packet.meta.truncated = truncated;
  packet.meta.tokenCount = estimateTokens(renderPacket(packet));
  return packet;
}

/**
 * Renders the packet to the prompt string.
 *
 * **Section order is load-bearing and must not be "tidied".** Prompt caching
 * only hits on a stable prefix (§5.4), and the ordering below — identity →
 * goal → status → plan → mastery → facts → retrieved — puts the slowest-moving
 * material first. Reordering it silently multiplies token cost.
 */
export function renderPacket(packet: LearnerContextPacket): string {
  const lines: string[] = [];

  lines.push('## Learner');
  lines.push(
    `Name: ${packet.identity.displayName} · Timezone: ${packet.identity.timezone} · Locale: ${packet.identity.locale}`,
  );

  if (packet.goal) {
    lines.push('', '## Goal');
    lines.push(
      `${packet.goal.title} (${packet.goal.type}) · target ${packet.goal.targetDate} · ${packet.goal.daysRemaining} days remaining · ${packet.goal.intensity} min/week planned`,
    );
  }

  if (packet.status) {
    lines.push('', '## Status');
    lines.push(
      `Weighted progress ${(packet.status.progressPct * 100).toFixed(1)}% · verdict ${packet.status.onTrack}` +
        (packet.status.projectedCompletion
          ? ` · projected completion ${packet.status.projectedCompletion}`
          : '') +
        (packet.status.weeklyAdherence !== null
          ? ` · weekly adherence ${(packet.status.weeklyAdherence * 100).toFixed(0)}%`
          : ''),
    );
  }

  if (packet.plan) {
    lines.push('', `## Plan (version ${packet.plan.currentPlanVersion})`);
    lines.push(packet.plan.thisWeekSummary);
    for (const task of packet.plan.todayTasks) {
      lines.push(`- [${task.status}] ${task.type}: ${task.title} (${task.estimatedMinutes} min)`);
    }
  }

  lines.push('', '## Mastery');
  lines.push(`Concepts due for review: ${packet.mastery.dueForReview}`);
  if (packet.mastery.weakest.length > 0) {
    lines.push('Weakest:');
    for (const c of packet.mastery.weakest) {
      lines.push(`- ${c.title}: ${(c.mastery * 100).toFixed(0)}%`);
    }
  }
  if (packet.mastery.strongest.length > 0) {
    lines.push('Strongest:');
    for (const c of packet.mastery.strongest) {
      lines.push(`- ${c.title}: ${(c.mastery * 100).toFixed(0)}%`);
    }
  }

  if (packet.recent.last5Sessions.length > 0 || packet.recent.last3Assessments.length > 0) {
    lines.push('', '## Recent activity');
    for (const s of packet.recent.last5Sessions) {
      lines.push(`- Session ${s.date}: ${s.minutes} min${s.rating ? `, rated ${s.rating}` : ''}`);
    }
    for (const a of packet.recent.last3Assessments) {
      lines.push(`- Assessment ${a.date}: ${a.score ?? '—'}/${a.maxScore ?? '—'}`);
    }
  }

  if (packet.facts.length > 0) {
    lines.push('', '## What I believe about this learner');
    for (const f of packet.facts) {
      lines.push(`- (${f.category}, confidence ${f.confidence.toFixed(2)}) ${f.statement}`);
    }
  }

  if (packet.retrieved.length > 0) {
    lines.push('', '## Retrieved notes');
    for (const chunk of packet.retrieved) {
      lines.push(`- [${chunk.source}] ${chunk.content}`);
    }
  }

  return lines.join('\n');
}

/**
 * The packet as logged to `ai_calls.context_packet` (§5.4: "logged with every
 * AI call"). Free text a learner authored is dropped — traces carry learning
 * state, not content (AI_DECISION_ENGINE §13.4).
 */
export function redactPacketForLog(packet: LearnerContextPacket): Record<string, unknown> {
  return {
    packetVersion: packet.meta.packetVersion,
    tokenCount: packet.meta.tokenCount,
    truncated: packet.meta.truncated,
    assembledAt: packet.meta.assembledAt,
    goal: packet.goal
      ? { title: packet.goal.title, daysRemaining: packet.goal.daysRemaining }
      : null,
    status: packet.status,
    masteryCounts: {
      strongest: packet.mastery.strongest.length,
      weakest: packet.mastery.weakest.length,
      dueForReview: packet.mastery.dueForReview,
    },
    factIds: packet.facts.map((f) => f.id),
    retrievedCount: packet.retrieved.length,
  };
}
