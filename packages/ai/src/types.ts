import type { z } from 'zod';

/**
 * Shared AI types — SYSTEM_ARCHITECTURE §5.
 *
 * The whole subsystem is written against the `ModelProvider` interface below
 * rather than against a vendor SDK directly. That seam is not decoration:
 *
 *   - **A6 (AI is an untrusted subsystem)** requires every call to have a
 *     deterministic fallback. A provider you can substitute is a provider you
 *     can fall back from.
 *   - **§5.8 evaluation** requires deterministic tests from recorded fixtures,
 *     never live calls in CI. That is only possible if the transport is
 *     replaceable.
 *   - **ADR-012** anticipates provider failover (OpenAI/Gemini kept behind the
 *     provider interface). This is that interface.
 */

/** The six cognitive units (§5.5). Phase 2 implements three; the names are fixed. */
export type AgentName =
  | 'curriculum_architect'
  | 'planner_advisor'
  | 'coach'
  | 'diagnostician'
  | 'content_generator'
  | 'reflector';

/** Model tiers, not model ids — routing is a policy, not a per-call decision (§5.3). */
export type ModelTier = 'deep' | 'balanced' | 'cheap';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Prompt-cache hits on the stable packet prefix — the largest single saving. */
  cachedTokens: number;
}

export const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

export interface GenerateObjectRequest<T> {
  agent: AgentName;
  modelId: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
}

export interface GenerateObjectResult<T> {
  object: T;
  usage: TokenUsage;
  modelId: string;
}

/** A tool the model may call. Args are validated before any executor runs. */
export interface StreamToolSpec {
  name: string;
  description: string;
  args: z.ZodTypeAny;
}

export interface StreamTextRequest {
  agent: AgentName;
  modelId: string;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  tools?: StreamToolSpec[];
  maxOutputTokens?: number;
}

/**
 * Wire-shaped stream events, matching the SSE contract in
 * API_SPECIFICATION §5.10 so the route handler is a pass-through rather than a
 * translator.
 */
export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; toolCallId: string; name: string; args: unknown }
  | { type: 'done'; usage: TokenUsage };

export interface ModelProvider {
  readonly id: string;
  generateObject<T>(request: GenerateObjectRequest<T>): Promise<GenerateObjectResult<T>>;
  streamText(request: StreamTextRequest): AsyncIterable<StreamEvent>;
}

/** Raised when the provider is unreachable, over budget, or returns unusable output. */
export class AiUnavailableError extends Error {
  override readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'AiUnavailableError';
    this.cause = cause;
  }
}

/** Raised when output fails schema validation after the single repair attempt (§5.7). */
export class AiValidationError extends Error {
  readonly issues: string[];
  constructor(message: string, issues: string[]) {
    super(message);
    this.name = 'AiValidationError';
    this.issues = issues;
  }
}
