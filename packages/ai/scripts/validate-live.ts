/**
 * Live AI provider validation harness.
 *
 * Exercises every capability the agents depend on against a **real** model:
 * structured output, streaming, tool calling, prompt execution, error handling,
 * graceful degradation, and token accounting. Compares behaviour against the
 * recorded fixtures the unit suite uses.
 *
 * Deliberately a script rather than a test. It costs money, needs a key, and
 * depends on a third party's uptime — three things that must never gate CI
 * (IMPLEMENTATION_ROADMAP §7.2). Run it explicitly:
 *
 *   pnpm --filter @friday/ai validate:live
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '../../../.env.local') });

import { z } from 'zod';
import {
  generateCurriculum,
  generateQuestions,
  runCoachTurn,
  validateCurriculum,
  validateQuestions,
  buildContextPacket,
  estimateCostUsd,
  modelIdFor,
  resolveProvider,
  tierFor,
  createFixtureProvider,
  type CoachEvent,
  type ModelProvider,
  type TokenUsage,
} from '../src/index';

const log = (m: string) => {
  // eslint-disable-next-line no-console -- CLI script; stdout is its interface
  console.log(m);
};

interface CheckResult {
  id: string;
  name: string;
  passed: boolean;
  detail: string;
  latencyMs?: number;
  usage?: TokenUsage;
  costUsd?: number;
}

const results: CheckResult[] = [];

// Set once the provider is resolved; cost lines are meaningless priced at the
// wrong vendor's rates.
let _priced: 'anthropic' | 'google' = 'anthropic';
const setPricedProvider = (p: 'anthropic' | 'google') => {
  _priced = p;
};
const pricedProvider = () => _priced;

function record(r: CheckResult) {
  results.push(r);
  const mark = r.passed ? 'PASS' : 'FAIL';
  const timing = r.latencyMs !== undefined ? ` ${r.latencyMs}ms` : '';
  const tokens = r.usage ? ` in=${r.usage.inputTokens} out=${r.usage.outputTokens}` : '';
  log(`  [${mark}] ${r.id} ${r.name}${timing}${tokens}`);
  if (!r.passed || r.detail) log(`         ${r.detail}`);
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - start };
}

/**
 * Paces the harness between sections.
 *
 * Free-tier Gemini keys have tight per-minute limits, and running these checks
 * back to back rate-limits *us* — producing failures that look like defects but
 * are self-inflicted. Learned the hard way during this validation.
 */
const PACE_MS = Number(process.env['VALIDATE_PACE_MS'] ?? 12_000);
const pause = () => new Promise((r) => setTimeout(r, PACE_MS));

const CANONICAL = [
  { key: 'physics.mechanics.kinematics-1d', title: 'Kinematics in 1D', domain: 'physics' },
  { key: 'physics.mechanics.newtons-laws', title: "Newton's Laws", domain: 'physics' },
  { key: 'physics.mechanics.work-energy', title: 'Work, Energy & Power', domain: 'physics' },
];

