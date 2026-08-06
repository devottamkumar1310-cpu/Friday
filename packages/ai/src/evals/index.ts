/**
 * Eval harness — SYSTEM_ARCHITECTURE §5.8, roadmap 2.12.
 *
 * "Prompts are code and get the same rigour." A prompt change that improves one
 * case and quietly breaks four others is the normal failure mode, and only a
 * scored golden set catches it.
 *
 * Suites and their gates (§5.8):
 *
 *   | Suite      | Measures                              | Gate                     |
 *   | Curriculum | coverage, ordering, estimate sanity   | structural 100%, ≥4/5    |
 *   | Questions  | correctness, calibration, explanation | ≥95% factually correct   |
 *   | Grading    | agreement with human labels           | ≥90%                     |
 *   | Coach      | grounding, no fabricated state        | 0 fabrications           |
 *   | Rationale  | faithfulness to the actual factors    | ≥95% faithful            |
 *
 * Everything here runs from **recorded fixtures**, never live calls (§7.2).
 */

export type SuiteName = 'curriculum' | 'questions' | 'grading' | 'coach' | 'rationale';

export interface EvalCase<TInput, TOutput> {
  id: string;
  input: TInput;
  /** The recorded model output this case scores. */
  output: TOutput;
  /** Human label, where the suite has one. */
  expected?: unknown;
}

export interface ScoreResult {
  caseId: string;
  passed: boolean;
  score: number;
  notes: string[];
}

export type Scorer<TInput, TOutput> = (evalCase: EvalCase<TInput, TOutput>) => ScoreResult;

export interface SuiteResult {
  suite: SuiteName;
  total: number;
  passed: number;
  meanScore: number;
  gate: number;
  gateMet: boolean;
  failures: ScoreResult[];
}

export const SUITE_GATES: Record<SuiteName, number> = {
  curriculum: 1.0,
  questions: 0.95,
  grading: 0.9,
  coach: 1.0,
  rationale: 0.95,
};

export function runSuite<TInput, TOutput>(
  suite: SuiteName,
  cases: EvalCase<TInput, TOutput>[],
  scorer: Scorer<TInput, TOutput>,
): SuiteResult {
  const results = cases.map(scorer);
  const passed = results.filter((r) => r.passed).length;
  const meanScore =
    results.length === 0 ? 0 : results.reduce((s, r) => s + r.score, 0) / results.length;
  const gate = SUITE_GATES[suite];
  const passRate = results.length === 0 ? 0 : passed / results.length;

  return {
    suite,
    total: results.length,
    passed,
    meanScore,
    gate,
    gateMet: passRate >= gate,
    failures: results.filter((r) => !r.passed),
  };
}

/**
 * Rationale faithfulness (I-11 / T3) — the highest-severity correctness
 * property in the product, expressed as a scorer.
 *
 * A rationale is faithful when the factor it names **is** the largest
 * contributor in the trace. This is not a copy check: per DP3, a
 * plausible-sounding reason that does not match the arithmetic is the worst
 * class of bug FRIDAY can ship, because the learner cannot detect it.
 */
export interface RationaleCase {
  factors: Record<string, { contribution: number | null }>;
  statedDominantFactor: string;
  renderedText: string;
}

export function scoreRationaleFaithfulness(evalCase: EvalCase<RationaleCase, string>): ScoreResult {
  const { factors, statedDominantFactor } = evalCase.input;
  const notes: string[] = [];

  const additive = Object.entries(factors)
    .filter(([, v]) => v.contribution !== null)
    .map(([k, v]) => [k, v.contribution ?? 0] as const)
    .sort((a, b) => b[1] - a[1]);

  const actualDominant = additive[0]?.[0];
  const faithful = actualDominant === statedDominantFactor;

  if (!faithful) {
    notes.push(
      `Stated dominant factor "${statedDominantFactor}" but the largest contributor is "${actualDominant}".`,
    );
  }

  return { caseId: evalCase.id, passed: faithful, score: faithful ? 1 : 0, notes };
}

/**
 * Coach grounding — 0 fabrications on the adversarial set.
 *
 * Scores whether every number appearing in the response also appears in the
 * context or a tool result. Crude by design: a false positive costs a review,
 * a false negative ships a Coach that invents a learner's mastery score.
 */
export interface CoachGroundingCase {
  availableFacts: string[];
  response: string;
}

export function scoreCoachGrounding(evalCase: EvalCase<CoachGroundingCase, string>): ScoreResult {
  const { availableFacts, response } = evalCase.input;
  const haystack = availableFacts.join(' ');
  const notes: string[] = [];

  // Percentages and decimals are the fabrication-prone shapes — a wrong "you're
  // at 62%" is both specific and unfalsifiable to the learner.
  const claimed = response.match(/\b\d+(?:\.\d+)?%|\b0\.\d+\b/g) ?? [];
  const unsupported = claimed.filter((token) => !haystack.includes(token.replace('%', '')));

  for (const token of unsupported) {
    notes.push(`Response states "${token}", which appears in no supplied fact or tool result.`);
  }

  const passed = unsupported.length === 0;
  return { caseId: evalCase.id, passed, score: passed ? 1 : 0, notes };
}

/** Curriculum structural pass — gate is 100%, so any issue fails the case. */
export interface CurriculumEvalCase {
  valid: boolean;
  issueCodes: string[];
  conceptCount: number;
  minimumConcepts: number;
}

export function scoreCurriculumStructure(
  evalCase: EvalCase<CurriculumEvalCase, unknown>,
): ScoreResult {
  const { valid, issueCodes, conceptCount, minimumConcepts } = evalCase.input;
  const notes: string[] = [];

  if (!valid) notes.push(`Structural validation failed: ${issueCodes.join(', ')}.`);
  if (conceptCount < minimumConcepts) {
    notes.push(
      `Coverage too thin: ${conceptCount} concepts, expected at least ${minimumConcepts}.`,
    );
  }

  const passed = notes.length === 0;
  return { caseId: evalCase.id, passed, score: passed ? 1 : 0, notes };
}

/** Question correctness — the answer key must be internally consistent. */
export interface QuestionEvalCase {
  validationIssueCount: number;
  hasExplanation: boolean;
}

export function scoreQuestionQuality(evalCase: EvalCase<QuestionEvalCase, unknown>): ScoreResult {
  const notes: string[] = [];
  if (evalCase.input.validationIssueCount > 0) {
    notes.push(`${evalCase.input.validationIssueCount} structural issue(s).`);
  }
  if (!evalCase.input.hasExplanation) notes.push('Missing explanation.');

  const passed = notes.length === 0;
  return { caseId: evalCase.id, passed, score: passed ? 1 : 0, notes };
}
