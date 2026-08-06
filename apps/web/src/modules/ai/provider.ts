import {
  resolveProvider,
  isOverBudget,
  type ModelProvider,
  type ResolvedProvider,
} from '@friday/ai';
import { getDb, platformRepository } from '@friday/db';
import { logger } from '@friday/observability';

/**
 * The AI composition root.
 *
 * `packages/ai` declares agents against the `ModelProvider` interface; this is
 * the one place that decides which implementation they get — and it decides it
 * from configuration, never from code. Switching Anthropic ↔ Gemini is an
 * environment variable (ADR-012).
 *
 * With no key configured the app runs on fixtures. The deterministic core loop
 * is unaffected either way (NFR-2.2), which is the whole point of A6.
 */

let cached: ResolvedProvider | undefined;
let overridden: ModelProvider | undefined;

function resolve(): ResolvedProvider {
  if (cached) return cached;

  cached = resolveProvider({
    AI_PROVIDER: process.env['AI_PROVIDER'],
    ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'],
    GOOGLE_API_KEY: process.env['GOOGLE_API_KEY'],
    GEMINI_MODEL: process.env['GEMINI_MODEL'],
  });

  if (cached.isFixture) {
    logger.warn('No AI provider key configured — AI features run on the fixture provider.', {
      reason: cached.reason,
    });
  } else {
    logger.info('AI provider selected', { provider: cached.name, reason: cached.reason });
  }

  return cached;
}

export function getModelProvider(): ModelProvider {
  return overridden ?? resolve().provider;
}

/** Which vendor is live — surfaced in the validation harness and in logs. */
export function getProviderName(): string {
  return overridden ? 'override' : resolve().name;
}

/**
 * The vendor to price a call against.
 *
 * Gemini list prices are roughly an order of magnitude below Claude's, so
 * costing one at the other's rates misstates spend badly enough to trip the
 * per-user budget ceiling at the wrong time (§5.3 control 4).
 */
export function pricedProviderName(): 'anthropic' | 'google' {
  try {
    return overridden ? 'anthropic' : resolve().name === 'google' ? 'google' : 'anthropic';
  } catch {
    return 'anthropic';
  }
}

/** Test seam: lets a suite install a scripted provider without touching env. */
export function setModelProvider(provider: ModelProvider | undefined): void {
  overridden = provider;
  if (provider === undefined) cached = undefined;
}

/**
 * Whether a *live* vendor is configured. Drives the honest 503 on surfaces that
 * have no deterministic equivalent — there is no non-AI version of a
 * conversation.
 */
export function isAiConfigured(): boolean {
  if (overridden) return true;
  try {
    return !resolve().isFixture;
  } catch {
    // A malformed AI_PROVIDER is a misconfiguration, not an outage. Report it
    // as "not configured" so the caller degrades rather than 500s.
    return false;
  }
}

function currentPeriod(now = new Date()): string {
  return `${now.toISOString().slice(0, 7)}-01`;
}

/** §5.3 control 4: the ceiling is checked *before* the call, not after. */
export async function checkBudget(
  userId: string,
): Promise<{ overBudget: boolean; spentUsd: number }> {
  const usage = await platformRepository(getDb()).getUsage(userId, currentPeriod());
  const spentUsd = usage ? Number(usage.aiCostUsd) : 0;
  return { overBudget: isOverBudget(spentUsd), spentUsd };
}

export interface RecordCallInput {
  userId: string;
  agent: string;
  model: string;
  promptVersion: string;
  status: 'ok' | 'validation_failed' | 'repaired' | 'fallback' | 'error';
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number };
  costUsd: number;
  latencyMs: number;
  contextPacket?: Record<string, unknown> | null;
  error?: string | null;
  requestId?: string | null;
}

/**
 * NFR-7.4: every model interaction is logged, successful or not, and its cost
 * rolled into the month bucket so the next call's budget check is accurate.
 *
 * Returns the `ai_calls` id so callers can link it — `coach_messages.
 * context_packet_ref` is what makes a bad answer reproducible (§5.4).
 */
export async function recordAiCall(input: RecordCallInput): Promise<string> {
  const db = getDb();
  const platform = platformRepository(db);

  const row = await platform.recordAiCall({
    userId: input.userId,
    agent: input.agent,
    model: input.model,
    promptVersion: input.promptVersion,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    cachedTokens: input.usage.cachedTokens,
    costUsd: input.costUsd.toFixed(6),
    latencyMs: input.latencyMs,
    status: input.status,
    contextPacket: input.contextPacket ?? null,
    error: input.error ?? null,
    requestId: input.requestId ?? null,
  });

  await platform.accrueUsage(input.userId, currentPeriod(), {
    costUsd: input.costUsd,
    tokensIn: input.usage.inputTokens,
    tokensOut: input.usage.outputTokens,
  });

  return row.id;
}
