import { createAnthropicProvider } from './anthropic';
import { createGoogleProvider } from './google';
import { createFixtureProvider } from './fixture';
import type { ModelProvider } from '../types';

/**
 * Provider selection — **configuration, not code**.
 *
 * Switching vendors is an environment variable. No agent, service, or route
 * knows which model is behind the `ModelProvider` interface, which is what
 * makes ADR-012's failover story real rather than aspirational.
 *
 * Resolution order, and why:
 *   1. An explicit `AI_PROVIDER` always wins — a deployment that names its
 *      provider should get that provider or a loud error, never a silent
 *      fallback to whichever key happened to be present.
 *   2. Otherwise infer from whichever key is configured.
 *   3. With no key at all, the fixture provider. The core loop is unaffected
 *      either way (NFR-2.2); only the AI surfaces degrade.
 */

export type ProviderName = 'anthropic' | 'google' | 'fixture';

export interface ProviderEnv {
  AI_PROVIDER?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
  GOOGLE_API_KEY?: string | undefined;
  GEMINI_MODEL?: string | undefined;
}

export class ProviderConfigError extends Error {}

export interface ResolvedProvider {
  name: ProviderName;
  provider: ModelProvider;
  /** True when no live vendor is configured — the caller should degrade honestly. */
  isFixture: boolean;
  reason: string;
}

/** Pure resolution, so the decision is unit-testable without touching `process.env`. */
export function resolveProvider(env: ProviderEnv): ResolvedProvider {
  const requested = env.AI_PROVIDER?.trim().toLowerCase();

  if (requested && requested !== 'anthropic' && requested !== 'google' && requested !== 'fixture') {
    throw new ProviderConfigError(
      `AI_PROVIDER="${requested}" is not a known provider. Use "anthropic", "google", or "fixture".`,
    );
  }

  if (requested === 'fixture') {
    return {
      name: 'fixture',
      provider: createFixtureProvider(),
      isFixture: true,
      reason: 'AI_PROVIDER=fixture',
    };
  }

  if (requested === 'google') {
    if (!env.GOOGLE_API_KEY) {
      throw new ProviderConfigError('AI_PROVIDER=google requires GOOGLE_API_KEY to be set.');
    }
    return {
      name: 'google',
      provider: createGoogleProvider({
        apiKey: env.GOOGLE_API_KEY,
        ...(env.GEMINI_MODEL ? { modelOverride: env.GEMINI_MODEL } : {}),
      }),
      isFixture: false,
      reason: 'AI_PROVIDER=google',
    };
  }

  if (requested === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) {
      throw new ProviderConfigError('AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY to be set.');
    }
    return {
      name: 'anthropic',
      provider: createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY }),
      isFixture: false,
      reason: 'AI_PROVIDER=anthropic',
    };
  }

  // No explicit choice — infer. Anthropic first, because it is the blueprint's
  // primary (§2.1) and Gemini is named as the failover.
  if (env.ANTHROPIC_API_KEY) {
    return {
      name: 'anthropic',
      provider: createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY }),
      isFixture: false,
      reason: 'inferred from ANTHROPIC_API_KEY',
    };
  }

  if (env.GOOGLE_API_KEY) {
    return {
      name: 'google',
      provider: createGoogleProvider({
        apiKey: env.GOOGLE_API_KEY,
        ...(env.GEMINI_MODEL ? { modelOverride: env.GEMINI_MODEL } : {}),
      }),
      isFixture: false,
      reason: 'inferred from GOOGLE_API_KEY',
    };
  }

  return {
    name: 'fixture',
    provider: createFixtureProvider(),
    isFixture: true,
    reason: 'no provider key configured',
  };
}
