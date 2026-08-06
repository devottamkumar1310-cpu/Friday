/**
 * @friday/ai — the intelligent shell.
 *
 * Bound by one rule (DP1): the LLM proposes, reasons, explains, and converses;
 * it never produces a number the system trusts. Mastery, due dates, priority,
 * and feasibility are computed in @friday/core.
 *
 * Phase 2 populates:
 *   router/       model selection, fallback chain, cost accounting
 *   context/      LearnerContextPacket assembly, deterministically budgeted
 *   agents/       the six cognitive units
 *   tools/        typed declarations; executors injected by services (ADR-017)
 *   prompts/      versioned prompt modules
 *   guardrails/   input sanitisation, output validation, injection defence
 *   evals/        golden datasets and scoring harness
 *
 * Phase 0 establishes only the tool-injection contract, because that boundary
 * is easiest to enforce before there is anything tempting to violate it for.
 */

export * from './tools/types';
