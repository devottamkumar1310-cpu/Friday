import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject, streamText, tool as aiTool } from 'ai';
import type { z } from 'zod';
import {
  AiUnavailableError,
  type GenerateObjectRequest,
  type GenerateObjectResult,
  type ModelProvider,
  type StreamEvent,
  type StreamTextRequest,
  type TokenUsage,
} from '../types';

/**
 * Google Gemini provider — SYSTEM_ARCHITECTURE §2.1 ("OpenAI / Gemini kept
 * behind the provider interface as failover") and ADR-012.
 *
 * This is the payoff for the `ModelProvider` seam introduced in Phase 2: a
 * second vendor arrives as one new file plus a config value. No agent, no
 * service, and no route changed to support it — which is the property the seam
 * existed to buy, and the reason it was not worth arguing about at the time.
 *
 * Deliberately mirrors `anthropic.ts` structure so the two can be diffed. Where
 * they differ, the difference is a real vendor behaviour, commented as such.
 */

function toUsage(usage: {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}): TokenUsage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cachedTokens: usage.cachedInputTokens ?? 0,
  };
}

/**
 * Extracts the vendor's own explanation from a thrown error.
 *
 * Without this the operator sees "generateObject failed" and nothing else,
 * which is indistinguishable between a bad key, an unprovisioned tier, a
 * retired model, and a rate limit — four problems with four different fixes.
 * Google returns the useful text nested in `responseBody`, so it is lifted into
 * the message.
 */
function describeCause(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error);
  const e = error as { message?: string; responseBody?: string; statusCode?: number };

  let detail = e.message ?? '';
  if (e.responseBody) {
    try {
      const parsed = JSON.parse(e.responseBody) as {
        error?: { message?: string; status?: string };
      };
      if (parsed.error?.message) {
        detail = `${parsed.error.status ?? ''} ${parsed.error.message}`.trim();
      }
    } catch {
      detail = e.responseBody.slice(0, 300);
    }
  }
  return e.statusCode ? `HTTP ${e.statusCode}: ${detail}` : detail;
}

/**
 * Gemini model ids, mapped from the tier the router picked.
 *
 * The router speaks in tiers and Anthropic model ids (§5.3's table is written
 * in Claude names). Rather than teach the router about vendors — which would
 * put model selection in two places and break "routing is a policy, in one
 * place" — the provider translates at its own edge.
 *
 * The `-latest` aliases are used deliberately over pinned versions. Google
 * retires dated Gemini models for new API keys, and a pinned id that worked at
 * write time returns 404 months later: verified during validation, where
 * `gemini-2.5-flash` responded _"no longer available to new users"_. The
 * aliases track the current model in each tier. `GEMINI_MODEL` pins one
 * explicitly when reproducibility matters more than currency.
 */
const GEMINI_BY_CLAUDE_TIER: Record<string, string> = {
  // deep — multi-step reasoning, low volume, high stakes
  'claude-opus-4-8': 'gemini-pro-latest',
  // balanced — interactive work
  'claude-sonnet-5': 'gemini-flash-latest',
  // cheap — high volume, low complexity
  'claude-haiku-4-5-20251001': 'gemini-flash-lite-latest',
};

/** Exported for the validation harness, which asserts every tier maps. */
export function toGeminiModelId(modelId: string): string {
  return GEMINI_BY_CLAUDE_TIER[modelId] ?? modelId;
}

export interface GoogleProviderOptions {
  apiKey: string;
  defaultMaxOutputTokens?: number;
  /** Overrides the tier mapping, for pinning a specific Gemini model. */
  modelOverride?: string;
}

export function createGoogleProvider(options: GoogleProviderOptions): ModelProvider {
  const google = createGoogleGenerativeAI({ apiKey: options.apiKey });
  const defaultMax = options.defaultMaxOutputTokens ?? 4096;
  const resolveModel = (modelId: string) => options.modelOverride ?? toGeminiModelId(modelId);

  return {
    id: 'google',

    async generateObject<T>(request: GenerateObjectRequest<T>): Promise<GenerateObjectResult<T>> {
      const modelId = resolveModel(request.modelId);
      try {
        const result = await generateObject({
          model: google(modelId),
          system: request.system,
          prompt: request.prompt,
          schema: request.schema as unknown as z.ZodType<T, z.ZodTypeDef, unknown>,
          maxOutputTokens: request.maxOutputTokens ?? defaultMax,
        });
        return {
          object: result.object as T,
          usage: toUsage(result.usage),
          modelId,
        };
      } catch (error) {
        throw new AiUnavailableError(
          `Gemini generateObject failed for agent "${request.agent}" on model "${modelId}". ${describeCause(error)}`,
          error,
        );
      }
    },

    async *streamText(request: StreamTextRequest): AsyncIterable<StreamEvent> {
      const modelId = resolveModel(request.modelId);

      const tools = Object.fromEntries(
        (request.tools ?? []).map((spec) => [
          spec.name,
          aiTool({
            description: spec.description,
            inputSchema: spec.args as never,
          }),
        ]),
      );

      let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

      try {
        const result = streamText({
          model: google(modelId),
          system: request.system,
          messages: request.messages,
          maxOutputTokens: request.maxOutputTokens ?? defaultMax,
          ...(request.tools && request.tools.length > 0 ? { tools } : {}),
        });

        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            yield { type: 'delta', text: part.text };
          } else if (part.type === 'tool-call') {
            yield {
              type: 'tool_call',
              toolCallId: part.toolCallId,
              name: part.toolName,
              args: part.input,
            };
          } else if (part.type === 'finish') {
            usage = toUsage(part.totalUsage);
          } else if (part.type === 'error') {
            throw new AiUnavailableError('Gemini stream reported an error.', part.error);
          }
        }
      } catch (error) {
        if (error instanceof AiUnavailableError) throw error;
        throw new AiUnavailableError(
          `Gemini streamText failed for agent "${request.agent}" on model "${modelId}". ${describeCause(error)}`,
          error,
        );
      }

      yield { type: 'done', usage };
    },
  };
}