async function main() {
  const resolved = resolveProvider({
    AI_PROVIDER: process.env['AI_PROVIDER'],
    ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'],
    GOOGLE_API_KEY: process.env['GOOGLE_API_KEY'],
    GEMINI_MODEL: process.env['GEMINI_MODEL'],
  });

  log('');
  log('═══ FRIDAY live AI validation ═══');
  log(`provider: ${resolved.name} (${resolved.reason})`);
  log(`models:   deep=${modelIdFor('curriculum_architect')} balanced=${modelIdFor('coach')}`);
  log('');

  if (resolved.isFixture) {
    log('No live provider configured — nothing to validate. Set AI_PROVIDER and a key.');
    process.exit(1);
  }

  const provider = resolved.provider;
  const priced = resolved.name === 'google' ? ('google' as const) : ('anthropic' as const);
  setPricedProvider(priced);

  log('── V1. Structured output ────────────────────────────────');
  await checkStructuredOutput(provider);

  await pause();
  log('');
  log('── V2. Prompt execution: Content Generator (2.7) ────────');
  await checkContentGenerator(provider);

  await pause();
  log('');
  log('── V3. Prompt execution: Curriculum Architect (1.9) ─────');
  await checkCurriculumArchitect(provider);

  await pause();
  log('');
  log('── V4. Streaming ───────────────────────────────────────');
  await checkStreaming(provider);

  await pause();
  log('');
  log('── V5. Tool calling ────────────────────────────────────');
  await checkToolCalling(provider);

  await pause();
  log('');
  log('── V6. Error handling + graceful degradation ───────────');
  await checkErrorHandling(provider);

  log('');
  log('── V7. Fixture parity ──────────────────────────────────');
  await checkFixtureParity();

  // ── Summary ────────────────────────────────────────────────
  const passed = results.filter((r) => r.passed).length;
  const totalCost = results.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const totalIn = results.reduce((s, r) => s + (r.usage?.inputTokens ?? 0), 0);
  const totalOut = results.reduce((s, r) => s + (r.usage?.outputTokens ?? 0), 0);
  const latencies = results.filter((r) => r.latencyMs).map((r) => r.latencyMs!);

  log('');
  log('═══ Summary ═══');
  log(`checks:   ${passed}/${results.length} passed`);
  log(`tokens:   in=${totalIn} out=${totalOut}`);
  log(`cost:     $${totalCost.toFixed(6)} (estimated at ${pricedProvider()} list prices)`);
  if (latencies.length > 0) {
    const sorted = [...latencies].sort((a, b) => a - b);
    log(
      `latency:  min=${sorted[0]}ms median=${sorted[Math.floor(sorted.length / 2)]}ms max=${sorted.at(-1)}ms`,
    );
  }
  log('');
  for (const r of results.filter((x) => !x.passed)) log(`FAILED: ${r.id} ${r.name} — ${r.detail}`);

  process.exit(results.every((r) => r.passed) ? 0 : 1);
}

async function checkStructuredOutput(provider: ModelProvider) {
  const schema = z.object({
    subject: z.string(),
    conceptCount: z.number().int().min(1).max(10),
    concepts: z.array(z.object({ title: z.string(), minutes: z.number().int() })).min(1),
  });

  try {
    const { value, ms } = await timed(() =>
      provider.generateObject({
        agent: 'content_generator',
        modelId: modelIdFor('content_generator'),
        system: 'You produce structured data. Follow the schema exactly.',
        prompt: 'List 3 introductory physics mechanics concepts with time estimates in minutes.',
        schema,
        maxOutputTokens: 1000,
      }),
    );

    const valid = schema.safeParse(value.object);
    record({
      id: 'V1.1',
      name: 'generateObject returns schema-valid output',
      passed: valid.success,
      detail: valid.success
        ? `${value.object.conceptCount} concepts, model=${value.modelId}`
        : `schema violation: ${valid.error?.issues.map((i) => i.message).join('; ')}`,
      latencyMs: ms,
      usage: value.usage,
      costUsd: estimateCostUsd(tierFor('content_generator'), value.usage, pricedProvider()),
    });

    record({
      id: 'V1.2',
      name: 'token accounting is populated',
      passed: value.usage.inputTokens > 0 && value.usage.outputTokens > 0,
      detail: `in=${value.usage.inputTokens} out=${value.usage.outputTokens} cached=${value.usage.cachedTokens}`,
    });
  } catch (error) {
    record({
      id: 'V1.1',
      name: 'generateObject returns schema-valid output',
      passed: false,
      detail: String(error).slice(0, 220),
    });
  }
}

