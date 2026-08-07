/**
 * Which control a practice question needs.
 *
 * Extracted from the runner because getting this wrong is not a cosmetic bug:
 * the generator emits five question types and the grader handles all five, but
 * the runner rendered only the option-button list. A `numeric` question arrived
 * with no options, drew no controls at all, and left "Check answer" permanently
 * disabled — the learner was stuck with no way forward and no way back.
 *
 * `unanswerable` is the safety net. A question type nobody anticipated must
 * degrade into a skip, never into a trap.
 */

export type PracticeInputMode = 'choice' | 'value' | 'unanswerable';

export interface QuestionShape {
  type: string;
  options?: { id: string; text: string }[] | null;
}

/** Types the grader compares by value rather than by selected option id. */
const VALUE_TYPES = new Set(['numeric', 'short_answer']);

export function inputModeFor(question: QuestionShape): PracticeInputMode {
  // Options win when present: a `true_false` served with options is a choice,
  // and so is anything else the generator chooses to enumerate.
  if (question.options && question.options.length > 0) return 'choice';
  if (VALUE_TYPES.has(question.type)) return 'value';
  return 'unanswerable';
}
