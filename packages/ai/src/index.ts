/**
 * @friday/ai — the intelligent shell.
 *
 * Bound by one rule (DP1): the LLM proposes, reasons, explains, and converses;
 * it never produces a number the system trusts. Mastery, due dates, priority,
 * and feasibility are computed in @friday/core.
 *
 * Phase 2 populates:
 *   types.ts      the ModelProvider seam — the reason CI never makes a live call
 *   router/       model selection by policy, tier degradation, cost accounting
 *   provider/     Anthropic (AI SDK v5) and recorded-fixture implementations
 *   context/      LearnerContextPacket assembly, deterministically budgeted
 *   tools/        typed declarations; executors injected by services (ADR-017)
 *   prompts/      versioned prompt modules
 *   guardrails/   injection defence, output validation, tool-call budget
 *   agents/       Curriculum Architect, Coach, Content Generator
 *   evals/        golden-set scoring harness
 *
 * Still to come: the Planner Advisor, Diagnostician, and Reflector agents
 * (Phase 3), and semantic retrieval, which needs pgvector (Phase 3, D11).
 */

export * from './types';
export * from './router';
export * from './context';
export * from './guardrails';
export * from './prompts';
export * from './tools/types';
export * from './tools/read-tools';
export * from './provider/fixture';
export * from './provider/anthropic';
export * from './agents/curriculum-architect';
export * from './agents/content-generator';
export * from './agents/coach';
export * from './evals';
