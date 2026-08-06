# FRIDAY — AI Decision Engine

> **Status:** Pre-Production · Source of Truth · **The brain**
> **Version:** 1.1 · Blueprint v1.3
> **Depends on:** [PROJECT_VISION.md](PROJECT_VISION.md) (vocabulary, philosophy) · [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) (§5 AI, §6.3 domain core) · [DATABASE_DESIGN.md](DATABASE_DESIGN.md) (state) · [API_SPECIFICATION.md](API_SPECIFICATION.md) (§5.5 next-action contract)
>
> **This document is specification, not implementation.** It defines concepts, rules, contracts, and invariants. Formulas appear as specifications to be implemented and tested against, not as code.

---

### Relationship to SYSTEM_ARCHITECTURE §6.3

That section sketched the priority function. This document is its full definition and **supersedes it in two places**, both flagged inline:

| Refinement                                                                                     | Where                                  | Why                                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Effective mastery uses a **retention floor** rather than pure multiplication by retrievability | [§5.2](#52-mastery)                    | `m × R` implies knowledge decays to zero, which is empirically false and causes chronic over-scheduling of revision                       |
| A **selection stage** sits between scoring and output, applying bounded modifiers              | [§7](#7-selection--stability)          | The core formula stays pure and comparable; continuity, variety, and stability are selection concerns, not value concerns                 |
| Scoring is **two-tier** — structural terms per plan version, volatile terms per request        | [§6.0](#60-when-each-term-is-computed) | Graph traversals cannot fit a 300 ms budget; stored blended scores go stale within a day. Both halves must be computed at the right time. |

The core formula itself is unchanged. Everything else here is additive detail.

---

## 1. Purpose and Scope

### What this document governs

Every decision FRIDAY makes autonomously: what to study next, what goes in a plan, when to revise, whether a goal is reachable, what is going wrong, when to speak up, what to test, and what to cut.

### The question it must always be able to answer

> **"Why did you recommend this, to me, right now — and how sure are you?"**

If any part of the system cannot answer that question from recorded data, that part is not finished.

### Non-goals

This document does not specify prompt text, UI copy, model selection (see [SYSTEM_ARCHITECTURE §5.3](SYSTEM_ARCHITECTURE.md#53-model-routing)), or storage mechanics beyond the trace schema in §13.

### 1.1 What ships at M0 — the frozen engine subset

This document specifies the engine at full depth. **M0 implements a deliberate subset.** The subset is frozen: adding to it during the Shipathon requires a change request, not a judgement call at 2am on day 11.

| Area                    | M0 ships                                                      | Deferred to M1+                                           |
| ----------------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| **Priority formula**    | All five factors, fixed default weights (§6.7)                | Per-cohort tuning, config experiments                     |
| **Urgency**             | Derived from **plan position** within the materialised window | Full backward-pass slack over the prerequisite DAG (§6.3) |
| **Leverage**            | Direct out-degree only (depth 1)                              | Transitive descendant counts (depth 6)                    |
| **Selection modifiers** | Hysteresis (M3) only                                          | Continuity, variety, override memory, energy, freshness   |
| **Confidence**          | Computed and traced, **not surfaced in the UI**               | Bands, explore/exploit redirection (§11.4)                |
| **Explainability**      | L1 headline + L2 factor breakdown, deterministic templates    | LLM-phrased variants, change explanations (§12.4)         |
| **Traceability**        | Traces written for every decision                             | Trace API, counterfactual replay                          |
| **Re-planning**         | Manual trigger only                                           | Nightly cron, drift detection, materiality gate           |
| **Edge cases**          | E-1, E-5, E-6, E-7, E-8, E-13, E-16, E-23                     | The remainder                                             |

The deferred items are additive — each slots into an existing pipeline stage (§4) without changing the stages themselves. Nothing in the M0 subset has to be rewritten to accommodate them, which is the point of specifying the full engine before building the partial one.

---

## 2. Decision Philosophy

Ten doctrines. Where an implementation choice is ambiguous, these decide it.

### DP1 — The engine decides; the model explains

The complete restatement of [SYSTEM_ARCHITECTURE §5.1](SYSTEM_ARCHITECTURE.md#51-the-contract-between-ai-and-the-system): no decision that affects a learner's schedule, mastery, forecast, or priority is ever produced by a language model. The model's role in decision-making is strictly (a) supplying _a priori_ estimates before evidence exists, (b) converting a computed decision into language, and (c) proposing changes a human confirms.

**Why it is absolute:** a wrong recommendation is recoverable; an _unexplainable_ wrong recommendation is not. The learner cannot correct what they cannot inspect, and we cannot debug what we cannot reproduce.

### DP2 — Decisions are functions of state, never of history

The same learner state must always produce the same decision. The engine holds no hidden memory between invocations; everything it uses is persisted, versioned state. This makes every decision reproducible, testable, cacheable, and replayable — and it is what makes §13 traceability possible at all.

### DP3 — Explanation is a projection, not a narration

The explanation is _derived from_ the factor values that produced the decision. It is never generated independently and never generated post-hoc from the outcome. A plausible-sounding reason that does not match the arithmetic is a **correctness bug of the highest severity**, not a copy problem.

### DP4 — Confidence is a first-class output

Every decision emits a confidence score. Low confidence is not a reason to hide the decision; it is a reason to **change what kind of decision we make** — preferring actions that acquire information over actions that assume it (§11.4).

### DP5 — Stability is a feature

A recommendation that changes every time the page is refreshed is worthless regardless of its accuracy. The engine applies hysteresis: it changes its mind only when the evidence justifies the disruption. Plan churn is tracked as a defect metric.

### DP6 — Honest under uncertainty

When the engine does not know, it says so. When a goal is not reachable, it says so with the arithmetic. It never manufactures confidence, never rounds bad news toward comfort, and never substitutes encouragement for information. Per [PROJECT_VISION §6](PROJECT_VISION.md#6-core-philosophy), principle 4.

### DP7 — Override is evidence, not defiance

When a learner rejects a recommendation, the engine treats it as a signal about the model, not about the learner. Repeated overrides in a pattern must change future decisions. A system that keeps recommending what the user keeps refusing is broken.

### DP8 — Retention debt outranks coverage debt

Forgetting compounds; unstudied material does not. Given a conflict between reviewing something at risk of being lost and learning something new, review wins by default. This is the single most consequential default in the engine, because it is the one students get wrong on their own.

### DP9 — Degrade, never guess

Every decision path has a defined behaviour when an input is missing, stale, or unavailable — falling back through progressively simpler rules to a defensible default. The engine never fabricates a missing input to complete a computation.

### DP10 — Every decision is recorded

No decision reaches a learner without a durable trace of the inputs, candidates, scores, configuration, and confidence that produced it. Traces are the substrate for debugging, for support, for evaluation, and for offline improvement (§18.7).

---

## 3. The Decision Catalog

The engine answers eight questions. Each has an owner, a determinism class, and a cadence. This catalog is the complete surface of FRIDAY's autonomous judgement.

| ID     | Decision                                  | Owner                                   | Determinism                                      | Cadence                  | Output                                    |
| ------ | ----------------------------------------- | --------------------------------------- | ------------------------------------------------ | ------------------------ | ----------------------------------------- |
| **D1** | _What should I do right now?_             | `core/priority`                         | **Fully deterministic**                          | On demand, cached 5 min  | Next Action + factors + confidence        |
| **D2** | _What should the plan contain, and when?_ | `core/scheduling`                       | **Fully deterministic**                          | On plan generation       | Plan version + blocks + tasks             |
| **D3** | _When should this be revised?_            | `core/retention`                        | **Fully deterministic**                          | On every evidence event  | Due date, stability, difficulty           |
| **D4** | _Will I finish in time?_                  | `core/feasibility`                      | **Fully deterministic**                          | On every material change | Verdict, projection, remediation options  |
| **D5** | _What is going wrong, and why?_           | `core/graph` + Diagnostician            | Hybrid — deterministic detection, AI attribution | On assessment, weekly    | Weak concepts, root-cause chain, insights |
| **D6** | _Should FRIDAY say something?_            | `proactivity` detectors + policy        | **Deterministic gate**, AI copy                  | Event + hourly sweep     | Directive or suppression, with reason     |
| **D7** | _What should I be tested on?_             | `core/priority` (information-gain mode) | **Fully deterministic**                          | On assessment request    | Concept + difficulty selection            |
| **D8** | _What should be cut if time runs out?_    | `core/feasibility`                      | **Fully deterministic**                          | On `not_feasible`        | Ranked scope-reduction list               |

**Read the determinism column carefully.** Six of eight decisions are fully deterministic. The two hybrids use AI only for attribution and phrasing, never for the judgement itself. This is what makes FRIDAY's behaviour reproducible and its numbers defensible.

---

## 4. The Decision Pipeline

Every decision, regardless of type, flows through the same seven stages. Uniformity here is what makes tracing, testing, and extension uniform too.

```
  ┌──────────────┐
  │  1. SENSE    │  Load the decision inputs. Nothing is fetched that
  │              │  the decision type did not declare it needs.
  └──────┬───────┘
         ▼
  ┌──────────────┐
  │  2. MODEL    │  Derive learner state: effective mastery, retrievability,
  │              │  readiness, slack, pace, reliability. Pure computation.
  └──────┬───────┘
         ▼
  ┌──────────────┐
  │  3. GENERATE │  Enumerate candidates. Apply HARD eligibility filters.
  │              │  Anything filtered here is recorded with its reason.
  └──────┬───────┘
         ▼
  ┌──────────────┐
  │  4. SCORE    │  Apply the priority function. Every factor value and
  │              │  contribution retained — not just the total.
  └──────┬───────┘
         ▼
  ┌──────────────┐
  │  5. SELECT   │  Apply soft modifiers (continuity, variety, hysteresis),
  │              │  fit to the time budget, choose. Record what was relaxed.
  └──────┬───────┘
         ▼
  ┌──────────────┐
  │  6. ASSESS   │  Compute recommendation confidence. Confidence band may
  │              │  redirect to an information-gaining action instead.
  └──────┬───────┘
         ▼
  ┌──────────────┐
  │  7. EXPLAIN  │  Project factors → structured explanation → language.
  │  + RECORD    │  Write the decision trace. Emit the decision.
  └──────────────┘
```

**Stage boundaries are contracts.** Each stage takes the previous stage's output and adds to it; no stage reaches backward for data it wasn't given. This is what allows any stage to be replaced (§18) without touching the others.

### Stage responsibilities

| Stage      | Must                                                     | Must never                                   |
| ---------- | -------------------------------------------------------- | -------------------------------------------- |
| 1 Sense    | Declare inputs; load atomically at one logical timestamp | Read state mid-computation                   |
| 2 Model    | Be pure; be deterministic                                | Persist anything                             |
| 3 Generate | Record every exclusion with a reason code                | Silently drop candidates                     |
| 4 Score    | Retain per-factor values and contributions               | Collapse to a single number only             |
| 5 Select   | Record every relaxation and modifier applied             | Apply an unbounded adjustment                |
| 6 Assess   | Emit confidence even when high                           | Suppress a decision for low confidence alone |
| 7 Explain  | Derive language from factors                             | Generate a reason not present in the factors |

---

## 5. The Learner State Model

Everything the engine reasons over. Six state variables, three per-concept and three per-learner.

### 5.1 State variables

| Variable                   | Scope       | Range     | Source                      | Meaning                                                               |
| -------------------------- | ----------- | --------- | --------------------------- | --------------------------------------------------------------------- |
| **`m`** raw mastery        | per concept | [0,1]     | `mastery_states.mastery`    | Proficiency when the material is fresh                                |
| **`κ`** belief confidence  | per concept | [0,1]     | `mastery_states.confidence` | How much we trust `m`                                                 |
| **`S, D, R`** memory state | per concept | FSRS      | `memory_states`             | Stability, difficulty, retrievability                                 |
| **`ρ`** reliability factor | per learner | [0.3,1.2] | `plans.reliability_factor`  | Planned minutes actually completed — _do they show up_                |
| **`π`** pace factor        | per learner | [0.5,2.0] | derived                     | Actual vs. estimated minutes to reach mastery — _how fast they learn_ |
| **`ε`** energy profile     | per learner | curve     | derived (M2)                | Performance by time of day and session position                       |

> **`ρ` and `π` are the personalisation core.** Everything else is either curriculum structure or evidence. These two numbers are what make FRIDAY's plan _yours_ rather than a generic calendar fill — and they are learned from behaviour, never asked for.

### 5.2 Mastery

**Update rule** (on each Evidence Event `e` against concept `c`):

```
expected  = m
observed  = outcome(e)                        ∈ [0,1]
w         = w_source(e) · w_difficulty(e) · w_recency(e)
K         = K_base · (1 − κ) + K_floor        adaptive learning rate
m'        = clamp₀₁( m + K · w · (observed − expected) )
```

`K` is high when belief confidence is low (early evidence moves the estimate a lot) and approaches `K_floor` as confidence grows (established mastery resists single data points). This is the ELO-flavoured update from [SYSTEM_ARCHITECTURE §6.3](SYSTEM_ARCHITECTURE.md#63-the-domain-core-packagescore), specified.

**Evidence weights** — not all evidence is equal:

| Source                         | `w_source` | Rationale                                                                                               |
| ------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------- |
| `assessment` (timed, scored)   | 1.00       | Strongest signal — performance under conditions                                                         |
| `question_response`            | 0.85       | Strong, but single-item noise                                                                           |
| `coach_check` (Socratic)       | 0.60       | Genuine but unstructured                                                                                |
| `self_rating`                  | 0.35       | Necessary and systematically biased (§15, E-11)                                                         |
| `inferred` (time-on-task only) | 0.15       | Weak — activity is not learning ([PROJECT_VISION §6](PROJECT_VISION.md#6-core-philosophy), principle 7) |

`w_difficulty` scales with item difficulty relative to current mastery — succeeding at something hard is worth more than succeeding at something easy. `w_recency` decays older evidence within the same computation window so a burst of activity does not overwhelm the estimate.

**Effective mastery** — _refines [SYSTEM_ARCHITECTURE §6.3](SYSTEM_ARCHITECTURE.md#63-the-domain-core-packagescore)_:

```
m_eff = m · ( φ + (1 − φ) · R )        φ = retention floor, default 0.35
```

Pure multiplication by retrievability (`m · R`) asserts that unreviewed knowledge decays to nothing. It does not — relearning is dramatically faster than learning, and a learner who mastered a topic six months ago is not equivalent to one who never saw it. The floor `φ` represents that durable residue. Without it, the engine over-schedules revision and under-schedules new material, which is the exact failure mode of naive spaced-repetition tools.

### 5.3 Belief confidence `κ`

How much the engine trusts its own mastery estimate. Four inputs:

| Input                                             | Effect              | Reasoning                                                                       |
| ------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------- |
| **Volume** — count of evidence events             | ↑ with saturation   | Three observations beat one; thirty barely beat twenty                          |
| **Diversity** — distinct sources and item types   | ↑                   | Five self-ratings are weaker than one quiz plus one session                     |
| **Consistency** — variance across recent outcomes | ↓ with variance     | Alternating success and failure means we do not understand this learner's grasp |
| **Recency** — time since last evidence            | ↓ with elapsed time | An estimate from two months ago is a claim about the past                       |

`κ` drives: the adaptive learning rate `K`, recommendation confidence (§11), whether a diagnostic is preferred over instruction (§11.4), and how loudly the UI states a claim.

### 5.4 Retention `S, D, R`

FSRS-5 per `(user, concept)`. **Retrievability `R` is computed from stability and elapsed time at read; it is never stored** — storing it would require rewriting every row every day ([DATABASE_DESIGN §4.6](DATABASE_DESIGN.md)).

Rating derivation is unified across sources so retention and mastery never disagree about what happened:

| Source                             | → FSRS rating                                             |
| ---------------------------------- | --------------------------------------------------------- |
| Explicit self-rating               | Direct (`again`/`hard`/`good`/`easy`)                     |
| Assessment accuracy on the concept | `<40%`→`again`, `<70%`→`hard`, `<90%`→`good`, else `easy` |
| Session completion with no rating  | `good` at reduced weight — completion is weak evidence    |
| Session abandoned                  | `again`, and flagged for diagnosis                        |

### 5.5 Reliability `ρ` and pace `π`

Both are rolling, decayed estimates over completed plan history.

```
ρ = Σ actual_minutes / Σ planned_minutes            (exponentially weighted, recent-heavy)
π = Σ actual_minutes_to_mastery / Σ estimated_minutes
```

|         | Answers                                             | Feeds                                                               |
| ------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| **`ρ`** | Will they do what the plan says?                    | Available-minutes calculation in feasibility (§9); forecast honesty |
| **`π`** | Do the curriculum's time estimates fit this person? | Cost term in priority (§6.6); plan density                          |

Both are clamped and require a minimum sample before departing from 1.0 (§15, E-1). `π` is additionally computed **per subject** once sufficient data exists — a learner may be fast at mathematics and slow at organic chemistry, and a single global number would hide that.

---

## 6. The Priority Scoring Framework

The core of D1 and D2. This is the complete specification of the formula in [SYSTEM_ARCHITECTURE §6.3](SYSTEM_ARCHITECTURE.md#63-the-domain-core-packagescore).

```
Priority(c) = Readiness(c) × [ α·Impact(c) + β·Urgency(c) + γ·DecayRisk(c) ] / Cost(c)^δ
```

Five factors. Three additive (the _value_ of doing it), one multiplicative gate (_may_ it be done), one divisor (_what it costs_).

### 6.0 When each term is computed

The formula is evaluated in **two tiers**, because its terms change on completely different timescales and have completely different costs.

| Tier           | Terms                                                                   | Cost                                                  | Changes when                                    | Computed                                           | Stored                     |
| -------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------- | -------------------------- |
| **Structural** | Impact, Urgency (slack), Leverage, Readiness, Cost                      | Expensive — graph traversals over the full curriculum | Curriculum, plan, or mastery changes materially | Once **per plan version**                          | `tasks.structural_factors` |
| **Volatile**   | DecayRisk, effective mastery, time-window fit, selection modifiers (§7) | Cheap — arithmetic over tens of candidates            | Continuously; retrievability decays daily       | **Per request**, over the materialised window only | Never                      |

**Why this split is mandatory, not an optimisation:**

- Urgency requires a **backward pass over the prerequisite DAG**; Leverage requires **transitive descendant counts**. Neither fits NFR-1.7's 300 ms budget on a 400-concept curriculum.
- DecayRisk and effective mastery change _every day_. A blended score written at plan time is wrong within 24 hours — precisely when the Next Action matters most.

Candidate generation (stage 3) draws only from the plan's **materialised near-horizon window** ([DATABASE_DESIGN §4.3](DATABASE_DESIGN.md)) plus all due reviews. That bounds the request-time set to tens of candidates regardless of curriculum size, which is what makes E-26 (enormous curricula) a non-issue rather than a special case.

### 6.1 Factor register

| ID     | Factor     | Symbol | Range   | Role                | Weight     |
| ------ | ---------- | ------ | ------- | ------------------- | ---------- |
| **F1** | Impact     | `I`    | [0,1]   | Additive            | `α` = 0.40 |
| **F2** | Urgency    | `U`    | [0,1]   | Additive            | `β` = 0.25 |
| **F3** | Decay Risk | `Δ`    | [0,1]   | Additive            | `γ` = 0.35 |
| **F4** | Readiness  | `Ω`    | [0,1]   | Multiplicative gate | —          |
| **F5** | Cost       | `C`    | minutes | Divisor             | `δ` = 0.5  |

`α + β + γ = 1.0` by convention, so the bracketed term stays in [0,1] and priority scores remain comparable across learners, goals, and engine versions. **This constraint is enforced at config load.**

### 6.2 F1 — Impact

_How much is learning this worth?_

```
Impact(c) = ExamWeight(c) · Gap(c) · Leverage(c)

  Gap(c)      = 1 − m_eff(c)
  Leverage(c) = 1 + λ · normalise( |descendants(c)| )     λ = 0.5
```

| Component    | Source                                              | Meaning                            |
| ------------ | --------------------------------------------------- | ---------------------------------- |
| `ExamWeight` | `concepts.exam_weight` × topic/unit/subject weights | How much this matters for the goal |
| `Gap`        | Effective mastery                                   | How much room there is to improve  |
| `Leverage`   | Prerequisite graph out-degree, transitively         | How much else this unlocks         |

**Why Leverage exists:** a foundational concept blocking twelve downstream topics is worth more than an isolated one of equal exam weight. Without this term the engine optimises locally and leaves learners stuck behind unlearned foundations — the single most common failure of naive priority ordering. `descendants(c)` is bounded at depth 6 for cost.

**Degenerate case:** `Gap → 0` drives Impact → 0, so mastered concepts leave the running naturally. They re-enter only through Decay Risk, which is correct.

### 6.3 F2 — Urgency

_How soon must this be done?_

Urgency is **not** a simple function of the deadline — that would score every concept identically for an exam goal. It is derived from **slack**, computed by a backward pass through the prerequisite DAG from the target date, borrowing the critical-path method:

```
latestStart(c)  = targetDate − remainingEffort(c) − Σ remainingEffort(descendants on the longest chain)
slack(c)        = latestStart(c) − today
Urgency(c)      = 1 − normalise( clamp( slack(c), 0, horizon ) )
                  combined with global CoverageDebt when the plan is behind
```

| Property                                              | Consequence                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| Concepts on long prerequisite chains have less slack  | The engine front-loads foundations without being told to        |
| Slack shrinks as the deadline approaches              | Urgency rises globally, automatically                           |
| Negative slack means already-late                     | Urgency saturates at 1.0 and feasibility is affected (§9)       |
| `CoverageDebt` lifts all urgency when behind schedule | The system responds to falling behind, not just to the calendar |

**Why this rather than `daysRemaining`:** slack encodes _structure_, not just _time_. Two concepts 300 days from an exam are not equally urgent if one gates a third of the syllabus.

### 6.4 F3 — Decay Risk

_How likely am I to lose this if I don't act?_

```
DecayRisk(c) = (1 − R(c)) · Established(c)

  Established(c) = min(1, reps(c) / reps_min)     ramps 0→1 over first few exposures
```

`R` comes directly from FSRS. The `Established` term prevents never-studied concepts (where `R` is undefined or zero) from registering as decay risk — a concept you have never learned cannot be forgotten. Without it, every unlearned concept would appear maximally at-risk and the engine would recommend "revision" of material never seen.

**DP8 is implemented here.** With `γ = 0.35` and Decay Risk saturating near 1.0 for overdue items, review reliably outranks new learning when retention is genuinely at risk — and recedes automatically once reviewed. The default is a consequence of the weights, not a special case in the code.

### 6.5 F4 — Readiness (the gate)

_Am I equipped to learn this yet?_

```
Readiness(c) = Π over prerequisites p of  min( 1, m_eff(p) / θ )^strength(p)     θ = 0.6
```

| Property                              | Consequence                                                                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Soft, not hard**                    | A learner at 80% of the threshold on a prerequisite is discouraged, not forbidden. Hard gates infuriate capable learners and mis-serve those with outside knowledge. |
| **Multiplicative**                    | Several weak prerequisites compound. This is correct: three shaky foundations are much worse than one.                                                               |
| **`strength`-weighted**               | `concept_edges.strength` distinguishes hard prerequisites from soft ones.                                                                                            |
| **Approaches zero, never reaches it** | A determined learner can always override and proceed; the engine records the override as evidence (DP7).                                                             |

**Readiness is also the diagnostic entry point.** When a learner performs badly on a concept with high readiness, the model was wrong about their foundations — which is precisely the signal D5 root-cause analysis needs (§10.6).

### 6.6 F5 — Cost

_What does this take?_

```
Cost(c) = remainingMinutes(c) · π_subject(c)
```

Divided as `Cost^δ` with `δ = 0.5`. The sub-linear exponent is deliberate:

- `δ = 0` → ignores time entirely; the engine recommends enormous tasks that never fit a real session.
- `δ = 1` → pure value-per-minute; the engine recommends only trivial tasks and never starts anything substantial.
- `δ = 0.5` → biases toward efficiency while keeping large, important work competitive.

Applying the learner's `π` here is what makes cost _personal_: a curriculum estimate of 40 minutes means 60 for a learner whose pace factor is 1.5, and the engine plans accordingly rather than repeatedly setting them up to fall behind.

### 6.7 Default configuration

```
α = 0.40   impact weight            θ = 0.60   readiness threshold
β = 0.25   urgency weight           φ = 0.35   retention floor
γ = 0.35   decay weight             K_base = 0.30, K_floor = 0.05
δ = 0.50   cost exponent            reps_min = 3
λ = 0.50   leverage coefficient     horizon = 90 days
```

These are **starting points, not truths.** They are versioned config (§17), tunable per cohort, and calibrated against observed adherence and mastery velocity monthly ([IMPLEMENTATION_ROADMAP §8](IMPLEMENTATION_ROADMAP.md#8-release-plan)). No weight is ever changed in production without a version bump and a recorded rationale.

---

## 7. Selection and Stability

_Adds a stage to [SYSTEM_ARCHITECTURE §6.3](SYSTEM_ARCHITECTURE.md#63-the-domain-core-packagescore)._ Scoring answers _what is most valuable_. Selection answers _what should we actually say_, accounting for the fact that a learner is a continuous human being and not a fresh query.

Modifiers are **bounded multiplicative adjustments** applied after scoring. They are bounded so they can never override a large genuine priority difference, and they are recorded separately in the trace so the underlying value ranking stays inspectable.

| ID     | Modifier        | Range     | Purpose                                                                                            |
| ------ | --------------- | --------- | -------------------------------------------------------------------------------------------------- |
| **M1** | Continuity      | ×1.0–1.25 | Favour finishing a topic in progress. Half-learned topics are worth less than either state.        |
| **M2** | Variety         | ×0.85–1.0 | Penalise a third consecutive task in the same subject. Interleaving improves retention.            |
| **M3** | Hysteresis      | ×1.0–1.15 | Favour the previously-recommended action, so trivial score changes do not flip the recommendation. |
| **M4** | Override memory | ×0.6–1.0  | Suppress what this learner has recently and repeatedly skipped (DP7).                              |
| **M5** | Energy fit      | ×0.9–1.1  | Match task type to time-of-day performance. **M2 tier** — inert until `ε` has data.                |
| **M6** | Freshness       | ×0.9–1.0  | Slight penalty for a concept seen very recently in the same day.                                   |

### 7.1 The stability rule

The recommendation changes only if:

```
score(new_best) > score(current) × (1 + hysteresis_margin)      margin = 0.15
```

**unless** an override condition fires:

| Override                                        | Reason                                          |
| ----------------------------------------------- | ----------------------------------------------- |
| The current recommendation was completed        | Nothing to be stable about                      |
| A concept crossed into overdue retention        | Retention debt is time-critical (DP8)           |
| Available time changed materially               | A 3-hour recommendation is wrong for 20 minutes |
| Feasibility verdict changed                     | The situation is materially different           |
| The learner explicitly asked for something else | DP7                                             |

**Why this matters more than it appears:** without hysteresis, small evidence updates cause the Next Action to flicker between near-equal candidates. Learners experience that as randomness, and randomness reads as _the system doesn't actually know_. Bet B1 in [PROJECT_VISION §10](PROJECT_VISION.md#10-bet-register) — that students will accept the system's judgement — dies on flicker.

### 7.2 Time-budget fitting

Selection is the stage that respects `availableMinutes` ([API_SPECIFICATION §5.5](API_SPECIFICATION.md#55-next-action--the-hot-path)):

```
1. Rank all eligible candidates by adjusted priority
2. Walk the ranking; select the highest-ranked task whose duration fits the window
3. If nothing fits: decompose the top candidate into a partial task
   (learn 1 of 3 sub-objectives; practise 5 questions instead of 15)
4. If the window is below the viable-session floor (default 8 min):
   offer a review-only micro-action, or honestly say the window is too short
```

Decomposition is preferred over substitution: giving the learner _part of the right thing_ beats giving them _all of a lesser thing_.

---

## 8. How Available Time Shapes Decisions

Available time is not a filter applied at the end — it changes what kind of work is appropriate.

| Window        | Preferred work                                           | Reasoning                                                        |
| ------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| **< 8 min**   | Nothing, or a single review item                         | Below the threshold where starting costs more than it returns    |
| **8–20 min**  | Review, flashcard-style retrieval, single practice items | Retrieval practice has low startup cost and high retention value |
| **20–45 min** | Focused practice, one learning objective                 | Enough for a coherent unit of work                               |
| **45–90 min** | New learning, multi-objective, problem sets              | Enough for genuine depth                                         |
| **> 90 min**  | Learning + immediate practice pairing, or an assessment  | Long enough to pair acquisition with consolidation               |

This is expressed as a **task-type affinity curve per window**, applied as an eligibility preference in stage 3 rather than a hard rule — a learner with 15 minutes and an urgent overdue concept should still get that concept.

---

## 9. Feasibility and Forecasting

Decision D4. Fully deterministic, hand-verifiable, and the most trust-critical arithmetic in the product ([IMPLEMENTATION_ROADMAP §7.3](IMPLEMENTATION_ROADMAP.md#73-the-tests-that-matter-most), test 2).

```
RequiredMinutes  = Σ_c [ remainingLearn(c) + remainingPractice(c) + projectedReviews(c) ] · π
AvailableMinutes = Σ_days capacity(d) · ρ
Slack            = AvailableMinutes − RequiredMinutes

verdict = on_track     if Slack ≥ 0.15 · Required
        = at_risk      if 0 ≤ Slack < 0.15 · Required
        = not_feasible if Slack < 0
```

### 9.1 The three things that make this honest

1. **`projectedReviews`** — future revision load is _forecast from FSRS_, not ignored. A plan that schedules only new learning is a plan that collapses in month three when review debt arrives unannounced.
2. **`ρ` applied to availability** — the forecast is made against the learner as observed, not as self-described at signup. This is why FRIDAY's projections should beat a static planner's, and it is the mechanism behind product goal G3.
3. **`π` applied to requirement** — a learner who takes 1.4× the estimate has 1.4× the requirement. Pretending otherwise produces a forecast that is wrong in a predictable direction.

### 9.2 Forecast output

```
projectedCompletionDate = earliest date where cumulative capacity ≥ RequiredMinutes
confidenceInterval      = derived from variance in ρ and π over recent history
```

The interval is reported, not hidden. A projection of "May 11 ± 9 days" is more useful and more honest than "May 11".

### 9.3 Scope triage (D8)

When `not_feasible`, the engine produces a **ranked cut list** — concepts ordered by ascending `Impact × Leverage`, so the lowest-value, least-blocking material is dropped first. Each option reports its arithmetic effect on the verdict ([API_SPECIFICATION §5.2](API_SPECIFICATION.md#52-goals)).

Three remediation levers, always presented together: extend the deadline, increase weekly hours, reduce scope. **The engine never chooses among them.** That is a decision about the learner's life, not their curriculum.

---

## 10. Replanning Logic

The plan is a living artifact. This section defines when it changes, by how much, and — critically — when it must _not_.

### 10.1 Trigger taxonomy

| Class          | Trigger                                         | Latency          | Default action                    |
| -------------- | ----------------------------------------------- | ---------------- | --------------------------------- |
| **Temporal**   | Nightly sweep (02:00 local)                     | Batch            | Full re-plan if material          |
| **Evidence**   | Mastery shifted beyond band; assessment result  | Async, < 5 min   | Drift check → conditional re-plan |
| **Structural** | Concepts excluded/added, `already_known` marked | Async            | Re-plan; feasibility recompute    |
| **Constraint** | Availability changed, block locked              | Async            | Re-plan                           |
| **Risk**       | Feasibility verdict crossed a boundary          | Immediate        | Re-plan + Directive               |
| **Explicit**   | User pressed "re-plan"; Coach action confirmed  | Sync (202 + job) | Always re-plan                    |
| **Deadline**   | Target date changed                             | Immediate        | Full regeneration                 |

### 10.2 The re-plan pipeline

```
snapshot state (mastery, memory, completed work, remaining scope, ρ, π)
   ↓
recompute RequiredMinutes and AvailableMinutes
   ↓
run scheduler → candidate Plan v(n+1)
     · materialise blocks + tasks for the 14-day WINDOW only
     · recompute the PROJECTION (concept → target week) for everything beyond it
     · compute STRUCTURAL factors once, store on tasks (§6.0)
   ↓
DIFF vs. v(n) → compute drift magnitude
   ↓
MATERIALITY GATE ──── immaterial ──▶ discard candidate, keep v(n), log the evaluation
   ↓ material
commit v(n+1) with reason + machine-readable diff
   ↓
verdict crossed into worse territory? ──▶ raise Directive with remediation options
   ↓
superseded versions older than 30 days ──▶ prune their materialised blocks + tasks
                                            (version row, projection, and diff are kept)
```

**A re-plan regenerates a 14-day window, not a 300-day schedule.** This is what makes nightly re-planning affordable at scale — both in compute (the scheduler places ~56 tasks, not ~1,200) and in storage ([DATABASE_DESIGN §4.3](DATABASE_DESIGN.md)). It also rolls the window forward daily, so the learner always has a fortnight of concrete plan ahead of them.

**The materiality gate is the most important part of this pipeline.** Without it, the engine rewrites the plan every night over noise, and the learner loses any sense of a stable schedule. Nightly re-planning that _usually changes nothing_ is the goal — the value is in absorbing real change silently, not in demonstrating activity.

### 10.3 Drift and materiality

```
drift = weighted combination of:
   · fraction of tasks whose scheduled date moves > 1 day
   · change in the set of concepts scheduled in the next 7 days
   · change in feasibility verdict or projected completion (> 3 days)
   · change in RequiredMinutes (> 5%)

material  if drift > 0.15  OR  verdict changed  OR  trigger is explicit
```

**Churn budget:** at most one user-visible plan change per 24 hours from automatic triggers, and at most three per week. Explicit user requests are never rate-limited. Exceeding the budget suppresses the change and logs it — plan churn is tracked as a defect metric ([PRODUCT_REQUIREMENTS §8](PRODUCT_REQUIREMENTS.md#8-success-metrics), counter-metrics).

### 10.4 Missed sessions — the debt model

Missed work is **not** shifted forward day by day. Cascading a missed Tuesday into every subsequent day is what makes conventional planners collapse: one bad week and the whole schedule is visibly, permanently wrong.

Instead:

```
Missed task → its concepts return to the candidate pool with their state intact
           → the scheduler re-derives placement from current priority
           → nothing is "behind"; the plan is simply regenerated from where things are
```

**Consequences of this design:**

- A missed low-priority task may never be rescheduled — correctly, because something more valuable displaced it.
- A missed high-priority task reappears immediately at the top.
- Missed _reviews_ re-enter with elevated Decay Risk, so they self-prioritise (DP8).
- The learner never sees a backlog. They see a current plan.

**Guilt handling** ([PROJECT_VISION §6](PROJECT_VISION.md#6-core-philosophy), principle 5):

| Pattern                      | Engine response                  | What the learner sees                  |
| ---------------------------- | -------------------------------- | -------------------------------------- |
| 1–2 missed days              | Silent absorption                | Nothing                                |
| Sustained under-completion   | `ρ` decreases → forecast adjusts | An honest change in the projected date |
| Extended absence (> 14 days) | Return-flow (§15, E-9)           | "Welcome back — here's where you are"  |

Note the mechanism: missing sessions changes **the forecast**, not the tone. The bad news is arithmetic, not judgement.

### 10.5 Goal changes

| Change                 | Preserved                                     | Regenerated            | Notes                                                                                        |
| ---------------------- | --------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------- |
| Deadline moved later   | Everything                                    | Plan                   | Feasibility improves; may relax scope cuts                                                   |
| Deadline moved earlier | Everything                                    | Plan                   | May trigger `not_feasible` + triage (§9.3)                                                   |
| Weekly hours changed   | Everything                                    | Plan                   | Re-derives availability                                                                      |
| Concepts excluded      | Mastery, memory, facts                        | Plan, feasibility      | Excluded concepts retain state in case of reversal                                           |
| Concepts added         | Everything                                    | Curriculum edges, plan | New concepts require prerequisite linking                                                    |
| Marked `already_known` | Memory state seeded optimistically at low `κ` | Plan                   | **Low confidence is deliberate** — self-report is weak evidence and must be verifiable later |
| Goal switched entirely | **Mastery, memory states, learner facts**     | Curriculum, plan       | Concept-level knowledge is portable across goals via `concept_key`                           |

**The last row is the compounding asset** ([PROJECT_VISION §5.3](PROJECT_VISION.md#53-learning-memory)). A learner who switches from JEE to a physics degree keeps everything FRIDAY learned about them. Nothing about their knowledge was ever goal-specific.

### 10.6 Performance deviation

The engine continuously compares predicted against actual mastery gain per minute. Deviation is diagnostic:

| Observation                            | Likely cause                                          | Engine response                                                                              |
| -------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Faster than expected**, consistently | Estimates too high, or prior knowledge underestimated | `π` decreases → plan densifies; feasibility improves; consider raising assessment difficulty |
| **Slower than expected**, one concept  | Concept genuinely harder, or a prerequisite is weak   | Trigger D5 root-cause; check readiness inputs                                                |
| **Slower than expected**, broadly      | Estimates too low, or availability is optimistic      | `π` increases → plan relaxes; forecast adjusts honestly                                      |
| **High variance**                      | Inconsistent conditions or unreliable self-rating     | Lower `κ`; prefer objective evidence (§11.4)                                                 |
| **Mastery gain with poor retention**   | Learning without consolidation                        | Shift the learn/practice/revise mix toward retrieval                                         |

**Root-cause traversal (D5):** when a concept underperforms despite high readiness, the engine walks the prerequisite graph backward, ranking ancestors by `(1 − m_eff) × edge strength × depth decay`, and reports the most probable broken foundation. The traversal is deterministic; the _explanation_ of it is AI-authored from the resulting chain (bounded depth 6, per [DATABASE_DESIGN §10](DATABASE_DESIGN.md#10-future-scalability)).

---

## 11. Confidence Scoring

Every recommendation carries a confidence score. This is not decoration — it changes engine behaviour.

### 11.1 Inputs

```
Confidence = weighted combination of:
   C1  Belief confidence  — κ of the concepts involved, weighted by involvement
   C2  Margin             — normalised gap between the top candidate and the runner-up
   C3  Data sufficiency   — evidence volume, session count, days of history
   C4  Stability          — has this recommendation persisted across recent recomputes?
   C5  Constraint health  — were eligibility rules relaxed or the time budget forced?
```

| Input  | Low value means                                                         |
| ------ | ----------------------------------------------------------------------- |
| **C1** | We don't really know what they know                                     |
| **C2** | Several options are near-equal; the choice is close to arbitrary        |
| **C3** | Cold start — we're mostly using priors                                  |
| **C4** | The ranking is volatile; the state is changing faster than we can model |
| **C5** | We had to compromise to produce an answer at all                        |

**C2 is the subtle one.** High confidence in a _decision_ requires not just knowing the learner, but the top option being _clearly_ better. Two near-tied candidates mean the recommendation is low-confidence even when belief confidence is perfect — and the honest response is to say "either of these works" rather than to fabricate a distinction.

### 11.2 Bands and behaviour

| Band            | Score     | Engine behaviour                                | Learner-facing posture                                              |
| --------------- | --------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| **High**        | ≥ 0.75    | Commit. Single recommendation.                  | Directive: _"Start here."_                                          |
| **Moderate**    | 0.50–0.75 | Commit, surface alternates more readily.        | Suggestive: _"I'd start here — two other good options."_            |
| **Low**         | 0.30–0.50 | **Prefer information-gaining actions** (§11.4). | Transparent: _"I'm not certain yet — this will help me calibrate."_ |
| **Exploratory** | < 0.30    | Diagnostic mode. Ask, don't assert.             | Honest: _"I don't know you well enough yet. Let's find out."_       |

### 11.3 Confidence is never hidden

A low-confidence recommendation is still shown. Suppressing it would leave the learner with nothing, which is worse than an honestly-hedged suggestion. Per DP6, uncertainty is communicated, not concealed.

### 11.4 Explore vs. exploit

The most important consequence of confidence scoring: **at low confidence, the optimal action changes category.**

When the engine does not know what a learner knows, the highest-value action is usually not the highest-priority _learning_ task — it is the task that most reduces uncertainty. Concretely, low confidence biases selection toward:

- A short diagnostic across several uncertain concepts rather than deep work on one
- Retrieval practice (which produces strong evidence) over passive learning (which produces weak evidence)
- Concepts with **high `Impact` and low `κ`** — where being wrong costs the most

This is information gain as a first-class objective, and it is what makes FRIDAY's cold start converge in days rather than weeks. It is also decision **D7** (what to test) falling out of the same machinery, rather than needing a separate system.

---

## 12. Explainability

Every recommendation answers _"why this?"_ at three depths. Per DP3, all three are projections of the same computed factors.

### 12.1 Three layers

| Layer                     | Audience                         | Content                                                      | Source                         |
| ------------------------- | -------------------------------- | ------------------------------------------------------------ | ------------------------------ |
| **L1 — Headline**         | Every learner, always visible    | One sentence naming the dominant factor                      | Template or constrained LLM    |
| **L2 — Factor breakdown** | Curious learner, one click       | Each factor's value, contribution, and plain-language detail | Direct projection of the score |
| **L3 — Full trace**       | Support, engineering, evaluation | Complete decision record                                     | `decision_traces` (§13)        |

L2 is exactly the `why` block in the [Next Action response](API_SPECIFICATION.md#55-next-action--the-hot-path) — `factors`, `contribution`, `dominantFactor`. The API contract and this document describe the same object.

### 12.2 The generation rule

```
factor values  →  structured explanation object  →  language
     (computed)          (deterministic)             (template, or LLM constrained to the object)
```

**The LLM is never given the recommendation and asked to justify it.** It is given the factor table and asked to phrase it. This distinction is the entire difference between explanation and rationalisation.

**On the Next Action path, the rationale is a deterministic template — always, not as a fallback.** The template is selected by dominant factor from the vocabulary in §12.3 and filled from the live factor table at request time. It costs nothing, adds no latency, requires no LLM, and is **faithful by construction** because it is rendered from the same numbers that produced the decision.

> **Rationale is never pre-generated for the Next Action.** An earlier design stored LLM-written prose in `tasks.rationale` at plan time. That is unsound: volatile factors (§6.0) are recomputed at request time, so stored prose can name a factor that no longer dominates — violating invariant **I-11** and traceability guarantee **T3**, the two properties the entire explainability story rests on. Per DP3, a plausible reason that does not match the arithmetic is the highest-severity class of bug in this product. The column does not exist.

**LLM-authored prose is reserved for surfaces where the context is fixed at generation time** — the daily brief, the weekly review, insight bodies, and Coach conversation. There, the factors do not move between generation and reading, so faithfulness is preserved. Those remain governed by the faithfulness eval ([SYSTEM_ARCHITECTURE §5.8](SYSTEM_ARCHITECTURE.md#58-evaluation), ≥95%): naming a factor that did not dominate is a test failure.

### 12.3 Explanation vocabulary

Each dominant factor maps to a family of phrasings, so explanations are varied but never invented:

| Dominant            | Explains as                                                                        |
| ------------------- | ---------------------------------------------------------------------------------- |
| `decayRisk`         | _"You're about to lose this — you rated it hard three days ago and it's due now."_ |
| `urgency`           | _"This gates four later topics and you're running out of room to fit them."_       |
| `impact`            | _"High exam weight, and you're at 40% — this is the biggest gap that matters."_    |
| `readiness` blocked | _"Doing X first will make this much easier — you're at 45% on it."_                |
| `cost`              | _"It fits your 20 minutes, and it's the most valuable thing that does."_           |

### 12.4 Explaining change

When a recommendation changes, the learner is told **what changed**, not just what is now recommended:

> _"This moved to the top because your session yesterday showed angular momentum is weaker than I thought."_

Change explanations are diffs of factor values between two traces — which is only possible because traces exist. This is a concrete reason §13 pays for itself.

---

## 13. Decision Traceability

Per DP10: no decision reaches a learner without a durable record.

### 13.1 Schema — **addendum to [DATABASE_DESIGN.md](DATABASE_DESIGN.md)**

```sql
CREATE TYPE decision_type AS ENUM
  ('next_action','plan_generation','revision_schedule','feasibility',
   'diagnosis','directive','assessment_selection','scope_triage');

CREATE TABLE decision_traces (
  id                  uuid PRIMARY KEY,             -- UUIDv7, app-generated (DATABASE_DESIGN D1)
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id             uuid REFERENCES goals(id) ON DELETE CASCADE,
  type                decision_type NOT NULL,

  -- reproducibility
  engine_version      text NOT NULL,          -- semantic; see §17
  config_version      text NOT NULL,          -- weight set identifier
  input_snapshot_hash text NOT NULL,          -- hash of the exact state read in stage 1
  input_snapshot      jsonb,                  -- retained for recent traces only

  -- the decision
  candidates          jsonb NOT NULL,         -- top N with per-factor values + contributions
  excluded            jsonb,                  -- filtered candidates WITH reason codes
  selected_entity_id  uuid,
  selected_score      numeric(10,4),
  modifiers_applied   jsonb,                  -- selection-stage adjustments (§7)
  constraints_relaxed text[],                 -- what we compromised, if anything

  -- confidence + explanation
  confidence          numeric(4,3) NOT NULL,
  confidence_inputs   jsonb NOT NULL,         -- C1..C5 individually
  dominant_factor     text,
  explanation         jsonb,                  -- the structured object, pre-language

  -- operational
  computed_at         timestamptz NOT NULL DEFAULT now(),
  latency_ms          int,
  cache_hit           boolean NOT NULL DEFAULT false,
  request_id          text,
  superseded_by       uuid REFERENCES decision_traces(id)
) PARTITION BY RANGE (computed_at);

CREATE INDEX idx_traces_user_type_time ON decision_traces (user_id, type, computed_at DESC);
CREATE INDEX idx_traces_request        ON decision_traces (request_id);
```

Retention: **90 days full** (including `input_snapshot`), then snapshots dropped and the remainder aggregated. Monthly partitioning, consistent with [DATABASE_DESIGN §7](DATABASE_DESIGN.md#7-partitioning--retention).

### 13.2 What a trace must guarantee

| ID                    | Invariant                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1 — Determinism**  | Replaying a trace's inputs through the same `engine_version` + `config_version` reproduces the identical output. Tested in CI.                                  |
| **T2 — Completeness** | Every learner-visible decision has a trace. No trace, no decision — enforced by the service layer, not by convention.                                           |
| **T3 — Faithfulness** | The `explanation` object is derivable from `candidates[selected].factors`. Divergence is a P0 defect.                                                           |
| **T4 — Causality**    | `request_id` links the trace to the API request, the `learning_events` row, the `ai_calls` row, and the distributed trace. One id reconstructs the whole chain. |

### 13.3 What traces are used for

1. **Support** — _"why did FRIDAY tell me to do that?"_ is answerable exactly, months later.
2. **Debugging** — a bad recommendation is reproducible from stored inputs rather than guessed at.
3. **Evaluation** — recommendation quality is measured against subsequent outcomes.
4. **Counterfactual replay (§18.7)** — historical decisions re-scored under a new configuration, to estimate impact _before_ shipping it. This is the highest-leverage use and the main reason `candidates` stores the full scored set rather than just the winner.
5. **Learner transparency** — L3 explainability, should we choose to expose it.

### 13.4 Privacy

Traces contain learning state, not content. `input_snapshot` is bounded, redacted of free text, and covered by export (FR-12.1) and deletion (FR-12.2). Trace retention never outlives the account.

---

## 14. Event-Driven Decision Flow

How a single action propagates through the entire system. This section defines the contract between what happens synchronously (inside the user's request) and what happens asynchronously (after it).

### 14.1 The propagation model

```
                        ┌─────────────────────┐
   learner action ─────▶│  SERVICE (in tx)    │  synchronous, must be correct
                        │  · validate         │  before the response returns
                        │  · core computation │
                        │  · persist state    │
                        │  · append events    │
                        └──────────┬──────────┘
                                   │ COMMIT
                                   ▼
                        ┌─────────────────────┐
                        │  CACHE INVALIDATION │  immediate, post-commit
                        └──────────┬──────────┘
                                   ▼
                        ┌─────────────────────┐
                        │  EVENT EMISSION     │  after commit, never inside it
                        └──────────┬──────────┘
                                   ▼
        ┌──────────────┬───────────┼───────────┬──────────────┐
        ▼              ▼           ▼           ▼              ▼
    reflection    drift check   insights   directives    embeddings
     (memory)     (planning)  (intelligence) (proactivity)  (memory)
```

**The synchronous/asynchronous line is drawn at one question: _must the learner see this reflected immediately?_** Mastery and due dates must (FR-5.3) — they are the visible proof that studying changed something. Reflection, insight generation, and nudge evaluation must not: they are slow, AI-dependent, and failure-tolerant.

### 14.2 Event → effect matrix

| Event                            | Synchronous (in transaction)                                               | Invalidates                                | Asynchronous consumers                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `session.completed`              | Mastery update · FSRS advance · task complete · evidence + learning events | `next-action`, `today-plan`, `progress`    | Reflector → Learner Facts · drift check · intelligence sweep · embedding                                       |
| `session.abandoned`              | Session closed, no evidence                                                | `next-action`                              | Diagnosis check (repeated abandonment on one concept is a strong signal)                                       |
| `assessment.graded`              | Per-concept mastery · FSRS advance · attempt scored                        | `next-action`, `progress`, `weak-concepts` | Diagnostician → insights · root-cause check · question calibration · **re-plan if mastery shifted materially** |
| `concept.status_changed`         | Concept status · scope recompute                                           | `plan`, `feasibility`                      | Re-plan job                                                                                                    |
| `availability.changed`           | Availability rules                                                         | `plan`, `feasibility`                      | Re-plan job                                                                                                    |
| `goal.deadline_changed`          | Goal row                                                                   | everything for that goal                   | Immediate re-plan · feasibility → possible Directive                                                           |
| `plan.generated`                 | New plan version, window blocks + tasks, structural factors, projection    | `plan`, `next-action`, `schedule`          | Diff notification if material · prune superseded versions past 30 days                                         |
| `next_action.skipped`            | Skip + reason recorded                                                     | `next-action`                              | Override-memory update (M4) · pattern detection                                                                |
| `curriculum.generated`           | Tree + edges + validation                                                  | `curriculum`                               | Plan generation                                                                                                |
| `directive.acted` / `.dismissed` | Directive outcome                                                          | —                                          | Relevance threshold update                                                                                     |

### 14.3 Ordering and idempotency

| Property              | Rule                                                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ordering**          | Events for one learner are processed in emission order per aggregate. Cross-aggregate ordering is not guaranteed and no consumer may depend on it.                                          |
| **Idempotency**       | Every consumer is idempotent, keyed on the event id. At-least-once delivery is assumed (NFR-2.3).                                                                                           |
| **Failure isolation** | A failed async consumer never affects the synchronous write. Reflection failing silently is acceptable; mastery failing to update is not.                                                   |
| **Recomputation**     | Any derived state can be rebuilt from `learning_events` + `evidence_events`. This is the payoff for the append-only log ([DATABASE_DESIGN §1](DATABASE_DESIGN.md#1-design-principles), D3). |

### 14.4 Cache invalidation

The Next Action cache (`next-action:{userId}:{goalId}:{minutesBucket}`, TTL 5 min) is invalidated by: session completion or abandonment, assessment grading, plan generation, task status change, concept status change, availability change, and skip.

**Invalidation is post-commit and best-effort.** A missed invalidation costs at most 5 minutes of staleness; blocking a write on cache availability would violate the fail-open rule ([SYSTEM_ARCHITECTURE §10](SYSTEM_ARCHITECTURE.md#10-system-interactions)). Every cached response reports `cacheHit` so staleness is observable rather than invisible.

### 14.5 The feedback loops

Three loops of increasing latency. Together they are what makes FRIDAY adaptive rather than merely scheduled.

| Loop             | Latency    | Path                                                                                |
| ---------------- | ---------- | ----------------------------------------------------------------------------------- |
| **Immediate**    | seconds    | evidence → mastery + retention → priority → next recommendation                     |
| **Daily**        | hours      | accumulated evidence → drift → re-plan → feasibility → directive                    |
| **Longitudinal** | days–weeks | outcomes → `ρ`, `π`, override patterns, learner facts → better priors and forecasts |

---

## 15. Edge Cases and Failure Modes

Each case names the detection signal, the behaviour, and the principle it upholds. Anything not on this list that appears in production gets added here before it gets fixed in code.

### 15.1 Cold start and sparse data

| ID      | Case                                             | Behaviour                                                                                                                                                                                               |
| ------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E-1** | **Brand-new learner, zero evidence**             | Mastery seeded from self-reported level at very low `κ`. `ρ = π = 1.0` until minimum sample. Confidence band = Exploratory → diagnostic-first (§11.4). Never present a confident plan built on nothing. |
| **E-2** | **Self-reported level contradicted by evidence** | Evidence wins immediately — priors are weak by construction. Large contradiction triggers a re-plan and a Learner Fact.                                                                                 |
| **E-3** | **`already_known` marked at scale**              | Accepted, seeded at low `κ`, and **verified opportunistically** via low-cost retrieval checks. Unverified claims decay in confidence rather than being trusted indefinitely.                            |
| **E-4** | **Curriculum with no prerequisite edges**        | Readiness ≡ 1.0 for all; the engine degrades to impact+urgency+decay ordering. Functional, less clever. Log for content review (DP9).                                                                   |

### 15.2 Structural and constraint failures

| ID       | Case                                                  | Behaviour                                                                                                                                                                                                                                           |
| -------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E-5**  | **Prerequisite cycle detected at runtime**            | Scheduler must terminate regardless. Break the cycle at the weakest edge, proceed, and raise an integrity alert. **Never fail the learner's request over a content defect.**                                                                        |
| **E-6**  | **Zero availability declared**                        | Cannot plan. Return `NO_AVAILABILITY_DEFINED`, route to the availability screen. Do not invent capacity.                                                                                                                                            |
| **E-7**  | **Deadline already past**                             | Goal moves to a terminal state; offer extension or archive. Never compute a negative-slack plan and present it as real.                                                                                                                             |
| **E-8**  | **Impossible from day one** (deadline needs 14 h/day) | `not_feasible` immediately at onboarding, with triage options _before_ the learner invests. Delivering this on day 40 instead of day 1 is a product failure.                                                                                        |
| **E-9**  | **Return after long absence**                         | No backlog, no guilt. Recompute retention (much will be overdue), re-plan from current state, present a "here's where you are" summary. `ρ` reflects the gap; the forecast changes; the tone does not.                                              |
| **E-10** | **All concepts mastered before the deadline**         | Switch to maintenance mode: retention-only scheduling, optional depth extension, suggest goal advancement. Return `204` from next-action if genuinely nothing is due ([API_SPECIFICATION §5.5](API_SPECIFICATION.md#55-next-action--the-hot-path)). |

### 15.3 Evidence quality

| ID       | Case                                                     | Behaviour                                                                                                                                                                                                             |
| -------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E-11** | **Inflated self-ratings** (always `easy`)                | Detected as divergence between self-rating and objective outcomes. `w_source` for that learner's self-ratings is down-weighted; objective evidence is preferentially scheduled. Never accuse — just weight correctly. |
| **E-12** | **Contradictory evidence** (alternating success/failure) | `κ` falls (consistency input). Confidence drops. Engine prefers more evidence over stronger claims. May indicate a fragile foundation → D5.                                                                           |
| **E-13** | **Everything overdue at once**                           | Do not schedule 40 reviews. Rank by `Impact × DecayRisk`, schedule what fits, let the rest lapse _deliberately_. Report honestly: _"You have 40 due; here are the 8 that matter most."_ Triage beats collapse.        |
| **E-14** | **Gaming** (rapid completion, no real work)              | Detect implausible time-on-task vs. content volume. Do not block; reduce `w_source` for those events and lower `κ`. FRIDAY is not a proctor ([PRODUCT_REQUIREMENTS §5](PRODUCT_REQUIREMENTS.md#5-out-of-scope)).      |
| **E-15** | **Assessment grading failure**                           | Ungraded responses produce no evidence. Never guess an outcome — a fabricated grade corrupts mastery permanently.                                                                                                     |

### 15.4 Operational

| ID       | Case                                     | Behaviour                                                                                                                                                                                |
| -------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E-16** | **AI provider unavailable**              | D1–D4 and D7–D8 are unaffected — all deterministic. Rationale falls back to templates. Coach and generation return `AI_UNAVAILABLE`. **The core loop keeps working** (NFR-2.2).          |
| **E-17** | **Stale cache after config change**      | Config version is part of the cache key. A config change invalidates by construction, not by remembering to.                                                                             |
| **E-18** | **Config changed mid-flight**            | A decision uses one config version, captured at stage 1 and recorded in the trace. No decision ever straddles two versions.                                                              |
| **E-19** | **Concurrent sessions on two devices**   | One active session per learner. The second start returns `SESSION_ALREADY_ACTIVE` with the existing session.                                                                             |
| **E-20** | **Clock skew / timezone travel**         | All state in UTC; local time derived from `users.timezone` at read. A timezone change shifts the _presentation_ of the plan, never its content. Nightly jobs fan out by timezone bucket. |
| **E-21** | **Scheduler exceeds its time budget**    | Hard iteration cap. On breach, emit the best plan found so far, flag it as degraded, and alert. A late plan is worse than a slightly suboptimal one.                                     |
| **E-22** | **Learner rejects every recommendation** | After N consecutive skips, stop recommending and **ask**. The model is wrong; more inference on wrong assumptions makes it worse (DP7).                                                  |

### 15.5 Boundary conditions

| ID       | Case                                      | Behaviour                                                                                                                                                                                                                      |
| -------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **E-23** | **Window shorter than any task**          | Offer a micro-review or say honestly that the window is too short. Do not pad.                                                                                                                                                 |
| **E-24** | **Single-concept goal**                   | Priority ranking is trivial; the value shifts entirely to retention scheduling and feasibility. Still coherent.                                                                                                                |
| **E-25** | **Exam tomorrow**                         | Urgency saturates. Switch to a distinct **cram policy**: highest exam-weight × lowest-cost, review over new learning, no long-horizon optimisation. This is a deliberate, named policy — not the general engine at an extreme. |
| **E-26** | **Enormous curriculum** (5,000+ concepts) | Candidate generation restricted to a bounded frontier (ready concepts + due reviews + near-term scheduled), not the full set. Priority is computed over hundreds, not thousands.                                               |

---

## 16. Invariants

Testable properties. These belong in `packages/core` unit and property tests and gate every release ([IMPLEMENTATION_ROADMAP §7.3](IMPLEMENTATION_ROADMAP.md#73-the-tests-that-matter-most)).

| ID       | Invariant                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------- |
| **I-1**  | Mastery ∈ [0,1] always. Correct evidence never decreases it; incorrect evidence never increases it. |
| **I-2**  | Effective mastery ≤ raw mastery, and ≥ `φ × ` raw mastery.                                          |
| **I-3**  | Repeated successful review monotonically increases the FSRS interval.                               |
| **I-4**  | The scheduler never places a concept before a prerequisite whose readiness is below the hard floor. |
| **I-5**  | The scheduler never exceeds declared daily capacity or schedules into blocked time.                 |
| **I-6**  | The scheduler always terminates, including on cyclic or malformed graphs.                           |
| **I-7**  | Feasibility arithmetic is reproducible by hand from the reported inputs.                            |
| **I-8**  | `α + β + γ = 1.0` at config load, or the config is rejected.                                        |
| **I-9**  | Identical state + identical config ⇒ identical decision (T1).                                       |
| **I-10** | Every learner-visible decision has a trace (T2).                                                    |
| **I-11** | The stated dominant factor is the largest contributor in the trace (T3).                            |
| **I-12** | Confidence is emitted for every decision, including high-confidence ones.                           |
| **I-13** | No decision path calls a language model to obtain a number.                                         |
| **I-14** | Next Action p95 < 300 ms with zero LLM calls (NFR-1.7).                                             |
| **I-15** | Every excluded candidate carries a machine-readable exclusion reason.                               |
| **I-16** | Derived state is fully reconstructible from the event log.                                          |

---

## 17. Configuration and Versioning

### 17.1 Two independent versions

| Version              | Changes when                      | Example                                     |
| -------------------- | --------------------------------- | ------------------------------------------- |
| **`engine_version`** | The algorithm changes             | Adding a factor; swapping the mastery model |
| **`config_version`** | Only weights or thresholds change | `α` 0.40 → 0.45                             |

Semantics for `engine_version`: **MAJOR** — decisions change for existing learners (requires migration plan and comms). **MINOR** — new factor or capability, backward-compatible defaults. **PATCH** — bug fix that does not intentionally change outputs.

### 17.2 Rules

1. **No silent weight changes in production.** Every change is a new `config_version` with a recorded rationale.
2. **Config is captured per decision** and stored in the trace (E-18).
3. **Cohort assignment is sticky** — a learner's config does not change mid-goal without an explicit migration, because a plan that changes because _we_ changed is indistinguishable to the learner from a plan that changes because _they_ changed.
4. **Per-user overrides exist** (`user_preferences.planner_config`) for support intervention and accessibility, and are always visible in the trace.
5. **A/B tests are config versions**, evaluated on adherence, acceptance rate, and mastery velocity — never on engagement alone.

---

## 18. Extensibility

The engine must absorb substantially more intelligence without redesign. Each extension point below is a seam that already exists in the design, not a future refactor.

### 18.1 Factor registry (adding a factor)

Factors implement a common contract: `{ id, compute(state, concept) → [0,1], weight, explain(value) → string }`. Adding one means registering it and adding a weight — **the priority function itself does not change**. Weight normalisation is enforced at load, so a new factor is impossible to add without consciously rebalancing.

_Planned:_ cognitive load, learner interest, resource availability, collaborative signals (what similar learners found hard).

### 18.2 Swappable mastery model

`MasteryModel { update(state, evidence) → state; estimate(state, t) → [0,1] }`. Today: adaptive-K ELO. Next: BKT. Then: IRT with calibrated item parameters (`questions.irt_difficulty` and `irt_discrimination` already exist in the schema for exactly this). Nothing outside the model reads its internals.

### 18.3 Swappable retention model

`RetentionModel { review(state, rating, t) → state; retrievability(state, t) → [0,1] }`. Today FSRS-5; FSRS-6 or a learned per-learner model later. Because `R` is computed rather than stored, changing the model changes nothing downstream.

### 18.4 Swappable scheduler

`Scheduler { generate(state, constraints) → Plan }`. Today: greedy with local repair. Candidates later: constraint solver for hard-constrained learners; RL policy trained on trace data. The interface is the reason the greedy version is not a dead end.

### 18.5 New decision types

The catalog (§3) is designed to grow. Adding _"which resource should I use?"_ or _"should I rest?"_ means a new decision type flowing through the same seven-stage pipeline, with the same trace schema and confidence contract. No new infrastructure.

### 18.6 Multi-goal arbitration (M3)

The intended extension: compute priority **within** each goal as today, then allocate capacity **across** goals by a meta-priority (deadline proximity × goal weight × marginal value of the next hour). Per-goal priority scores are already normalised to a comparable scale precisely so this is possible without rescoring. `goals.is_primary` is the placeholder.

### 18.7 Counterfactual replay

Because traces store the **full scored candidate set** (not just the winner) plus the exact input snapshot, historical decisions can be re-scored under a proposed configuration offline. This yields an estimate of _"what would have changed, and for whom"_ before anything ships to a learner.

This is the payoff for the trace schema in §13 and the strongest long-term reason to keep decisions deterministic. A system whose decisions cannot be replayed can only be improved by experimenting on its users.

### 18.8 What must not be extended

| Do not                                         | Because                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| Let a model produce a decision number          | DP1. The moment this erodes, nothing else in this document holds.   |
| Add unbounded selection modifiers              | §7. Modifiers adjust; they must never override value ranking.       |
| Add a decision that skips tracing              | DP10 / I-10.                                                        |
| Introduce hidden state between decisions       | DP2. Determinism and replay both die.                               |
| Generate an explanation independent of factors | DP3. That is rationalisation, and it is how trust is lost silently. |

---

## 19. Open Questions

| #      | Question                                                                           | Resolve by               | Blocks                    |
| ------ | ---------------------------------------------------------------------------------- | ------------------------ | ------------------------- |
| **Q1** | Initial values for `α, β, γ, δ, λ, θ, φ` — expert-set or calibrated on pilot data? | Phase 1                  | Nothing (defaults given)  |
| **Q2** | Is `φ = 0.35` right? Needs empirical validation of relearning speed.               | Phase 3                  | Revision volume tuning    |
| **Q3** | Should learners see confidence explicitly, or only its effects?                    | Phase 2 UX               | Explainability UI         |
| **Q4** | Drift threshold of 0.15 — is it too eager or too sticky?                           | Phase 3, from churn data | Re-plan cadence           |
| **Q5** | Do we let learners tune their own weights ("more revision"), or keep it opaque?    | Phase 4                  | Preference surface        |
| **Q6** | Cram-mode (E-25) activation threshold — days out, or feasibility-driven?           | Phase 3                  | Exam-adjacent behaviour   |
| **Q7** | Minimum evidence before `ρ` and `π` depart from 1.0?                               | Phase 3                  | Forecast honesty early on |

---

## 20. Document Map

| Document                                               | Answers                   |
| ------------------------------------------------------ | ------------------------- |
| [PROJECT_VISION.md](PROJECT_VISION.md)                 | Why FRIDAY exists         |
| [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md)     | What it does              |
| [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md)       | How it is built           |
| [DATABASE_DESIGN.md](DATABASE_DESIGN.md)               | How state is stored       |
| [API_SPECIFICATION.md](API_SPECIFICATION.md)           | How clients talk to it    |
| [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md) | In what order it is built |
| **AI_DECISION_ENGINE.md**                              | **How it thinks**         |
