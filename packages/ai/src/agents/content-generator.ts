import { z } from 'zod';
import { CONTENT_GENERATOR_PROMPT } from '../prompts';
import { modelIdFor } from '../router';
import type { ModelProvider } from '../types';

/**
 * Content Generator — SYSTEM_ARCHITECTURE §5.5, roadmap 2.7.
 *
 * Produces practice questions for **one canonical concept**. Output is keyed by
 * `conceptKey`, never by learner, because questions are a shared asset: the
 * same generated item serves every learner who reaches that concept, which is
 * one of the five controls holding AI spend to $0.60/user/month (NFR-4.5).
 */

export const GeneratedQuestionSchema = z.object({
  type: z.enum(['mcq_single', 'mcq_multi', 'short_answer', 'numeric', 'true_false']),
  difficulty: z.number().int().min(1).max(5),
  stem: z.string().min(10).max(2000),
  /** Present for choice types; omitted for short_answer and numeric. */
  options: z
    .array(z.object({ id: z.string().min(1).max(4), text: z.string().min(1).max(500) }))
    .min(2)
    .max(6)
    .optional(),
  /** For choice types, the option id(s). For numeric/short answer, the value. */
  correctAnswer: z.object({
    selected: z.array(z.string()).optional(),
    value: z.string().optional(),
  }),
  explanation: z.string().min(20).max(2000),
});

export type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;

export const GeneratedQuestionSetSchema = z.object({
  questions: z.array(GeneratedQuestionSchema).min(1).max(20),
});

export interface QuestionValidationIssue {
  index: number;
  code:
    | 'missing_options'
    | 'answer_not_in_options'
    | 'no_correct_answer'
    | 'duplicate_stem'
    | 'excluded_stem';
  detail: string;
}

/**
 * Self-check pass (§5.7, "bad generated questions").
 *
 * Catches the failures that make a question actively harmful rather than merely
 * mediocre: an answer key pointing at an option that does not exist, a
 * single-answer question with two correct options, a duplicate of something the
 * learner already saw. Style is not policed here — that is what the eval
 * rubric is for.
 */
export function validateQuestions(
  set: { questions: GeneratedQuestion[] },
  excludedStems: ReadonlySet<string> = new Set(),
): QuestionValidationIssue[] {
  const issues: QuestionValidationIssue[] = [];
  const seen = new Set<string>();

  set.questions.forEach((q, index) => {
    const normalisedStem = q.stem.trim().toLowerCase();

    if (seen.has(normalisedStem)) {
      issues.push({ index, code: 'duplicate_stem', detail: 'Repeated within the same set.' });
    }
    seen.add(normalisedStem);

    if (excludedStems.has(normalisedStem)) {
      issues.push({
        index,
        code: 'excluded_stem',
        detail: 'Stem was in the exclusion list — the learner has seen it.',
      });
    }

    const isChoice = q.type === 'mcq_single' || q.type === 'mcq_multi' || q.type === 'true_false';
    const selected = q.correctAnswer.selected ?? [];

    if (isChoice) {
      if (!q.options || q.options.length < 2) {
        issues.push({ index, code: 'missing_options', detail: `${q.type} requires options.` });
        return;
      }
      if (selected.length === 0) {
        issues.push({ index, code: 'no_correct_answer', detail: 'No option marked correct.' });
        return;
      }
      const optionIds = new Set(q.options.map((o) => o.id));
      for (const id of selected) {
        if (!optionIds.has(id)) {
          issues.push({
            index,
            code: 'answer_not_in_options',
            detail: `Answer key references option "${id}", which is not among the options.`,
          });
        }
      }
      if (q.type === 'mcq_single' && selected.length !== 1) {
        issues.push({
          index,
          code: 'no_correct_answer',
          detail: `mcq_single must have exactly one correct option, found ${selected.length}.`,
        });
      }
    } else if (!q.correctAnswer.value) {
      issues.push({ index, code: 'no_correct_answer', detail: `${q.type} requires a value.` });
    }
  });

  return issues;
}

export interface GenerateQuestionsInput {
  conceptKey: string;
  conceptTitle: string;
  difficulty: number;
  count: number;
  /** Stems this learner has already seen, so generation does not repeat them. */
  excludeStems?: string[];
}

export interface GenerateQuestionsResult {
  questions: GeneratedQuestion[];
  rejected: { question: GeneratedQuestion; issues: QuestionValidationIssue[] }[];
  promptVersion: string;
  modelId: string;
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number };
}

/**
 * Generates and self-checks a question set.
 *
 * Invalid questions are **dropped, not repaired**. Unlike a curriculum — which
 * is one large artifact worth a retry — a question set degrades gracefully:
 * eight good questions out of ten is a usable practice set, and a second round
 * trip costs more than the two questions are worth.
 */
export async function generateQuestions(
  provider: ModelProvider,
  input: GenerateQuestionsInput,
): Promise<GenerateQuestionsResult> {
  const modelId = modelIdFor('content_generator');
  const excluded = new Set((input.excludeStems ?? []).map((s) => s.trim().toLowerCase()));

  const prompt = [
    `Concept: ${input.conceptTitle} (canonical key: ${input.conceptKey})`,
    `Difficulty: ${input.difficulty} of 5`,
    `Write ${input.count} question(s).`,
    input.excludeStems && input.excludeStems.length > 0
      ? `\nDo not reuse these stems:\n${input.excludeStems.map((s) => `- ${s}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const result = await provider.generateObject({
    agent: 'content_generator',
    modelId,
    system: CONTENT_GENERATOR_PROMPT.system,
    prompt,
    schema: GeneratedQuestionSetSchema,
    maxOutputTokens: 4_000,
  });

  const issues = validateQuestions(result.object, excluded);
  const issuesByIndex = new Map<number, QuestionValidationIssue[]>();
  for (const issue of issues) {
    issuesByIndex.set(issue.index, [...(issuesByIndex.get(issue.index) ?? []), issue]);
  }

  const questions: GeneratedQuestion[] = [];
  const rejected: GenerateQuestionsResult['rejected'] = [];
  result.object.questions.forEach((question, index) => {
    const questionIssues = issuesByIndex.get(index);
    if (questionIssues) rejected.push({ question, issues: questionIssues });
    else questions.push(question);
  });

  return {
    questions,
    rejected,
    promptVersion: CONTENT_GENERATOR_PROMPT.version,
    modelId,
    usage: result.usage,
  };
}