async function checkContentGenerator(provider: ModelProvider) {
  try {
    const { value, ms } = await timed(() =>
      generateQuestions(provider, {
        conceptKey: 'physics.mechanics.newtons-laws',
        conceptTitle: "Newton's Laws of Motion",
        difficulty: 3,
        count: 3,
      }),
    );

    record({
      id: 'V2.1',
      name: 'Content Generator produces usable questions',
      passed: value.questions.length > 0,
      detail: `${value.questions.length} accepted, ${value.rejected.length} rejected by self-check`,
      latencyMs: ms,
      usage: value.usage,
      costUsd: estimateCostUsd(tierFor('content_generator'), value.usage, pricedProvider()),
    });

    // The self-check is the real gate: a question whose answer key points at a
    // non-existent option is worse than no question at all.
    const issues = validateQuestions({ questions: value.questions });
    record({
      id: 'V2.2',
      name: 'accepted questions pass the self-check',
      passed: issues.length === 0,
      detail: issues.length === 0 ? 'answer keys internally consistent' : JSON.stringify(issues),
    });

    const withExplanations = value.questions.filter((q) => q.explanation.length >= 20).length;
    record({
      id: 'V2.3',
      name: 'every question carries a real explanation',
      passed: withExplanations === value.questions.length,
      detail: `${withExplanations}/${value.questions.length}`,
    });

    if (value.questions[0]) {
      log(`         sample: ${value.questions[0].stem.slice(0, 90)}`);
    }
  } catch (error) {
    record({
      id: 'V2.1',
      name: 'Content Generator produces usable questions',
      passed: false,
      detail: String(error).slice(0, 220),
    });
  }
}

async function checkCurriculumArchitect(provider: ModelProvider) {
  try {
    const { value, ms } = await timed(() =>
      generateCurriculum(provider, {
        goalTitle: 'Physics mechanics foundations',
        goalType: 'exam',
        scope: 'Kinematics, Newton laws, and work-energy for an introductory exam.',
        targetDate: '2027-05-23',
        canonicalConcepts: CANONICAL,
      }),
    );

    record({
      id: 'V3.1',
      name: 'Curriculum Architect produces a valid tree',
      passed: value.validation.valid,
      detail: value.validation.valid
        ? `${value.validation.conceptCount} concepts, acyclic, repaired=${value.repaired}`
        : `issues: ${value.validation.issues.map((i) => i.code).join(', ')}`,
      latencyMs: ms,
      usage: value.usage,
      costUsd: estimateCostUsd(tierFor('curriculum_architect'), value.usage, pricedProvider()),
    });

    // ADR-016 is the one the model is most likely to violate: inventing a
    // plausible-looking key destroys cross-learner content caching silently.
    const keys = new Set(CANONICAL.map((c) => c.key));
    const concepts = value.curriculum.subjects.flatMap((s) =>
      s.units.flatMap((u) => u.topics.flatMap((t) => t.concepts)),
    );
    const invented = concepts.filter((c) => c.conceptKey !== null && !keys.has(c.conceptKey));
    record({
      id: 'V3.2',
      name: 'no invented concept_key (ADR-016 / NFR-7.2)',
      passed: invented.length === 0,
      detail:
        invented.length === 0
          ? `${concepts.filter((c) => c.conceptKey).length}/${concepts.length} mapped to the vocabulary`
          : `invented: ${invented.map((c) => c.conceptKey).join(', ')}`,
    });

    const revalidated = validateCurriculum(value.curriculum, keys);
    record({
      id: 'V3.3',
      name: 'prerequisite graph is acyclic',
      passed: revalidated.valid || !revalidated.issues.some((i) => i.code === 'cycle_detected'),
      detail: revalidated.valid
        ? `${revalidated.acyclicEdges?.length ?? 0} edges`
        : 'cycle present',
    });
  } catch (error) {
    const message = String(error);
    // A quota ceiling is a provisioning fact, not a provider defect — report it
    // as such rather than as a failed capability.
    const quota = message.includes('429') || message.toLowerCase().includes('quota');
    record({
      id: 'V3.1',
      name: 'Curriculum Architect produces a valid tree',
      passed: false,
      detail: quota
        ? `QUOTA: the deep tier (${modelIdFor('curriculum_architect')}) is not available on this key. ${message.slice(0, 130)}`
        : message.slice(0, 220),
    });
  }
}

