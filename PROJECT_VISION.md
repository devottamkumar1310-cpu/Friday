# FRIDAY — Project Vision

> **Status:** Pre-Production · Source of Truth
> **Version:** 1.0 · Blueprint v1.3
> **Last updated:** Week 0 (pre-kickoff)

---

## 1. Mission

**Remove the cognitive overhead of managing learning, so that all of a student's mental energy goes into actually learning.**

FRIDAY exists to answer, continuously and correctly, the single question every serious learner asks a dozen times a week:

> _"What is the highest-impact thing I should do right now?"_

---

## 2. Vision

**FRIDAY becomes the operating system that every ambitious learner runs their academic life on.**

Ten years out, a student does not open five apps to study. They open FRIDAY. It knows their goal, their syllabus, their calendar, their memory decay curve, their weak concepts, their energy patterns, and their deadline. It plans, re-plans, tests, remembers, warns, and adapts — and it earns enough trust that when it says _"do this next,"_ the student simply does it.

The end-state is not a tool students _use_. It is an intelligence students _delegate to_.

---

## 3. Problem Statement

**Information scarcity is solved. Learning management is not.**

A student in 2026 has more high-quality learning material than any student in history: ChatGPT, Claude, Gemini, YouTube, MOOCs, coaching platforms, PDFs, flashcard decks, mock test banks. Access is no longer the bottleneck.

The bottleneck has moved. It is now **executive function** — the meta-work of deciding _what_ to learn, _when_, _in what order_, _how much_, and _whether it is working_. This work is:

- **Continuous** — the right answer changes every single day.
- **High-stakes** — a wrong prioritisation compounds over months.
- **Cognitively expensive** — it consumes the exact same mental resource studying requires.
- **Poorly done by humans** — students systematically over-study what they enjoy and under-study what they fear, mistake familiarity for mastery, and cannot feel their own forgetting curve.

Every existing tool hands this burden back to the student. A planner asks you to fill it in. A flashcard app asks you which deck. An AI tutor waits for your question. **The student is still the orchestrator, and orchestration is the hardest job.**

---

## 4. Pain Points

| #   | Pain                                 | Why existing tools fail                                                                                                                      |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | **"What should I study today?"**     | Planners are empty containers. They require the student to already know the answer.                                                          |
| P2  | **"Am I behind?"**                   | No tool models required-work vs. available-time. Progress bars measure activity, not sufficiency.                                            |
| P3  | **"What should I revise?"**          | Spaced repetition exists, but is siloed in flashcard apps and disconnected from the syllabus, the plan, and test performance.                |
| P4  | **"Which topic deserves priority?"** | Requires jointly modelling exam weight, current mastery, prerequisite structure, forgetting risk, and time cost. No consumer tool does this. |
| P5  | **"Am I actually improving?"**       | Students confuse hours logged and pages read with learning. Real signal requires longitudinal, per-concept measurement.                      |
| P6  | **"Will I finish in time?"**         | Nobody does the arithmetic. Students discover they are short by three weeks — three weeks too late.                                          |
| P7  | **Plan collapse**                    | A plan made on day 1 is wrong by day 5. Static plans generate guilt, then abandonment.                                                       |
| P8  | **Context amnesia**                  | Every AI conversation starts from zero. The student re-explains their goal, level, and history every single time.                            |
| P9  | **Tool sprawl**                      | Notes here, flashcards there, tests elsewhere, plan in a notebook. No system sees the whole picture, so no system can reason about it.       |
| P10 | **Motivation decay**                 | Progress is invisible in the short term. Without felt progress, consistency collapses.                                                       |

**Synthesis:** P1–P6 are _decision_ problems. P7–P9 are _state_ problems. P10 is a _feedback_ problem. All three classes are solved by the same thing: a persistent, continuously-updated model of the learner that something intelligent reasons over.

---

## 5. The Solution

FRIDAY is an **AI Learning Operating System** — a persistent intelligence layer that owns the learner's academic state and drives it toward a goal.

It is composed of five systems that are deliberately **not** independent features. They are one loop:

```
        ┌──────────────────────────────────────────────────────┐
        │                                                      │
        ▼                                                      │
  ADAPTIVE PLANNER ──▶ MISSION CONTROL ──▶ student executes ───┤
   (decides what)        (surfaces it)                         │
        ▲                                                      │
        │                                                      ▼
  PERFORMANCE  ◀────── LEARNING MEMORY ◀────── evidence events
  INTELLIGENCE          (remembers it)          (what happened)
   (interprets it)              │
        │                       ▼
        └──────────────▶ AI LEARNING COACH
                          (explains + motivates + intervenes)
```

### 5.1 Adaptive AI Planner

Generates and **continuously re-generates** a schedule from goal, syllabus, deadline, and real availability. It does not produce a static plan; it produces a _living_ one that absorbs missed days, new weaknesses, and changing capacity without guilt or manual rework. It always knows whether the goal is still reachable, and says so honestly.

