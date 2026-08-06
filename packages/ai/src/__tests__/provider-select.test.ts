import { describe, expect, it } from 'vitest';
import { ProviderConfigError, resolveProvider } from '../provider/select';
import { toGeminiModelId } from '../provider/google';
import { MODEL_IDS } from '../router';

/**
 * Provider selection is configuration, not code (ADR-012). These tests pin that
 * property: no agent, service, or route may need to change to switch vendors.
 */

describe('provider selection — explicit AI_PROVIDER', () => {
  it('selects Gemini when asked, with a key', () => {
    const resolved = resolveProvider({ AI_PROVIDER: 'google', GOOGLE_API_KEY: 'k' });
    expect(resolved.name).toBe('google');
    expect(resolved.provider.id).toBe('google');
    expect(resolved.isFixture).toBe(false);
  });

  it('selects Anthropic when asked, with a key', () => {
    const resolved = resolveProvider({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' });
    expect(resolved.name).toBe('anthropic');
    expect(resolved.provider.id).toBe('anthropic');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(resolveProvider({ AI_PROVIDER: '  Google ', GOOGLE_API_KEY: 'k' }).name).toBe('google');
  });

  it('fails loudly when the named provider has no key, rather than falling back', () => {
    // Silently using a different vendor than the deployment asked for is worse
    // than an error: the operator would never find out.
    expect(() => resolveProvider({ AI_PROVIDER: 'google', ANTHROPIC_API_KEY: 'k' })).toThrow(
      ProviderConfigError,
    );
    expect(() => resolveProvider({ AI_PROVIDER: 'anthropic', GOOGLE_API_KEY: 'k' })).toThrow(
      ProviderConfigError,
    );
  });

  it('rejects an unknown provider name', () => {
    expect(() => resolveProvider({ AI_PROVIDER: 'openai' })).toThrow(ProviderConfigError);
  });

  it('honours an explicit request for fixtures even when keys exist', () => {
    const resolved = resolveProvider({
      AI_PROVIDER: 'fixture',
      GOOGLE_API_KEY: 'k',
      ANTHROPIC_API_KEY: 'k',
    });
    expect(resolved.isFixture).toBe(true);
  });
});

describe('provider selection — inference', () => {
  it('prefers Anthropic when both keys are present (§2.1 primary)', () => {
    const resolved = resolveProvider({ ANTHROPIC_API_KEY: 'a', GOOGLE_API_KEY: 'g' });
    expect(resolved.name).toBe('anthropic');
    expect(resolved.reason).toContain('inferred');
  });

  it('uses Gemini when it is the only key', () => {
    expect(resolveProvider({ GOOGLE_API_KEY: 'g' }).name).toBe('google');
  });

  it('falls back to fixtures with no keys at all', () => {
    const resolved = resolveProvider({});
    expect(resolved.isFixture).toBe(true);
    expect(resolved.name).toBe('fixture');
  });
});

describe('gemini model mapping', () => {
  it('maps every routed tier to a real Gemini model', () => {
    // If the router gains a tier and this mapping is not updated, the provider
    // would silently pass a Claude id to Google. Asserting all three keeps that
    // failure at build time rather than at request time.
    for (const claudeId of Object.values(MODEL_IDS)) {
      const mapped = toGeminiModelId(claudeId);
      expect(mapped).toMatch(/^gemini-/);
      expect(mapped).not.toBe(claudeId);
    }
  });

  it('preserves tier ordering — deep maps to pro, cheap maps to lite', () => {
    expect(toGeminiModelId(MODEL_IDS.deep)).toBe('gemini-pro-latest');
    expect(toGeminiModelId(MODEL_IDS.balanced)).toBe('gemini-flash-latest');
    expect(toGeminiModelId(MODEL_IDS.cheap)).toBe('gemini-flash-lite-latest');
  });

  it('passes through an unmapped id rather than inventing one', () => {
    expect(toGeminiModelId('gemini-3.0-experimental')).toBe('gemini-3.0-experimental');
  });
});

describe('provider interface conformance', () => {
  it('every provider satisfies the same shape, which is what makes them swappable', () => {
    const providers = [
      resolveProvider({ AI_PROVIDER: 'google', GOOGLE_API_KEY: 'k' }).provider,
      resolveProvider({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }).provider,
      resolveProvider({ AI_PROVIDER: 'fixture' }).provider,
    ];

    for (const provider of providers) {
      expect(typeof provider.id).toBe('string');
      expect(typeof provider.generateObject).toBe('function');
      expect(typeof provider.streamText).toBe('function');
    }
  });
});