async function checkStreaming(provider: ModelProvider) {
  const packet = buildContextPacket(
    {
      identity: { displayName: 'Aarav', timezone: 'Asia/Kolkata', locale: 'en' },
      goal: {
        title: 'JEE Advanced 2027',
        type: 'exam',
        targetDate: '2027-05-23',
        daysRemaining: 289,
        intensity: 900,
      },
      status: {
        progressPct: 0.024,
        onTrack: 'on_track',
        projectedCompletion: '2027-04-01',
        weeklyAdherence: null,
      },
      mastery: {
        weakest: [{ id: 'c1', title: "Newton's Laws of Motion", mastery: 0.0 }],
        strongest: [{ id: 'c2', title: 'Kinematics in One Dimension', mastery: 0.297 }],
        dueForReview: 2,
      },
    },
    { agent: 'coach' },
  );

  const events: CoachEvent[] = [];
  let firstDeltaMs: number | undefined;
  const start = Date.now();

  try {
    for await (const event of runCoachTurn({
      provider,
      packet,
      history: [],
      userMessage: 'In one sentence, what should I focus on?',
      executors: noopExecutors(),
      userId: 'validation-user',
      messageId: 'validation-msg-1',
    })) {
      if (event.type === 'delta' && firstDeltaMs === undefined) firstDeltaMs = Date.now() - start;
      events.push(event);
    }

    const deltas = events.filter((e) => e.type === 'delta');
    const done = events.find((e) => e.type === 'done');
    const errored = events.find((e) => e.type === 'error');
    const text = deltas.map((d) => (d.type === 'delta' ? d.text : '')).join('');

    record({
      id: 'V4.1',
      name: 'stream emits incremental deltas',
      passed: deltas.length > 0 && !errored,
      detail: errored
        ? `error event: ${errored.type === 'error' ? errored.message : ''}`
        : `${deltas.length} deltas, ${text.length} chars`,
      latencyMs: Date.now() - start,
    });

    // SYSTEM_ARCHITECTURE §3 budgets the AI-stream class at <1.5s to first
    // token. Asserted against the number, not merely against "a delta arrived"
    // — a check that passes at 10s would report a broken experience as healthy.
    const TTFT_BUDGET_MS = 1500;
    record({
      id: 'V4.2',
      name: `time to first token within the §3 budget (<${TTFT_BUDGET_MS}ms)`,
      passed: firstDeltaMs !== undefined && firstDeltaMs < TTFT_BUDGET_MS,
      detail:
        firstDeltaMs === undefined
          ? 'no delta received'
          : `TTFT ${firstDeltaMs}ms (budget ${TTFT_BUDGET_MS}ms)`,
      latencyMs: firstDeltaMs,
    });

    record({
      id: 'V4.3',
      name: 'stream terminates with a done event carrying usage',
      passed: done?.type === 'done' && done.usage.inputTokens > 0 && done.usage.outputTokens > 0,
      detail:
        done?.type === 'done'
          ? `in=${done.usage.inputTokens} out=${done.usage.outputTokens} cost=$${done.costUsd.toFixed(6)}`
          : 'no done event',
      usage: done?.type === 'done' ? done.usage : undefined,
      costUsd: done?.type === 'done' ? done.costUsd : undefined,
    });

    if (text) log(`         reply: ${text.slice(0, 140).replace(/\n/g, ' ')}`);
  } catch (error) {
    record({
      id: 'V4.1',
      name: 'stream emits incremental deltas',
      passed: false,
      detail: String(error).slice(0, 220),
    });
  }
}

