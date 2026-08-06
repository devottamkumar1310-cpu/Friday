import { breakCycles, type ConceptEdge, type ConceptNode } from '@friday/core';
import { z } from 'zod';
import { wrapUntrusted } from '../guardrails';
import { CURRICULUM_ARCHITECT_PROMPT } from '../prompts';
import { modelIdFor } from '../router';
import type { ModelProvider } from '../types';

/**
 * Curriculum Architect — SYSTEM_ARCHITECTURE §5.5, roadmap 1.9.
 *
 * Inherited into Phase 2: Phase 1 shipped the deterministic engine and used
 * curated templates only, deferring this agent (CR-003 ledger).
 *
 * Its output is **structurally validated before it can reach the database**
 * (NFR-7.2). The validator is not a formality — a cyclic prerequisite graph
 * makes the scheduler non-terminating, and an invented `concept_key` silently
 * destroys cross-learner content caching. Both are checked here, and a failure
 * gets exactly one repair attempt before falling back to a curated template.
 */

export const GeneratedConceptSchema = z.object({
  key: z.string().min(1).describe('Tree-local identifier, referenced by prerequisite edges.'),
  conceptKey: z
    .string()
    .nullable()
    .describe('A key from the supplied canonical vocabulary, or null. Never invented.'),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  estimatedMinutes: z.number().int().min(5).max(600),
  difficulty: z.number().int().min(1).max(5),
  examWeight: z.number().min(0).max(1),
});

export const GeneratedTopicSchema = z.object({
  title: z.string().min(1).max(200),
  concepts: z.array(GeneratedConceptSchema).min(1),
});

export const GeneratedUnitSchema = z.object({
  title: z.string().min(1).max(200),
  topics: z.array(GeneratedTopicSchema).min(1),
});

export const GeneratedSubjectSchema = z.object({
  title: z.string().min(1).max(200),
  weight: z.number().min(0).max(1),
  units: z.array(GeneratedUnitSchema).min(1),
});

export const GeneratedEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  /** Soft-prerequisite strength. 1.0 is a hard prerequisite (`concept_edges.strength`). */
  strength: z.number().min(0).max(1),
});

export const GeneratedCurriculumSchema = z.object({
  subjects: z.array(GeneratedSubjectSchema).min(1),
  edges: z.array(GeneratedEdgeSchema),
});

export type GeneratedCurriculum = z.infer<typeof GeneratedCurriculumSchema>;

export interface CurriculumValidationIssue {
  code:
    | 'unknown_concept_key'
    | 'duplicate_concept_key'
    | 'edge_endpoint_missing'
    | 'cycle_detected'
    | 'empty_curriculum'
    | 'self_loop';
  detail: string;
}

export interface CurriculumValidationResult {
  valid: boolean;
  issues: CurriculumValidationIssue[];
  /** Edges with cycles broken, safe to persist. Present only when `valid`. */
  acyclicEdges?: { from: string; to: string; strength: number }[];
  conceptCount: number;
}

/**
 * The structural validator (NFR-7.2).
 *
 * Runs the *same* `breakCycles` the scheduler uses, so "acyclic at generation
 * time" and "acyclic at schedule time" are one guarantee rather than two
 * implementations that can drift apart.
 */
export function validateCurriculum(
  curriculum: GeneratedCurriculum,
  canonicalKeys: ReadonlySet<string>,
): CurriculumValidationResult {
  const issues: CurriculumValidationIssue[] = [];
  const concepts = curriculum.subjects.flatMap((s) =>
    s.units.flatMap((u) => u.topics.flatMap((t) => t.concepts)),
  );

  if (concepts.length === 0) {
    return {
      valid: false,
      issues: [{ code: 'empty_curriculum', detail: 'No concepts were produced.' }],
      conceptCount: 0,
    };
  }

  const seenKeys = new Set<string>();
  for (const concept of concepts) {
    if (seenKeys.has(concept.key)) {
      issues.push({
        code: 'duplicate_concept_key',
        detail: `Tree-local key "${concept.key}" is used more than once.`,
      });
    }
    seenKeys.add(concept.key);

    // ADR-016: the model maps to the vocabulary or returns null. It may not invent.
    if (concept.conceptKey !== null && !canonicalKeys.has(concept.conceptKey)) {
      issues.push({
        code: 'unknown_concept_key',
        detail: `Concept "${concept.title}" claims canonical key "${concept.conceptKey}", which does not exist.`,
      });
    }
  }

  for (const edge of curriculum.edges) {
    if (edge.from === edge.to) {
      issues.push({ code: 'self_loop', detail: `Edge "${edge.from}" points at itself.` });
      continue;
    }
    if (!seenKeys.has(edge.from) || !seenKeys.has(edge.to)) {
      issues.push({
        code: 'edge_endpoint_missing',
        detail: `Edge ${edge.from} → ${edge.to} references a concept that is not in the tree.`,
      });
    }
  }

  if (issues.length > 0) {
    return { valid: false, issues, conceptCount: concepts.length };
  }

  const nodes: ConceptNode[] = concepts.map((c) => ({
    id: c.key,
    title: c.title,
    examWeight: c.examWeight,
    estimatedMinutes: c.estimatedMinutes,
    status: 'not_started',
  }));
  const edges: ConceptEdge[] = curriculum.edges.map((e) => ({
    fromConceptId: e.from,
    toConceptId: e.to,
    type: 'prerequisite_of',
    strength: e.strength,
  }));

  const { edges: acyclic, brokenEdges } = breakCycles(nodes, edges);

  // A cycle is reported rather than silently repaired. At generation time we
  // have a model that can be asked to try again, which is strictly better than
  // persisting a curriculum whose prerequisite structure we quietly altered.
  if (brokenEdges.length > 0) {
    return {
      valid: false,
      issues: [
        {
          code: 'cycle_detected',
          detail:
            `Prerequisite graph contains ${brokenEdges.length} cycle-forming edge(s), e.g. ` +
            brokenEdges
              .slice(0, 3)
              .map((e) => `${e.fromConceptId} → ${e.toConceptId}`)
              .join(', '),
        },
      ],
      conceptCount: concepts.length,
    };
  }

  return {
    valid: true,
    issues: [],
    acyclicEdges: acyclic.map((e) => ({
      from: e.fromConceptId,
      to: e.toConceptId,
      strength: e.strength,
    })),
    conceptCount: concepts.length,
  };
}

