/**
 * Priority engine configuration — AI_DECISION_ENGINE §6.7, §17.
 *
 * Versioned, not constants. `α, β, γ, δ, λ, θ, φ` are starting points, tunable
 * per cohort (`user_preferences.planner_config`) and calibrated monthly. Every
 * decision trace records the `configVersion` that produced it (§17.2).
 *
 * I-8: `α + β + γ = 1.0` is enforced at load, not assumed.
 */

import { CONFIG_VERSION } from '../version';

export interface PriorityConfig {
  /** Impact weight. */
  alpha: number;
  /** Urgency weight. */
  beta: number;
  /** Decay-risk weight. */
  gamma: number;
  /** Cost exponent. */
  delta: number;
  /** Leverage coefficient. */
  lambda: number;
  /** Readiness threshold. */
  theta: number;
  /** Retention floor (§5.2). */
  phi: number;
  /** Adaptive learning-rate base (mastery update). */
  kBase: number;
  /** Adaptive learning-rate floor. */
  kFloor: number;
  /** Exposures before Decay Risk's `Established` term saturates. */
  repsMin: number;
  /** Urgency normalisation horizon, in days. */
  horizonDays: number;
  /** Hysteresis stability margin (§7.1). */
  hysteresisMargin: number;
  /** Viable-session floor, in minutes (§7.2). */
  minViableMinutes: number;
  /** Materiality threshold for re-planning (§10.3). */
  driftMaterialityThreshold: number;
  /** Feasibility on-track buffer, as a fraction of required minutes (§9). */
  feasibilityBufferFraction: number;
  configVersion: string;
}

export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = {
  alpha: 0.4,
  beta: 0.25,
  gamma: 0.35,
  delta: 0.5,
  lambda: 0.5,
  theta: 0.6,
  phi: 0.35,
  kBase: 0.3,
  kFloor: 0.05,
  repsMin: 3,
  horizonDays: 90,
  hysteresisMargin: 0.15,
  minViableMinutes: 8,
  driftMaterialityThreshold: 0.15,
  feasibilityBufferFraction: 0.15,
  configVersion: CONFIG_VERSION,
};

/** I-8. Thrown, never silently corrected — a bad config must not compute a decision. */
export class InvalidConfigError extends Error {}

export function validatePriorityConfig(config: PriorityConfig): void {
  const sumAbg = config.alpha + config.beta + config.gamma;
  if (Math.abs(sumAbg - 1.0) > 1e-9) {
    throw new InvalidConfigError(
      `alpha + beta + gamma must equal 1.0 (I-8); got ${sumAbg} ` +
        `(alpha=${config.alpha}, beta=${config.beta}, gamma=${config.gamma}).`,
    );
  }
  for (const [key, value] of Object.entries(config)) {
    if (key === 'configVersion') continue;
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new InvalidConfigError(`Config field "${key}" must be a finite number, got ${value}.`);
    }
  }
  if (config.delta < 0) throw new InvalidConfigError('delta (cost exponent) must be >= 0.');
  if (config.theta <= 0 || config.theta > 1) {
    throw new InvalidConfigError('theta (readiness threshold) must be in (0, 1].');
  }
  if (config.phi < 0 || config.phi > 1) {
    throw new InvalidConfigError('phi (retention floor) must be in [0, 1].');
  }
}

export function resolvePriorityConfig(overrides?: Partial<PriorityConfig>): PriorityConfig {
  const config = { ...DEFAULT_PRIORITY_CONFIG, ...overrides };
  validatePriorityConfig(config);
  return config;
}
