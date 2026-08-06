import { describe, expect, it } from 'vitest';
import { DEFAULT_PRIORITY_CONFIG, InvalidConfigError, resolvePriorityConfig } from '../config';

describe('core/config — I-8', () => {
  it('the default config satisfies alpha + beta + gamma = 1.0', () => {
    const sum =
      DEFAULT_PRIORITY_CONFIG.alpha + DEFAULT_PRIORITY_CONFIG.beta + DEFAULT_PRIORITY_CONFIG.gamma;
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it('rejects a config where the weights do not sum to 1.0', () => {
    expect(() => resolvePriorityConfig({ alpha: 0.5, beta: 0.25, gamma: 0.35 })).toThrow(
      InvalidConfigError,
    );
  });

  it('accepts per-cohort overrides that still sum correctly', () => {
    const config = resolvePriorityConfig({ alpha: 0.5, beta: 0.2, gamma: 0.3 });
    expect(config.alpha).toBe(0.5);
    expect(config.configVersion).toBe(DEFAULT_PRIORITY_CONFIG.configVersion);
  });
});