export interface GenerateCurriculumInput {
  goalTitle: string;
  goalType: string;
  /** Free text from the learner — untrusted, and wrapped as such. */
  scope: string;
  selfReportedLevel?: string;
  targetDate: string;
  /** The canonical vocabulary the model must map into. */
  canonicalConcepts: { key: string; title: string; domain: string }[];
}

export interface GenerateCurriculumResult {
  curriculum: GeneratedCurriculum;
  validation: CurriculumValidationResult;
  promptVersion: string;
  modelId: string;
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number };
  /** True when the first attempt failed validation and a repair was requested. */
  repaired: boolean;
}

function buildPrompt(input: GenerateCurriculumInput): string {
  const vocabulary = input.canonicalConcepts
    .map((c) => `- ${c.key} — ${c.title} (${c.domain})`)
    .join('\n');

  return [
    `Goal: ${input.goalTitle} (type: ${input.goalType})`,
    `Target date: ${input.targetDate}`,
    input.selfReportedLevel ? `Learner's self-reported level: ${input.selfReportedLevel}` : '',
    '',
    'Scope described by the learner:',
    wrapUntrusted(input.scope, 'goal-scope'),
    '',
    'Canonical concept vocabulary — map to these keys or use null:',
    vocabulary || '(empty — use null for every conceptKey)',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Generates a curriculum, validates it, and retries once with the failures fed
 * back. The caller is expected to fall back to a curated template if this
 * throws — AI failure degrades the experience, it does not break the loop
 * (NFR-2.2, A6).
 */
export async function generateCurriculum(
  provider: ModelProvider,
  input: GenerateCurriculumInput,
): Promise<GenerateCurriculumResult> {
  const modelId = modelIdFor('curriculum_architect');
  const canonicalKeys = new Set(input.canonicalConcepts.map((c) => c.key));
  const basePrompt = buildPrompt(input);

  const first = await provider.generateObject({
    agent: 'curriculum_architect',
    modelId,
    system: CURRICULUM_ARCHITECT_PROMPT.system,
    prompt: basePrompt,
    schema: GeneratedCurriculumSchema,
    maxOutputTokens: 16_000,
  });

  let validation = validateCurriculum(first.object, canonicalKeys);
  if (validation.valid) {
    return {
      curriculum: first.object,
      validation,
      promptVersion: CURRICULUM_ARCHITECT_PROMPT.version,
      modelId,
      usage: first.usage,
      repaired: false,
    };
  }

  // One repair attempt, with the specific failures quoted back (§5.7).
  const repairPrompt = [
    basePrompt,
    '',
    'Your previous attempt was rejected by structural validation. Fix these problems exactly:',
    ...validation.issues.map((i) => `- [${i.code}] ${i.detail}`),
    '',
    'Return the complete corrected curriculum, not a diff.',
  ].join('\n');

  const second = await provider.generateObject({
    agent: 'curriculum_architect',
    modelId,
    system: CURRICULUM_ARCHITECT_PROMPT.system,
    prompt: repairPrompt,
    schema: GeneratedCurriculumSchema,
    maxOutputTokens: 16_000,
  });

  validation = validateCurriculum(second.object, canonicalKeys);

  return {
    curriculum: second.object,
    validation,
    promptVersion: CURRICULUM_ARCHITECT_PROMPT.version,
    modelId,
    usage: {
      inputTokens: first.usage.inputTokens + second.usage.inputTokens,
      outputTokens: first.usage.outputTokens + second.usage.outputTokens,
      cachedTokens: first.usage.cachedTokens + second.usage.cachedTokens,
    },
    repaired: true,
  };
}