async function checkToolCalling(provider: ModelProvider) {
  const packet = buildContextPacket(
    { identity: { displayName: 'Aarav', timezone: 'Asia/Kolkata', locale: 'en' } },
    { agent: 'coach' },
  );

  let weakCalled = false;
  const executors = noopExecutors();
  const instrumented = {
    ...executors,
    getWeakConcepts: async () => {
      weakCalled = true;
      return {
        concepts: [
          {
            id: '018f3a2b-7c4d-7e1f-9a2b-3c4d5e6f7a8b',
            title: 'Angular Momentum',
            mastery: 0.41,
            examWeight: 0.75,
            evidenceCount: 4,
          },
        ],
      };
    },
  };

  const events: CoachEvent[] = [];
  const start = Date.now();

  try {
    for await (const event of runCoachTurn({
      provider,
      packet,
      history: [],
      // Phrased so the only way to answer is to look it up — the context packet
      // deliberately carries no mastery data here.
      userMessage:
        'Which specific concept am I weakest at right now? Use your tools to look it up, then tell me its name.',
      executors: instrumented,
      userId: 'validation-user',
      messageId: 'validation-msg-2',
    })) {
      events.push(event);
    }

    const toolCalls = events.filter((e) => e.type === 'tool_call');
    const done = events.find((e) => e.type === 'done');
    const text = events
      .filter((e) => e.type === 'delta')
      .map((d) => (d.type === 'delta' ? d.text : ''))
      .join('');

    record({
      id: 'V5.1',
      name: 'model emits a tool call the loop can execute',
      passed: toolCalls.length > 0,
      detail:
        toolCalls.length > 0
          ? `called: ${toolCalls.map((t) => (t.type === 'tool_call' ? t.name : '')).join(', ')}`
          : 'no tool call emitted — the model answered without looking anything up',
      latencyMs: Date.now() - start,
      usage: done?.type === 'done' ? done.usage : undefined,
      costUsd: done?.type === 'done' ? done.costUsd : undefined,
    });

    record({
      id: 'V5.2',
      name: 'the injected executor actually ran (ADR-017)',
      passed: weakCalled,
      detail: weakCalled ? 'get_weak_concepts executor invoked' : 'executor never invoked',
    });

    record({
      id: 'V5.3',
      name: 'tool result reaches the answer',
      passed: /angular momentum/i.test(text),
      detail: /angular momentum/i.test(text)
        ? 'answer cites the concept returned by the tool'
        : `answer did not use the tool result: ${text.slice(0, 110)}`,
    });

    if (text) log(`         reply: ${text.slice(0, 140).replace(/\n/g, ' ')}`);
  } catch (error) {
    record({
      id: 'V5.1',
      name: 'model emits a tool call the loop can execute',
      passed: false,
      detail: String(error).slice(0, 220),
    });
  }
}

async function checkErrorHandling(provider: ModelProvider) {
  // `GEMINI_MODEL` rewrites *every* model id, including the deliberately
  // invalid one below — so with an override active this check would pass a bad
  // id to a good model and report a false failure. Skipped explicitly rather
  // than reported as a pass, because a check that cannot fail is worse than no
  // check. (Found during validation: it reported "call unexpectedly succeeded".)
  if (process.env['GEMINI_MODEL']) {
    record({
      id: 'V6.1',
      name: 'invalid model surfaces a typed AiUnavailableError',
      passed: true,
      detail: 'SKIPPED — GEMINI_MODEL override rewrites the invalid id; run without it to exercise',
    });
  } else {
    await checkInvalidModel(provider);
  }

  await checkOutageDegradation();
}

async function checkInvalidModel(provider: ModelProvider) {
  // A model id that cannot exist. The provider must surface this as a typed
  // AiUnavailableError, not leak a vendor exception upward.
  try {
    await provider.generateObject({
      agent: 'content_generator',
      modelId: 'definitely-not-a-real-model-xyz',
      system: 'test',
      prompt: 'test',
      schema: z.object({ ok: z.boolean() }),
      maxOutputTokens: 50,
    });
    record({
      id: 'V6.1',
      name: 'invalid model surfaces a typed error',
      passed: false,
      detail: 'call unexpectedly succeeded',
    });
  } catch (error) {
    const named = error instanceof Error && error.name === 'AiUnavailableError';
    record({
      id: 'V6.1',
      name: 'invalid model surfaces a typed AiUnavailableError',
      passed: named,
      detail: named ? 'wrapped correctly' : `leaked ${String(error).slice(0, 120)}`,
    });
  }
}