### 5.2 AI Learning Coach

A conversational surface with full context — it already knows the goal, the plan, the last test, the weak concepts, and last week's excuse. It explains concepts, runs Socratic checks, diagnoses confusion, and intervenes when patterns go bad. It is proactive: it opens conversations, not just answers them.

### 5.3 Learning Memory

The substrate everything else reads from. Four tiers: what you're studying (knowledge graph), what happened (episodic log), what you know and how well it will survive (mastery + retention state), and who you are as a learner (distilled profile). This is FRIDAY's compounding asset — it gets more valuable every single day it is used.

### 5.4 Performance Intelligence

Converts raw activity into truth: per-concept mastery, forgetting risk, velocity, accuracy trends, weak-area clustering, root-cause attribution, and an honest forecast of goal completion. It answers _"am I improving?"_ with evidence rather than vibes.

### 5.5 Mission Control

The single screen. Today's directive, the state of the goal, what is at risk, what changed since yesterday. Designed so that a student can open it, read for eight seconds, and start working — with zero decisions made.

---

## 6. Core Philosophy

These are binding product and engineering principles, not slogans. Where a decision is ambiguous, these break the tie.

**1. Proactive, not reactive.**
The default interaction is FRIDAY telling the student something, not the student asking. If the student has to ask "what now?", FRIDAY has already failed.

**2. Deterministic core, intelligent shell.**
Numbers that matter — mastery, due dates, days remaining, on-track status — are _computed_, never generated by a language model. The LLM proposes, reasons, explains, and converses; the engine decides and is the source of truth. This is non-negotiable: a hallucinated study plan destroys trust permanently.

**3. One next action.**
Any interface that presents ten options has offloaded the decision back to the student. FRIDAY commits to a recommendation, shows its reasoning, and allows override.

**4. Honesty over comfort.**
If the goal is not reachable in the time available, FRIDAY says so — early, with the arithmetic, and with options (cut scope, add hours, move the date). A system that flatters is a system that gets students to the exam unprepared.

**5. Adaptation without guilt.**
Missing a day is a normal input, not a failure state. The plan absorbs it silently and re-optimises. No red streaks, no shame mechanics. Guilt is the primary cause of tool abandonment.

**6. Memory is the moat.**
Every session, answer, and conversation must durably improve FRIDAY's model of the learner. Anything that touches the student and leaves no trace in memory is a design bug.

**7. Evidence over activity.**
Time logged is an input, not an outcome. FRIDAY measures learning, not effort.

**8. Effort belongs to the student.**
FRIDAY removes the _management_ burden, never the _learning_ burden. It will not do the thinking that produces the learning. Desirable difficulty is preserved by design.

**9. Explainability by default.**
Every recommendation carries a "why" — the specific factors and weights that produced it. Black-box authority is not earned authority.

**10. Respect attention.**
Notifications are a budget, not a channel. Quiet hours, rate limits, and a relevance bar are enforced at the system level, not left to feature-level judgement.

---

## 7. Target Users

### Primary — "The Deadline-Driven Aspirant"

High-stakes exam candidates with a fixed date and an enormous, well-defined syllabus: JEE / NEET / UPSC / GATE / CAT, and international equivalents (SAT, MCAT, USMLE, CFA).

