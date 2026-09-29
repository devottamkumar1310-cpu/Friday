# AI Validation Report — Google Gemini as a live provider

> **Date:** 2026-08-06 · **Baseline:** Blueprint v1.4 · **CR:** CR-005
> **Provider under test:** `google` via `@ai-sdk/google@2.0.86` + `ai@5.0.228`
> **Models:** `gemini-flash-latest`, `gemini-flash-lite-latest` (tier-mapped from the router)
> **Verdict:** **every capability verified live.** Two real findings, one operational constraint, no blocking defect.

---

## 1. Why this exists

Phase 2 shipped three agents that had never executed against a live model — the largest risk the project carried ([PHASE_2_HANDOFF](PHASE_2_HANDOFF.md) §6.1). A Gemini key closed that gap.

Gemini was added as a **first-class `ModelProvider`**, not a replacement. `SYSTEM_ARCHITECTURE` §2.1 already named this outcome — _"OpenAI / Gemini kept behind the provider interface as failover"_ — and ADR-012 anticipated it. **No agent, service, route, contract, or UI file changed to support a second vendor.** That was the requirement, and it is what the Phase 2 seam was built to buy.

---

## 2. What passed

Aggregated across runs (see §3 for why more than one was needed). Every check passed at least once against a live model.

| #        | Capability                                        | Result | Evidence                                                                                                                 |
| -------- | ------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| **V1.1** | Structured output conforms to a Zod schema        | ✅     | 1478ms, `in=24 out=106`                                                                                                  |
| **V1.2** | Token accounting populated                        | ✅     | Real counts from `usageMetadata`, not zeros                                                                              |
| **V2.1** | Content Generator produces usable questions       | ✅     | 3 accepted / 0 rejected, 3201ms                                                                                          |
| **V2.2** | Generated questions pass the self-check           | ✅     | Answer keys internally consistent                                                                                        |
| **V2.3** | Every question carries a real explanation         | ✅     | 3/3                                                                                                                      |
| **V3.1** | Curriculum Architect produces a valid tree        | ✅     | 2356ms, acyclic, no repair needed                                                                                        |
| **V3.2** | **No invented `concept_key`** (ADR-016 / NFR-7.2) | ✅     | All concepts mapped to the supplied vocabulary                                                                           |
| **V3.3** | Prerequisite graph acyclic                        | ✅     | Validated through the scheduler's own `breakCycles`                                                                      |
| **V4.1** | Streaming emits incremental deltas                | ✅     | 3 deltas, 141 chars                                                                                                      |
| **V4.3** | Stream terminates with usage-bearing `done`       | ✅     | `in=3959 out=132`                                                                                                        |
| **V5.1** | Model emits an executable tool call               | ✅     | Called `get_weak_concepts` unprompted                                                                                    |
| **V5.2** | Injected executor actually ran (ADR-017)          | ✅     | Executor invoked, not simulated                                                                                          |
| **V5.3** | Tool result reaches the answer                    | ✅     | _"Your weakest concept right now is **Angular Momentum**, with a current mastery of 41%… based on 4 pieces of evidence"_ |
| **V6.1** | Invalid model → typed `AiUnavailableError`        | ✅     | Wrapped, not leaked                                                                                                      |
| **V6.2** | Provider outage → error event, not a crash (E-16) | ✅     | `code=AI_UNAVAILABLE`                                                                                                    |
| **V7.1** | Fixture output satisfies the same schema as live  | ✅     | Identical code path                                                                                                      |
| **V7.2** | Fixture provider conforms to `ModelProvider`      | ✅     | Interface parity                                                                                                         |

**The tool-calling result is the one worth dwelling on.** The context packet deliberately carried no mastery data. The model recognised it could not answer, called `get_weak_concepts`, received the injected executor's result, and cited it accurately — mastery, evidence count, and exam weight. That exercises the full ADR-017 chain end to end: declaration in `packages/ai`, execution in the service layer, no database handle anywhere near the agent.

---

## 3. Behavioural differences vs. the recorded fixtures

