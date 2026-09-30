# FRIDAY Component Guide

> Companion to docs/FRIDAY_DESIGN_SYSTEM.md. Every component: purpose, when
> (not) to use, props, hierarchy, states, interaction, motion, responsive,
> accessibility. Generic primitives live in `packages/ui`; FRIDAY domain
> roles live in `apps/web/src/components/friday/`.

## Primitives (`@friday/ui`)

### Button — variants `primary | secondary | outline | ghost | destructive | link`, sizes `sm | md | lg | icon`
Purpose: the single action control. When to use: every CTA. NOT for: navigation
menus (use links), toggles (use `aria-pressed` buttons). Hierarchy: one
`primary`/`lg` per screen; secondary for safe alternatives; destructive only
for irreversible confirms. States: `loading` (spinner + `aria-busy`),
`disabled` (opacity + no pointer). Motion: color transition 120ms only.
Responsive: full-width primaries on phones (`w-full sm:w-auto`), 44px floors
always. A11y: global focus ring; `asChild` for link-CTAs so semantics stay
correct.

### Card (`Card/Header/Title/Description/Content/Footer`)
Purpose: neutral container. NOT a substitute for a card *role* — if the
content answers one of the role questions (next move? noticed? changed?
evidence?), use the role component instead. Treatment: `rounded-xl`,
`border-border`, `bg-surface(-raised)`, `shadow-sm` max.

### PageHeader (`title, description?, eyebrow?, actions?`) / SectionHeader (`+ id?`)
Purpose: the reason a page/section exists. Use on every page (one H1) and
every labelled settings/report section. `id` feeds `aria-labelledby`.

### Other primitives
Input/Field (label+hint+error, `aria-describedby`), Textarea, Select (native,
deliberate), Dialog/Sheet (Radix, `lg`/`sm` widths), Tabs, Badge
(`neutral|primary|success|warning|destructive|outline|ai` + `AiBadge` for
model-generated content only), Progress + ProgressRing (always with
`role=progressbar` + values), Skeleton/SkeletonText (loading), Spinner
(buttons/streams only), Callout (`info|success|warning|danger`, inline
form/API states), EmptyState (`title/description/icon/action{label,onClick?,href?}`),
ErrorState (`title?/description?/requestId?/onRetry?`), LoadingState
(`title?/lines?` — layout-preserving region, `role=status`), Toaster.

## FRIDAY roles (`components/friday/`)

### MissionCard (`action: {taskId,title,estimatedMinutes,rationale,why}`)
WHAT / HOW LONG (display minutes) / WHY (rationale) / WHY NOW (`WhyThis`
factor breakdown in a disclosure). Primary `Start Session → /study/[id]`
dominant; sub-caption "After this session, your plan adapts." `MissionComplete`
covers the done state (dashed, success eyebrow, no shame). Motion: enter.
Mobile: stacked, full-width CTA.

### IntelligenceBlock (`eyebrow?, statement, meaning?, changing?, evidence?, alarming?, action?`)
NOTICED → MEANS → CHANGING → WHY, ai-accent eyebrow (`Friday noticed`
default). `alarming` uses the warning border only. Use for observations and
risks. Never a bare "AI Insight".

### AdaptationCard (`statement, evidence?, before?, now?, reason?, href?, hrefLabel?`)
"FRIDAY adapted your plan": statement + before→now definition list + reason +
`View changes → /plan`. `ai-surface`, single adapt pulse. Use for plan diffs
and rescheduling notices.

### MomentumMetric (`eyebrow, value, unit?, caption?`) / MomentumSparkline (`points: {date,weightedProgress}[]`)
Big numbers that answer a question. Sparkline renders recorded snapshots
only; <2 points → honest caption, never an invented line. `role=img` with a
real delta label.

### WhyThis (existing, `components/progress/why-this.tsx`)
L2 factor projection: five learner-worded factors, contribution bars only
where the formula has them, dominant marked `main reason`, hedging sentence
for non-high confidence. Reuse inside MissionCard; do not duplicate.

### WeakConceptList / FeasibilityRemediation / PracticeRunner / CoachChat / FactList
Existing domain components, kept. Voice rules apply inside them ("Follow the
root cause", no red mastery, honest empty copy). Feasibility verdicts pass
through from the engine (`on_track|at_risk|not_feasible`); remediation shows
exactly when `verdict !== 'on_track'` with all three levers together.
