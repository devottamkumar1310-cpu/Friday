import type { AgentName, ModelTier } from '../types';

/**
 * Model routing — SYSTEM_ARCHITECTURE §5.3.
 *
 * "Model choice is a **policy**, not a per-call decision. Routing lives in one
 * place and is instrumented." No agent picks its own model; it declares who it
 * is and the router answers.
 */

export const MODEL_IDS: Record<ModelTier, string> = {
  deep: 'claude-opus-4-8',
  balanced: 'claude-sonnet-5',
  cheap: 'claude-haiku-4-5-20251001',
};

/** §5.3's routing table, transcribed. */
const AGENT_TIER: Record<AgentName, ModelTier> = {
  // Deep multi-step reasoning; low volume, high stakes, run async.
  curriculum_architect: 'deep',
  diagnostician: 'deep',
  planner_advisor: 'deep',
  // Best latency/quality balance for interactive work.
  coach: 'balanced',
  content_generator: 'balanced',
  // High volume, low complexity — the cost lever.
  reflector: 'cheap',
};

/**
 * Per-1M-token prices in USD, used for cost accounting rather than billing.
 * Wrong-but-consistent beats absent: the budget ceiling (§5.3 control 4) needs
 * a number, and an order-of-magnitude estimate enforces it correctly.
 */
const PRICE_PER_MTOK: Record<ModelTier, { input: number; output: number }> = {
  deep: { input: 15, output: 75 },
  balanced: { input: 3, output: 15 },
  cheap: { input: 0.8, output: 4 },
};

export function tierFor(agent: AgentName): ModelTier {
  return AGENT_TIER[agent];
}

export function modelIdFor(agent: AgentName): string {
  return MODEL_IDS[tierFor(agent)];
}

/**
 * §5.3 control 4: on budget breach, route down a tier rather than failing
 * silently. `deep → balanced → cheap`; `cheap` is the floor.
 */
export function degradeTier(tier: ModelTier): ModelTier {
  if (tier === 'deep') return 'balanced';
  if (tier === 'balanced') return 'cheap';
  return 'cheap';
}

export function estimateCostUsd(
  tier: ModelTier,
  usage: { inputTokens: number; outputTokens: number; cachedTokens?: number },
): number {
  const price = PRICE_PER_MTOK[tier];
  // Cached input tokens are billed at a large discount; 0.1x is the right order
  // of magnitude and keeps the estimate honest rather than flattering.
  const cached = usage.cachedTokens ?? 0;
  const freshInput = Math.max(0, usage.inputTokens - cached);
  return (
    (freshInput * price.input) / 1_000_000 +
    (cached * price.input * 0.1) / 1_000_000 +
    (usage.outputTokens * price.output) / 1_000_000
  );
}

export interface RoutingDecision {
  agent: AgentName;
  tier: ModelTier;
  modelId: string;
  degraded: boolean;
  reason: string;
}

/**
 * Resolves the model for a call, degrading when the learner is over their
 * monthly ceiling. Returning the reason (rather than just the id) is what lets
 * the response carry an honest `degraded` flag instead of quietly getting worse
 * (API_SPECIFICATION §3.2 `meta.degraded`).
 */
export function route(agent: AgentName, options: { overBudget?: boolean } = {}): RoutingDecision {
  const baseTier = tierFor(agent);
  if (!options.overBudget) {
    return {
      agent,
      tier: baseTier,
      modelId: MODEL_IDS[baseTier],
      degraded: false,
      reason: 'policy',
    };
  }
  const tier = degradeTier(baseTier);
  return {
    agent,
    tier,
    modelId: MODEL_IDS[tier],
    degraded: tier !== baseTier,
    reason: 'monthly_budget_exceeded',
  };
}

/** NFR-4.5: $0.60 per user per month. */
export const MONTHLY_BUDGET_USD = 0.6;

export function isOverBudget(spentUsd: number): boolean {
  return spentUsd >= MONTHLY_BUDGET_USD;
}
