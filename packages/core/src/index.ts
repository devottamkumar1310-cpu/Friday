/**
 * @friday/core — the deterministic domain core.
 *
 * The most important package in the repository, and the one invariant that must
 * never bend: **no I/O, no framework imports, no LLM calls** (ADR-003). Given
 * state, it returns decisions. That purity is what makes the learning engine
 * unit-testable against hand-computed fixtures, and what lets the mastery,
 * retention, and scheduling models be swapped later behind the same interfaces
 * (AI_DECISION_ENGINE §18).
 *
 * Phase 1 (IMPLEMENTATION_ROADMAP 1.2-1.7, M0 subset per AI_DECISION_ENGINE §1.1):
 *   graph/        prerequisite traversal, readiness, topological order, cycles
 *   retention/    FSRS-5 wrapper: state transitions, due dates, retrievability
 *   mastery/      evidence -> mastery update, decay, belief confidence
 *   priority/     the two-tier ranking function (AI_DECISION_ENGINE §6)
 *   feasibility/  required vs. available minutes, forecast, verdict
 *   scheduling/   plan generation over the 14-day materialisation window
 *   replanning/   the re-plan pipeline and the missed-session debt model
 *   config/       versioned weights, validated at load (I-8)
 *   types/        plain domain types
 */

export * from './version';
export * from './config';
export * from './types';
export * from './graph';
export * from './retention';
export * from './mastery';
export * from './priority';
export * from './feasibility';
export * from './scheduling';
export * from './replanning';
export * from './intelligence';
