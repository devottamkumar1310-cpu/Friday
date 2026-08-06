import { describe, expect, it } from 'vitest';
import {
  MODEL_IDS,
  MONTHLY_BUDGET_USD,
  degradeTier,
  estimateCostUsd,
  isOverBudget,
  modelIdFor,
  route,
  tierFor,
} from '../router';
import {
  SUITE_GATES,
  runSuite,
  scoreCoachGrounding,
  scoreCurriculumStructure,
  scoreQuestionQuality,
  scoreRationaleFaithfulness,
} from '../evals';

describe('router — model policy (§5.3)', () => {
  it('routes each agent to the tier the architecture specifies', () => {
    expect(tierFor('curriculum_architect')).toBe('deep');
    expect(tierFor('diagnostician')).toBe('deep');
    expect(tierFor('coach')).toBe('balanced');
    expect(tierFor('content_generator')).toBe('balanced');
    expect(tierFor('reflector')).toBe('cheap');
  });

  it('maps tiers to the model ids named in the stack table', () => {
    expect(MODEL_IDS.deep).toBe('claude-opus-4-8');
    expect(MODEL_IDS.balanced).toBe('claude-sonnet-5');
    expect(MODEL_IDS.cheap).toBe('claude-haiku-4-5-20251001');
    expect(modelIdFor('coach')).toBe('claude-sonnet-5');
  });

  it('degrades one tier at a time and floors at cheap', () => {
    expect(degradeTier('deep')).toBe('balanced');
    expect(degradeTier('balanced')).toBe('cheap');
    expect(degradeTier('cheap')).toBe('cheap');
  });

  it('routes down and says so when over budget, rather than degrading silently', () => {
    const normal = route('curriculum_architect');
    expect(normal.degraded).toBe(false);
    expect(normal.tier).toBe('deep');

    const degraded = route('curriculum_architect', { overBudget: true });
    expect(degraded.degraded).toBe(true);
    expect(degraded.tier).toBe('balanced');
    expect(degraded.reason).toBe('monthly_budget_exceeded');
  });

  it('enforces the NFR-4.5 ceiling', () => {
    expect(MONTHLY_BUDGET_USD).toBe(0.6);
    expect(isOverBudget(0.59)).toBe(false);
    expect(isOverBudget(0.6)).toBe(true);
  });
});

describe('router — cost accounting', () => {
  it('prices output above input, and cached input far below fresh', () => {
    const fresh = estimateCostUsd('balanced', {
      inputTokens: 10_000,
      outputTokens: 0,
      cachedTokens: 0,
    });
    const cached = estimateCostUsd('balanced', {
      inputTokens: 10_000,
      outputTokens: 0,
      cachedTokens: 10_000,
    });
    expect(cached).toBeLessThan(fresh);

    const output = estimateCostUsd('balanced', {
      inputTokens: 0,
      outputTokens: 10_000,
      cachedTokens: 0,
    });
    expect(output).toBeGreaterThan(fresh);
  });

  it('is cheaper at lower tiers, which is what makes degradation worth doing', () => {
    const usage = { inputTokens: 10_000, outputTokens: 1_000, cachedTokens: 0 };
    expect(estimateCostUsd('cheap', usage)).toBeLessThan(estimateCostUsd('balanced', usage));
    expect(estimateCostUsd('balanced', usage)).toBeLessThan(estimateCostUsd('deep', usage));
  });

  it('a typical coach turn stays well inside the monthly budget', () => {
    // 8k context, mostly cached, ~400 tokens out.
    const cost = estimateCostUsd('balanced', {
      inputTokens: 8_000,
      outputTokens: 400,
      cachedTokens: 7_000,
    });
    expect(cost).toBeLessThan(MONTHLY_BUDGET_USD / 10);
  });
});

describe('evals — rationale faithfulness (I-11 / T3)', () => {
  it('passes when the stated factor is the largest contributor', () => {
    const result = scoreRationaleFaithfulness({
      id: 'r1',
      input: {
        factors: {
          impact: { contribution: 0.2 },
          urgency: { contribution: 0.1 },
          decayRisk: { contribution: 0.7 },
          readiness: { contribution: null },
        },
        statedDominantFactor: 'decayRisk',
        renderedText: 'Retention is dropping fastest here.',
      },
      output: '',
    });
    expect(result.passed).toBe(true);
  });

  it('fails a plausible-sounding rationale that names the wrong factor', () => {
    const result = scoreRationaleFaithfulness({
      id: 'r2',
      input: {
        factors: {
          impact: { contribution: 0.7 },
          urgency: { contribution: 0.2 },
          decayRisk: { contribution: 0.1 },
          readiness: { contribution: null },
        },
        statedDominantFactor: 'decayRisk',
        renderedText: 'You are about to forget this.',
      },
      output: '',
    });
    expect(result.passed).toBe(false);
    expect(result.notes[0]).toContain('impact');
  });

  it('ignores readiness, which has no additive contribution', () => {
    const result = scoreRationaleFaithfulness({
      id: 'r3',
      input: {
        factors: {
          impact: { contribution: 0.6 },
          decayRisk: { contribution: 0.4 },
          readiness: { contribution: null },
        },
        statedDominantFactor: 'impact',
        renderedText: '',
      },
      output: '',
    });
    expect(result.passed).toBe(true);
  });
});

