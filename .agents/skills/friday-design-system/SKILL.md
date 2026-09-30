---
name: friday-design-system
description: >
  FRIDAY student-first visual language. Activate whenever creating or editing
  UI, pages, components, styling, animation, responsive behavior, or routes in
  this repo. Enforces the canonical system in docs/FRIDAY_DESIGN_SYSTEM.md.
---

# FRIDAY Design System Skill

FRIDAY is an AI Learning Operating System for students. It must feel like a
personal study companion: intelligent, focused, calm, motivating, premium —
never an enterprise dashboard, Linear/Vercel clone, admin panel, or card grid.

## Activate on

Any task that creates/edits UI, pages, components, styles, animations,
responsive behavior, or routes under `apps/web` or `packages/ui`.

## Hard rules

1. **Student-first hierarchy.** Every screen answers: What should I do? Why?
   How long? What changed? What happens next? One primary action per screen.
2. **Glossary is literal.** Use Mission Control, Next Action, Mastery, Memory
   State, Evidence Event, Study Block, Session, Insight, Learner Fact as
   headings/copy. Verdicts only `on_track | at_risk | not_feasible`.
   Ratings only `again | hard | good | easy`.
3. **Semantic tokens only.** `bg-surface`, `text-muted-foreground`,
   `border-border`, `bg-primary`, `text-success`, `bg-ai-surface`, etc. from
   `packages/ui/src/styles/tokens.css`. Raw colors (`bg-blue-500`,
   `text-gray-400`, `red-500`) and arbitrary radii/shadows are bugs.
4. **Accent discipline.** Focus teal (`primary`) for active nav, primary
   actions, mission markers, progress motion. Violet (`ai-accent`) ONLY for
   FRIDAY-spoken content. Success = achieved; warning = attention;
   danger = errors only — never shame, streaks, or guilt.
5. **Card roles, not generic cards.** Mission, Intelligence
   (NOTICED/MEANS/CHANGING/WHY), Adaptation (before→now+reason), Evidence
   (collapsed), Weekly Review (story), Assessment, Momentum. See
   docs/FRIDAY_COMPONENT_GUIDE.md.
6. **Typography creates hierarchy.** `PageHeader` (one H1) → `SectionHeader`
   → single eyebrow scale (`text-xs semibold uppercase tracking-wider`).
   Big numbers carry units and answer a question. Mono + tabular-nums data.
7. **No fake data, ever.** No invented metrics, mastery, insights,
   testimonials, decisions, or progress. Missing data → real empty state with
   WHAT/WHY/NEXT + filling action.
8. **Deterministic decides; model explains.** Never imply the LLM computed a
   number. No numeric confidence in UI. Low confidence → hedging words, never
   suppression. Every system message: NOTICED → MEANS → CHANGING → WHY.
9. **Motion with reason.** 120ms micro / 200ms component / 320ms major,
   `cubic(0.16,1,0.3,1)`. `.animate-enter` only; adaptation pulses once.
   `prefers-reduced-motion` is already globally honored — never bypass it.
10. **Responsive is designed.** 320→1440+: one mobile focus, sticky primaries
    where apt, zero horizontal overflow, 44px targets, shell switches at `lg`.
11. **Accessibility non-negotiable.** Skip-link, `aria-current="page"`,
    labelled controls, `role=alert/status/progressbar` where apt, AA
    contrast, exactly one `<main>` per page, keyboard-operable sheets/dialogs.
12. **No SaaS voice.** Forbid "View Analytics / Manage Tasks / AI Insights /
    Performance Metrics / Data Overview". Prefer "Start today's mission /
    See why FRIDAY changed your plan / Fix this weakness".
13. **No gamification clutter.** No XP/coins/badges-everywhere/streak-pressure/
    confetti. Communicate momentum, continuity, mastery, small wins.
14. **Backend is frozen.** No changes to planner, adaptive/mastery/FSRS,
    scheduling, root-cause/assessment engines, auth/OAuth, RevenueCat,
    billing logic, API contracts, or DB to suit the UI.

## References

- Canonical language: `docs/FRIDAY_DESIGN_SYSTEM.md`
- Components: `docs/FRIDAY_COMPONENT_GUIDE.md`
- Routes: `docs/FRIDAY_PAGE_UX_SPEC.md`
- Motion: `docs/FRIDAY_MOTION_SYSTEM.md`
- QA gates: `docs/FRIDAY_VISUAL_QA.md`
- Prior audit/IA: `docs/FRIDAY_UI_UX_REDESIGN.md`