### 3.1 Schema conformance is reliable but not perfect

Fixtures always conform by construction. Live models do not.

One `generateObject` call failed with `"No object generated: response did not match schema"` on the Content Generator's nested question schema. A targeted probe then ran the same call **9 times** on `gemini-flash-lite-latest`: **9/9 conformed**.

So the failure is **intermittent, not systematic** — roughly 1 in 10 at worst. The existing design already absorbs this: the Curriculum Architect has a repair loop (§5.7), and the Content Generator drops invalid questions rather than failing the set. No fix is required, but see §6 for a recommendation.

### 3.2 Self-check rejection is real, and the fixtures never show it

In 1 of 9 probe runs, the self-check rejected **every** generated question, returning an empty set. Fixtures never exercise this path because recorded fixtures are, by definition, ones that passed.

This is the guardrail working as designed — a question whose answer key points at a non-existent option is worse than no question. But it means a practice set can come back short or empty on a bad draw, and the current code does not retry.

### 3.3 Gemini emits a `thoughtSignature` field

Raw API responses include a `thoughtSignature` blob alongside the text. The AI SDK abstracts it away entirely — no code change needed. Noted only so it is not mistaken for corruption when reading raw traces.

### 3.4 Prompt-cache reporting

`cachedTokens` came back `0` on every call. Anthropic's prompt caching on the stable packet prefix is §5.3's **largest single cost saving**; Gemini's implicit caching did not report hits at these context sizes. The stable-prefix ordering in the context builder is still correct — it simply buys less on this vendor.

---

## 4. Performance observations

| Metric                           | Observed    | Budget            | Verdict                 |
| -------------------------------- | ----------- | ----------------- | ----------------------- |
| `generateObject` (simple schema) | 1478 ms     | —                 | Fine                    |
| Content Generator (3 questions)  | 3201 ms     | <45 s async (§3)  | Comfortable             |
| Curriculum Architect             | 2356 ms     | <45 s async (§3)  | Comfortable             |
| Coach full turn                  | 3421 ms     | —                 | Fine                    |
| Tool-calling round trip          | 3299 ms     | —                 | Fine                    |
| **Time to first token**          | **3271 ms** | **<1500 ms (§3)** | ❌ **MISS — 2.2× over** |

**TTFT is the one genuine performance finding.** SYSTEM_ARCHITECTURE §3 budgets the AI-stream class at <1.5 s to first token; Gemini delivered 3.3 s on `flash-lite` and 10.2 s on `flash-latest` under load.

I want to flag a process point here rather than bury it: **my first version of this check was wrong.** It asserted only that _a_ delta arrived, so it reported PASS at 10.2 s. A check that cannot fail is worse than no check, because it manufactures false confidence. It now asserts against the 1500 ms number, and consequently fails honestly.

---

## 5. Cost observations

**Actual spend: $0.00.** The key is on Gemini's free tier.

The more useful finding is a defect this surfaced. `estimateCostUsd` priced every call at **Claude rates**, overstating Gemini spend by roughly **10×**. Since that estimate feeds the per-user budget ceiling (§5.3 control 4), a Gemini deployment would have degraded learners to a lower model tier long before they had actually spent anything.

**Fixed:** pricing is now provider-aware, and the live provider's identity flows through the Coach and Content Generator. Three regression tests pin it.

Representative per-operation cost at Gemini list prices (`flash` tier, $0.30/M in, $2.50/M out):

| Operation                        | Tokens            | Est. cost |
| -------------------------------- | ----------------- | --------- |
| Coach turn (with context packet) | `in=3959 out=132` | ~$0.0015  |
| Content Generator (3 questions)  | `in=388 out=741`  | ~$0.0020  |
| Curriculum Architect             | `in=575 out=575`  | ~$0.0016  |

Against NFR-4.5's $0.60/user/month ceiling, that is roughly **300+ Coach turns per user per month** — the budget is not the binding constraint on this vendor.

---

## 6. Required fixes

### Applied during this work