describe('evals — coach grounding', () => {
  it('passes a response whose numbers all come from supplied facts', () => {
    const result = scoreCoachGrounding({
      id: 'c1',
      input: {
        availableFacts: ['weakest concept: Angular Momentum at 42 mastery'],
        response: 'Angular momentum is your weakest at 42%.',
      },
      output: '',
    });
    expect(result.passed).toBe(true);
  });

  it('fails a fabricated statistic', () => {
    const result = scoreCoachGrounding({
      id: 'c2',
      input: {
        availableFacts: ['weakest concept: Angular Momentum at 42 mastery'],
        response: 'You are 87% likely to pass.',
      },
      output: '',
    });
    expect(result.passed).toBe(false);
    expect(result.notes[0]).toContain('87%');
  });
});

describe('evals — suite gating (§5.8)', () => {
  it('applies the documented gate per suite', () => {
    expect(SUITE_GATES.curriculum).toBe(1.0);
    expect(SUITE_GATES.questions).toBe(0.95);
    expect(SUITE_GATES.grading).toBe(0.9);
    expect(SUITE_GATES.coach).toBe(1.0);
    expect(SUITE_GATES.rationale).toBe(0.95);
  });

  it('fails the curriculum gate on a single structural failure', () => {
    const suite = runSuite(
      'curriculum',
      [
        {
          id: 'ok',
          input: { valid: true, issueCodes: [], conceptCount: 40, minimumConcepts: 10 },
          output: null,
        },
        {
          id: 'cyclic',
          input: {
            valid: false,
            issueCodes: ['cycle_detected'],
            conceptCount: 40,
            minimumConcepts: 10,
          },
          output: null,
        },
      ],
      scoreCurriculumStructure,
    );
    expect(suite.gateMet).toBe(false);
    expect(suite.failures).toHaveLength(1);
  });

  it('passes a fully clean curriculum suite', () => {
    const suite = runSuite(
      'curriculum',
      [
        {
          id: 'ok',
          input: { valid: true, issueCodes: [], conceptCount: 40, minimumConcepts: 10 },
          output: null,
        },
      ],
      scoreCurriculumStructure,
    );
    expect(suite.gateMet).toBe(true);
  });

  it('tolerates one bad question in twenty, per the 95% gate', () => {
    const cases = Array.from({ length: 20 }, (_, i) => ({
      id: `q${i}`,
      input: { validationIssueCount: i === 0 ? 1 : 0, hasExplanation: true },
      output: null,
    }));
    const suite = runSuite('questions', cases, scoreQuestionQuality);
    expect(suite.passed).toBe(19);
    expect(suite.gateMet).toBe(true);
  });

  it('fails the question gate at two in twenty', () => {
    const cases = Array.from({ length: 20 }, (_, i) => ({
      id: `q${i}`,
      input: { validationIssueCount: i < 2 ? 1 : 0, hasExplanation: true },
      output: null,
    }));
    expect(runSuite('questions', cases, scoreQuestionQuality).gateMet).toBe(false);
  });
});

describe('router — provider-aware pricing (added after live validation)', () => {
  it('prices Gemini well below Claude for the same usage', () => {
    const usage = { inputTokens: 10_000, outputTokens: 1_000, cachedTokens: 0 };
    const claude = estimateCostUsd('balanced', usage, 'anthropic');
    const gemini = estimateCostUsd('balanced', usage, 'google');
    expect(gemini).toBeLessThan(claude);
    // Costing Gemini at Claude rates overstated spend ~10x during validation,
    // which would trip the budget ceiling far too early.
    expect(claude / gemini).toBeGreaterThan(5);
  });

  it('defaults to Anthropic pricing when the provider is unstated', () => {
    const usage = { inputTokens: 1_000, outputTokens: 100, cachedTokens: 0 };
    expect(estimateCostUsd('balanced', usage)).toBe(
      estimateCostUsd('balanced', usage, 'anthropic'),
    );
  });

  it('keeps tier ordering within Gemini pricing', () => {
    const usage = { inputTokens: 10_000, outputTokens: 1_000, cachedTokens: 0 };
    expect(estimateCostUsd('cheap', usage, 'google')).toBeLessThan(
      estimateCostUsd('balanced', usage, 'google'),
    );
    expect(estimateCostUsd('balanced', usage, 'google')).toBeLessThan(
      estimateCostUsd('deep', usage, 'google'),
    );
  });
});
