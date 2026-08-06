import {
  createAnthropicProvider,
  createFixtureProvider,
  isOverBudget,
  type ModelProvider,
} from '@friday/ai';
import { getDb, platformRepository } from '@friday/db';
import { logger } from '@friday/observability';

/**
 * The AI composition root.
 *
 * `packages/ai` declares agents against the `ModelProvider` interface; this is
 * the one place that decides which implementation they get. Without an API key
 * the app runs on the fixture provider — the deterministic core loop is
 * unaffected either way (NFR-2.2), which is the whole point of A6.
 */

let cached: ModelProvider | undefined;

export function getModelProvider(): ModelProvider {
  if (cached) return cached;

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    logger.warn('ANTHROPIC_API_KEY is not set — AI features run on the fixture provider.');
    cached = createFixtureProvider();
    return cached;
  }

  cached = createAnthropicProvider({ apiKey });
  return cached;
}

/** Test seam: lets a suite install a scripted provider without touching env. */
export function setModelProvider(provider: ModelProvider | undefined): void {
  cached = provider;
}

export function isAiConfigured(): boolean {
  return Boolean(process.env['ANTHROPIC_API_KEY']);
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
