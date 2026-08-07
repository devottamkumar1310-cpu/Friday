import { describe, expect, it } from 'vitest';
import { inputModeFor } from '../input-mode';

/**
 * Regression cover for a launch-readiness defect.
 *
 * A `numeric` question served without options rendered no controls at all and
 * left "Check answer" permanently disabled. The learner could not answer, could
 * not skip, and could not finish the set — the practice flow dead-ended. It was
 * invisible to every HTTP-level test because the API was behaving correctly;
 * only the browser showed it.
 *
 * The rule these tests hold: **every question type resolves to some control**,
 * and nothing resolves to "render nothing".
 */

const ALL_TYPES = ['mcq_single', 'mcq_multi', 'short_answer', 'numeric', 'true_false'] as const;

describe('inputModeFor', () => {
  it('uses the option list whenever one is served', () => {
    for (const type of ALL_TYPES) {
      expect(inputModeFor({ type, options: [{ id: 'a', text: 'A' }] })).toBe('choice');
    }
  });

  it('falls back to a typed answer for the value-graded types', () => {
    expect(inputModeFor({ type: 'numeric' })).toBe('value');
    expect(inputModeFor({ type: 'short_answer' })).toBe('value');
  });

  it('treats null and empty option lists the same as absent', () => {
    // The API models "no options" three ways; all of them reached the runner.
    expect(inputModeFor({ type: 'numeric', options: null })).toBe('value');
    expect(inputModeFor({ type: 'numeric', options: [] })).toBe('value');
    expect(inputModeFor({ type: 'numeric', options: undefined })).toBe('value');
  });

  it('never leaves a question without a control', () => {
    // The specific failure was `numeric` with no options resolving to nothing
    // renderable. No type may do that again — 'unanswerable' still yields a
    // skip button, which is a way forward.
    for (const type of ALL_TYPES) {
      expect(['choice', 'value', 'unanswerable']).toContain(inputModeFor({ type }));
    }
    expect(inputModeFor({ type: 'numeric' })).not.toBe('unanswerable');
  });

  it('degrades an unknown future type into a skip rather than a trap', () => {
    expect(inputModeFor({ type: 'matching_pairs' })).toBe('unanswerable');
  });
});
