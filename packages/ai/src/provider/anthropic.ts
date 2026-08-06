import { createAnthropic } from '@ai-sdk/anthropic';
import { generateObject, streamText, tool as aiTool, jsonSchema } from 'ai';
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
 * Anthropic provider, via the Vercel AI SDK v5 (SYSTEM_ARCHITECTURE §2.1).
 *
 * This is the only file in the repository that knows a model vendor exists.
 * Everything else talks to `ModelProvider`, which is what keeps ADR-012's
 * failover story (and CI's no-live-calls rule) achievable.
 *
 * **Not exercised in Phase 2.** No `ANTHROPIC_API_KEY` was available, so this
 * path is type-checked but never run. See PHASE_2_REPORT.md.
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

export interface AnthropicProviderOptions {
  apiKey: string;
  /** Bounds a single call so one runaway generation cannot exhaust a budget. */
  defaultMaxOutputTokens?: number;
}

export function createAnthropicProvider(options: AnthropicProviderOptions): ModelProvider {
  const anthropic = createAnthropic({ apiKey: options.apiKey });
  const defaultMax = options.defaultMaxOutputTokens ?? 4096;

  return {
    id: 'anthropic',

    async generateObject<T>(request: GenerateObjectRequest<T>): Promise<GenerateObjectResult<T>> {
      try {
        const result = await generateObject({
          model: anthropic(request.modelId),
          system: request.system,
          prompt: request.prompt,
          schema: request.schema as unknown as z.ZodType<T, z.ZodTypeDef, unknown>,
          maxOutputTokens: request.maxOutputTokens ?? defaultMax,
        });
        return {
          object: result.object as T,
          usage: toUsage(result.usage),
          modelId: request.modelId,
        };
      } catch (error) {
        throw new AiUnavailableError(
          `Anthropic generateObject failed for agent "${request.agent}".`,
          error,
        );
      }
    },

    async *streamText(request: StreamTextRequest): AsyncIterable<StreamEvent> {
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
          model: anthropic(request.modelId),
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
            throw new AiUnavailableError('Anthropic stream reported an error.', part.error);
          }
        }
      } catch (error) {
        if (error instanceof AiUnavailableError) throw error;
        throw new AiUnavailableError(
          `Anthropic streamText failed for agent "${request.agent}".`,
          error,
        );
      }

      yield { type: 'done', usage };
    },
  };
}

// `jsonSchema` is re-exported so a future non-Zod tool declaration has a path
// that does not require reaching back into the SDK from outside this file.
export { jsonSchema };