- **Why first:** the pain is maximal, the syllabus is structured (making the knowledge graph tractable), the deadline is real (making the planner's core value obvious), and willingness to pay is high.
- **Success looks like:** walks into the exam having covered the syllabus with measured mastery, not hope.

### Secondary — "The Self-Directed Skill Builder"

Working professionals and students learning a skill without institutional structure — ML, system design, a language, a certification.

- **Why second:** same planning pain, but the syllabus must be _generated_ rather than imported. Validates FRIDAY's goal-decomposition capability.

### Tertiary — "The University Student"

Multiple concurrent courses, continuous assessment, competing deadlines.

- **Why third:** requires multi-goal scheduling and calendar/LMS integration — real complexity, deferred deliberately.

### Explicit non-users (for now)

Children under 13, casual browsers with no goal, and institutions wanting an admin dashboard. B2B2C (coaching institutes, universities) is a deliberate _later_ motion — the consumer product must be excellent first.

---

## 8. Product Goals

### Year 1 — _Earn trust_

| Goal                                            | Measured by                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| G1. A student never has to decide what to study | ≥70% of study sessions started from a FRIDAY recommendation                           |
| G2. Plans survive contact with reality          | ≥60% weekly plan adherence at week 8 (vs. ~15% industry baseline for static planners) |
| G3. Forecasts are believable                    | Completion-date forecast within ±10% of actual, measured at 50% goal progress         |
| G4. Memory compounds                            | Coach responses rated "knew my context" ≥85%                                          |
| G5. Retention                                   | D30 ≥ 35%, W12 ≥ 20% for activated users                                              |

### Year 2 — _Prove outcomes_

Demonstrate measurable score/mastery improvement vs. matched non-users; expand to multi-goal; ship mobile; open the content layer.

### Year 3 — _Become infrastructure_

Institutional distribution, an API for content partners, and a learner-owned portable memory graph.

---

## 9. Long-Term Vision

**Phase A — The Manager (Year 1).**
FRIDAY manages a goal you give it. You define the destination; it drives.

**Phase B — The Diagnostician (Year 2).**
FRIDAY understands _why_ you are struggling, not just _that_ you are — misconception-level modelling, root-cause chains through the prerequisite graph, and targeted remediation rather than "revise this chapter."

**Phase C — The Chief of Staff (Year 3).**
Multi-goal, multi-year. FRIDAY manages your entire intellectual trajectory — exams, degrees, skills, career transitions — negotiating trade-offs between them the way a chief of staff manages a principal's calendar and priorities.

**Phase D — The Learning Substrate (Year 4+).**
The learner's memory graph becomes portable and durable — a lifelong record of what a person knows, at what depth, and how it is decaying. Any tool can read from it and write to it. FRIDAY becomes the layer beneath education rather than an app beside it.

### The thing we will not become

A content company, a chatbot wrapper, or a productivity toy with a streak counter. FRIDAY's value is the **decision layer** and the **memory**. Content is commodity; context is not.

---

## 10. Bet Register

The explicit, falsifiable bets this product rests on. Each has a kill/confirm signal so we learn early rather than late.

| #   | Bet                                                                          | Confirm signal                                               | Kill signal                                                                  |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| B1  | Students will accept a system's judgement over their own about what to study | ≥70% recommendation-acceptance rate                          | <40% — they override constantly; product is a planner, not an OS             |
| B2  | Proactivity is welcome, not annoying                                         | Nudge → session conversion ≥25%; notification opt-out <15%   | Opt-out >30%                                                                 |
| B3  | Honest bad news retains better than optimism                                 | Users shown "you're behind" retain ≥ users who aren't        | Churn spike after first negative forecast                                    |
| B4  | Syllabus decomposition is good enough to be trusted                          | <10% of generated concept trees materially edited by users   | Heavy manual correction — the graph must be curated, changing our cost model |
| B5  | Memory creates lock-in                                                       | Retention curve _flattens_ after week 6 rather than decaying | Retention decays like a normal utility app                                   |

---

## 11. Glossary (canonical vocabulary)

These terms are used identically across all six documents, the codebase, and the database schema. Deviation is a bug.

| Term                                 | Meaning                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| **Goal**                             | A target with a deadline (e.g. "JEE Advanced 2027"). The root object a learner attaches everything to. |
| **Curriculum**                       | The syllabus tree bound to a Goal.                                                                     |
| **Subject → Unit → Topic → Concept** | The four-level curriculum hierarchy. **Concept** is the atomic masterable unit.                        |
| **Knowledge Graph**                  | Concepts plus typed edges (`prerequisite_of`, `related_to`, `applies_to`).                             |
| **Mastery**                          | Estimated proficiency on a Concept, in [0,1], derived only from evidence.                              |
| **Memory State**                     | FSRS retention state per Concept: stability, difficulty, retrievability, due date.                     |
| **Evidence Event**                   | Any signal that legitimately updates Mastery (answer graded, test scored, self-rating, coach check).   |
| **Plan**                             | A versioned, immutable schedule spanning today → deadline. Re-planning creates a new version.          |
| **Study Block**                      | A scheduled span of time within a Plan.                                                                |
| **Task**                             | An actionable unit — `learn`, `practice`, `revise`, `assess`, or `project` — bound to Concepts.        |
| **Session**                          | An actual execution of work. The primary source of Evidence Events.                                    |
| **Next Action**                      | The single ranked recommendation FRIDAY commits to, with its reasoning.                                |
| **Insight**                          | A generated, evidence-backed finding from Performance Intelligence.                                    |
| **Directive**                        | A proactive outbound message (nudge, warning, celebration).                                            |
| **Learner Fact**                     | A durable distilled statement about the learner, written by the reflection agent.                      |
| **Learner Context Packet**           | The deterministically-assembled, token-budgeted context bundle passed to any AI call.                  |

---

## 12. Related Documents

| Document                                               | Purpose                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md)     | What we build, scoped and prioritised                                           |
| [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md)       | How the system is structured                                                    |
| [AI_DECISION_ENGINE.md](AI_DECISION_ENGINE.md)         | How FRIDAY thinks — the decision doctrine, priority framework, and traceability |
| [DATABASE_DESIGN.md](DATABASE_DESIGN.md)               | The data model                                                                  |
| [API_SPECIFICATION.md](API_SPECIFICATION.md)           | The service contract                                                            |
| [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md) | Sequencing, milestones, and the Shipathon plan                                  |
