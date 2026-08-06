# FRIDAY

**An AI Learning Operating System.**

Not a tutor. Not a planner. An intelligence that owns a student's academic state and continuously answers the only question that matters:

> _"What is the highest-impact thing I should do right now?"_

---

## Status: Blueprint v1.4 — **FROZEN** · Phase 2 (Intelligence Layer) complete and runtime-verified

The architecture has been designed, documented, reviewed, corrected, and frozen. **Architecture first, documentation second, code third.**

- [DESIGN_REVIEW.md](DESIGN_REVIEW.md) — the pre-implementation technical design review (8 critical issues found)
- [ARCHITECTURE_CHANGELOG.md](ARCHITECTURE_CHANGELOG.md) — how each was fixed, and **the change-request process that now governs this blueprint**

> The blueprint is no longer edited in place. Changes to any table, endpoint, invariant, or the priority formula require a change request. See the changelog for what does and does not need one.

These seven documents are the project's source of truth. Read them in order.

| #   | Document                                               | Answers                                                                                         |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 1   | [PROJECT_VISION.md](PROJECT_VISION.md)                 | Why FRIDAY exists, who it serves, what we believe and are betting on                            |
| 2   | [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md)     | What it does — functional + non-functional requirements, MVP scope, workflows, metrics          |
| 3   | [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md)       | How it's built — stack, frontend, backend, AI, folder structure, deployment                     |
| 4   | [AI_DECISION_ENGINE.md](AI_DECISION_ENGINE.md)         | **How it thinks** — decision doctrine, priority framework, replanning, confidence, traceability |
| 5   | [DATABASE_DESIGN.md](DATABASE_DESIGN.md)               | How state is modelled — entities, relationships, indexes, scaling                               |
| 6   | [API_SPECIFICATION.md](API_SPECIFICATION.md)           | How clients talk to it — modules, endpoints, auth, errors, versioning                           |
| 7   | [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md) | In what order it gets built — phases, milestones, testing, Shipathon plan                       |

> **AI_DECISION_ENGINE.md is the reference for every future implementation touching planning, recommendations, or AI decision-making.** If a change affects what FRIDAY decides, it starts there.

---

## The one idea

Every competitor has the same language models. The models are not the moat.

FRIDAY's differentiator is a **deterministic learning-state engine** — mastery estimation, forgetting curves, prerequisite readiness, feasibility arithmetic, and a transparent priority function — with AI as the reasoning and interface layer on top of it.

**The LLM proposes. The engine decides.**

```
LLM MAY                       LLM MAY NOT
─────────────────────         ──────────────────────
decompose a syllabus          set a mastery score
estimate effort               compute a due date
generate questions            decide the Next Action
grade against a rubric        declare you on-track
explain a decision            commit a plan change
```

A hallucinated study plan destroys trust permanently. Every number FRIDAY shows a student is computed, reproducible by hand, and explainable.

---

## The five systems, as one loop

```
    ADAPTIVE PLANNER ──▶ MISSION CONTROL ──▶ student executes ──┐
     (decides what)        (surfaces it)                        │
          ▲                                                     ▼
    PERFORMANCE  ◀────── LEARNING MEMORY ◀────── evidence events
    INTELLIGENCE          (remembers it)
     (interprets it)              │
          └──────────────▶ AI LEARNING COACH
                            (explains + intervenes)
```

---

## Stack at a glance

TypeScript · Next.js 15 · PostgreSQL 16+ · Drizzle · first-party session auth (Argon2id) · Inngest · Vercel AI SDK · Claude (Opus 4.8 / Sonnet 5 / Haiku 4.5) · FSRS-5 · Tailwind + shadcn/ui · Vercel

Full justification, including the decisions worth arguing about, in [SYSTEM_ARCHITECTURE.md §2](SYSTEM_ARCHITECTURE.md#2-technology-stack).

---

## Next step

Confirm the open assumptions in [IMPLEMENTATION_ROADMAP.md §10](IMPLEMENTATION_ROADMAP.md#10-assumptions-to-confirm) — Shipathon window, launch segment, team size — then begin **Phase 0: Foundations**.