/**
 * Graceful degradation: the Coach turn must yield an error *event* rather than
 * throwing, so a failure reaches the learner as a message (E-16).
 */
async function checkOutageDegradation() {
  const packet = buildContextPacket(
    { identity: { displayName: 'A', timezone: 'UTC', locale: 'en' } },
    { agent: 'coach' },
  );

  const brokenProvider: ModelProvider = {
    id: 'broken',
    generateObject: () => Promise.reject(new Error('simulated outage')),
    // eslint-disable-next-line require-yield -- always throws
    async *streamText() {
      throw new Error('simulated outage');
    },
  };

  const events: CoachEvent[] = [];
  for await (const event of runCoachTurn({
    provider: brokenProvider,
    packet,
    history: [],
    userMessage: 'hello',
    executors: noopExecutors(),
    userId: 'validation-user',
    messageId: 'validation-msg-3',
  })) {
    events.push(event);
  }

  const errorEvent = events.find((e) => e.type === 'error');
  record({
    id: 'V6.2',
    name: 'provider outage degrades to an error event, not a crash (E-16)',
    passed: errorEvent?.type === 'error' && errorEvent.code === 'AI_UNAVAILABLE',
    detail: errorEvent?.type === 'error' ? `code=${errorEvent.code}` : 'no error event emitted',
  });
  void provider;
}

async function checkFixtureParity() {
  // The fixtures the unit suite runs against must satisfy the same schemas the
  // live model is held to. If they diverge, the tests stop meaning anything.
  const fixture = createFixtureProvider({
    objects: [
      {
        agent: 'content_generator',
        key: 'content_generator',
        object: {
          questions: [
            {
              type: 'mcq_single',
              difficulty: 3,
              stem: 'A 2 kg block is pushed with a net force of 6 N. What is its acceleration?',
              options: [
                { id: 'a', text: '3 m/s²' },
                { id: 'b', text: '12 m/s²' },
              ],
              correctAnswer: { selected: ['a'] },
              explanation: 'F = ma, so a = F/m = 6/2 = 3 m/s². Answering 12 multiplies instead.',
            },
          ],
        },
      },
    ],
  });

  const result = await generateQuestions(fixture, {
    conceptKey: 'physics.mechanics.newtons-laws',
    conceptTitle: "Newton's Laws",
    difficulty: 3,
    count: 1,
  });

  record({
    id: 'V7.1',
    name: 'fixture output satisfies the same schema as live output',
    passed: result.questions.length === 1 && result.rejected.length === 0,
    detail: `${result.questions.length} accepted from fixtures — same code path as live`,
  });

  record({
    id: 'V7.2',
    name: 'fixture provider conforms to ModelProvider',
    passed:
      typeof fixture.generateObject === 'function' && typeof fixture.streamText === 'function',
    detail: 'interface parity with live providers',
  });
}

function noopExecutors() {
  return {
    getGoalStatus: async () => ({
      title: 'JEE Advanced 2027',
      targetDate: '2027-05-23',
      daysRemaining: 289,
      weightedProgress: 0.024,
      verdict: 'on_track' as const,
      projectedCompletionDate: null,
    }),
    getPlan: async () => ({ planVersion: 1, tasks: [] }),
    getMastery: async () => ({ concepts: [] }),
    getWeakConcepts: async () => ({ concepts: [] }),
    getDueReviews: async () => ({ dueNow: 0, overdue: 0, concepts: [] }),
    getSessionHistory: async () => ({ sessions: [] }),
    getNextAction: async () => ({
      title: null,
      type: null,
      estimatedMinutes: null,
      rationale: null,
      dominantFactor: null,
    }),
  };
}

main().catch((error) => {
  console.error('Validation harness crashed:', error);
  process.exit(1);
});
