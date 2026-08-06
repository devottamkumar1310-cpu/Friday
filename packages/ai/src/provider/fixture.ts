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
 * Recorded-fixture provider.
 *
 * IMPLEMENTATION_ROADMAP §7.2: _"Deterministic tests use recorded fixtures —
 * never live calls in CI."_ This is the mechanism. It is also what lets the
 * whole Phase 2 surface be exercised without an API key: fixtures stand in for
 * responses, and every layer above this one is the real implementation.
 *
 * Fixtures are matched by `(agent, key)` where the key is supplied by the
 * caller, so a test states exactly which recorded response it expects rather
 * than depending on prompt-string equality.
 */

export interface ObjectFixture {
  agent: string;
  key: string;
  object: unknown;
  usage?: Partial<TokenUsage>;
}

export interface StreamFixture {
  agent: string;
  key: string;
  events: StreamEvent[];
}

const DEFAULT_USAGE: TokenUsage = { inputTokens: 1200, outputTokens: 300, cachedTokens: 800 };

export interface FixtureProviderOptions {
  objects?: ObjectFixture[];
  streams?: StreamFixture[];
  /**
   * Resolves a request to a fixture key. Defaults to the agent name, which is
   * enough when a suite exercises one response per agent.
   */
  keyFor?: (request: { agent: string; prompt?: string }) => string;
}

export function createFixtureProvider(options: FixtureProviderOptions = {}): ModelProvider {
  const keyFor = options.keyFor ?? ((r) => r.agent);
  const objects = options.objects ?? [];
  const streams = options.streams ?? [];

  return {
    id: 'fixture',

    async generateObject<T>(request: GenerateObjectRequest<T>): Promise<GenerateObjectResult<T>> {
      const key = keyFor({ agent: request.agent, prompt: request.prompt });
      const fixture = objects.find((f) => f.agent === request.agent && f.key === key);
      if (!fixture) {
        throw new AiUnavailableError(
          `No recorded object fixture for agent "${request.agent}" key "${key}". ` +
            `Record one, or assert the deterministic fallback instead.`,
        );
      }

      // Validate the fixture through the same schema a live response would face.
      // A fixture that could not have come from the model is worse than no test.
      const parsed = request.schema.safeParse(fixture.object);
      if (!parsed.success) {
        throw new AiUnavailableError(
          `Fixture for "${request.agent}/${key}" does not satisfy the agent's own output schema: ` +
            parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        );
      }

      return {
        object: parsed.data,
        usage: { ...DEFAULT_USAGE, ...fixture.usage },
        modelId: request.modelId,
      };
    },

    async *streamText(request: StreamTextRequest): AsyncIterable<StreamEvent> {
      const key = keyFor({ agent: request.agent });
      const fixture = streams.find((f) => f.agent === request.agent && f.key === key);
      if (!fixture) {
        throw new AiUnavailableError(
          `No recorded stream fixture for agent "${request.agent}" key "${key}".`,
        );
      }
      for (const event of fixture.events) yield event;
      if (!fixture.events.some((e) => e.type === 'done')) {
        yield { type: 'done', usage: DEFAULT_USAGE };
      }
    },
  };
}

/** A provider that always fails — for asserting the deterministic fallback (E-16). */
export function createFailingProvider(message = 'Provider unavailable.'): ModelProvider {
  return {
    id: 'failing',
    generateObject() {
      return Promise.reject(new AiUnavailableError(message));
    },
    // eslint-disable-next-line require-yield -- always throws; never yields
    async *streamText(): AsyncIterable<StreamEvent> {
      throw new AiUnavailableError(message);
    },
  };
}