| #   | Finding                                                                                                                                          | Fix                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | Cost estimated at Claude rates for all providers — ~10× overstatement, would trip the budget ceiling early                                       | Provider-aware pricing (`estimateCostUsd(tier, usage, provider)`), threaded through Coach and Content Generator. 3 tests. |
| 2   | TTFT check passed at 10.2 s — asserted "a delta arrived", not the budget                                                                         | Now asserts `<1500 ms` and fails honestly                                                                                 |
| 3   | Provider errors surfaced as bare `"generateObject failed"` — a bad key, retired model, unprovisioned tier, and rate limit were indistinguishable | `describeCause()` lifts Google's own `responseBody` message into the error                                                |
| 4   | `GEMINI_MODEL` override silently rewrote the deliberately-invalid model id, making V6.1 unfalsifiable                                            | Check now skips explicitly with a stated reason when an override is active                                                |
| 5   | Pinned `gemini-2.5-*` ids returned _"no longer available to new users"_                                                                          | Switched to `-latest` aliases, which track the current model per tier                                                     |
| 6   | Harness rate-limited itself by running checks back to back                                                                                       | Paced via `VALIDATE_PACE_MS` (default 12 s)                                                                               |

### Recommended, not applied

| #   | Finding                                                                                         | Recommendation                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7   | Content Generator drops invalid questions with no retry; a bad draw returns an empty set (§3.2) | Add a single retry when **all** questions are rejected. Deliberately not done here — it changes Phase 2 behaviour and belongs in a Phase 3 CR, not smuggled into a provider addition. |
| 8   | TTFT 2.2× over the §3 budget (§4)                                                               | Either accept a revised budget for Gemini via CR, or route the Coach to Anthropic while other agents use Gemini. The provider seam makes per-agent routing a small change.            |
| 9   | Free tier is **20 requests/day/model**                                                          | A provisioning matter, not a code one. Any sustained use needs a paid key.                                                                                                            |

---

## 7. Operational constraint worth stating plainly

The free tier allows **20 requests per day, per model** (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, `quotaValue: "20"`), and the `pro` tier is unavailable entirely (429 on every attempt).

This is why the results in §2 are aggregated across runs rather than drawn from one clean sweep — I exhausted the daily quota mid-validation. Each capability was verified against a live model; no result is inferred, and none is carried over from fixtures. But I want to be explicit that **no single run shows all 18 checks green simultaneously**, and on a paid key it should.

The `deep` tier (Curriculum Architect) was verified on `flash-lite` via `GEMINI_MODEL`, which isolates _the agent works_ from _this key cannot reach `pro`_. Those are different facts and the report should not conflate them.

---

## 8. Configuration

Gemini is now the configured provider:

```bash
AI_PROVIDER="google"
GOOGLE_API_KEY="…"        # in .env.local, gitignored, never committed
```

Switching back is one variable — `AI_PROVIDER=anthropic` with `ANTHROPIC_API_KEY` set. Anthropic support is untouched and remains the blueprint's primary (§2.1).

Selection semantics: an explicit `AI_PROVIDER` always wins, and a named provider **without its key is a hard error** rather than a silent fallback. A deployment that asks for Gemini and quietly gets Anthropic is worse than one that fails to start, because nobody finds out.

> **Security:** the key was shared in chat and should be treated as compromised — **rotate it.** It is written only to `.env.local` (gitignored) and appears in no committed file.

---

## 9. Verdict

**The AI layer is no longer unverified.** Structured output, streaming, tool calling, prompt execution, error handling, graceful degradation, and token accounting all work against a real model, through the unchanged provider interface.

Phase 2's headline can be revised: _the deterministic half is verified end to end, and the AI half is now verified live on Gemini_ — with one honest caveat, that TTFT misses the §3 budget by 2.2× and needs either a routing decision or a revised budget before the Coach ships to users.

The strongest evidence for the Phase 2 architecture is what this did **not** require: adding an entire second vendor touched one new provider file, one selection file, and one composition root. No agent knew it happened.

Phase 3 has not begun.
