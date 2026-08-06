/**
 * Engine and configuration versions — AI_DECISION_ENGINE §17.
 *
 * Two identifiers that move independently, both stamped on every decision trace
 * so a decision can be replayed exactly (invariant T1):
 *
 *   ENGINE_VERSION  the algorithm.  MAJOR = decisions change for existing
 *                   learners; MINOR = new capability, compatible defaults;
 *                   PATCH = fix that does not intentionally change output.
 *   CONFIG_VERSION  the weight set. Changes when α, β, γ, δ, λ, θ, or φ move.
 *
 * A learner's config assignment is sticky for the life of a goal: a plan that
 * changes because *we* changed is indistinguishable, from the inside, from a
 * plan that changed because *they* changed.
 */

export const ENGINE_VERSION = '0.1.0' as const;

export const CONFIG_VERSION = 'default@0.1.0' as const;

export type EngineVersion = typeof ENGINE_VERSION;
export type ConfigVersion = typeof CONFIG_VERSION;
