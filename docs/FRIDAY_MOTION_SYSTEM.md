# FRIDAY Motion System

> Every animation has a reason. Motion communicates state — never decoration.

## Tokens (`tokens.css`)

- `--duration-fast: 120ms` — micro-interactions (hover, toggles, presses).
- `--duration-base: 200ms` — component transitions (dialogs, sheets, tabs,
  disclosures, `.animate-enter`).
- `--duration-slow: 320ms` — major transitions (progress fills).
- `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)` — the only easing.
- Global `prefers-reduced-motion` kill switch (durations → 0.01ms). Never
  bypass it. Never add `motion-safe:`-gated decoration.

## Vocabulary

| Pattern | Class / impl | When |
|---|---|---|
| Enter | `.animate-enter` (fade + 8px rise, `both`) | page sections, cards on first paint |
| Stagger | inline `style="--enter-delay: 60ms"` | sibling sections (60/120ms steps, max ~3) |
| Adaptation | `.animate-adapt` (one 900ms soft ring) | plan-change cards only, once on paint |
| Progress | `transition-[width] duration-500` + `motion-reduce:transition-none` | factor bars, mastery bars |
| Hover | color/border transitions 120–200ms | buttons, links, rows (border-strong shift) |
| Skeleton | `animate-pulse` | loading placeholders |
| Spinner | `Loader2 animate-spin` + `sr-only` label | button pending, streams |
| Sheet/dialog | Radix defaults eased by `--ease-out` | overlays |

## Forbidden

Excessive bounce, constant movement, floating elements, parallax, giant
entrance animations, glow pulses, scroll-triggered reveals, page-level
choreography for effect.

## Page transitions (relationships, not effects)

- Dashboard → Study: shell is covered by the focus overlay — entering a room.
- Progress → Root Cause: drill deeper (back link preserves the trail).
- Weekly Review → Root Cause: following an investigation (same back trail).
- Session → Dashboard: return with refreshed data (`router.refresh()`), no
  celebratory animation beyond the done screen's own content.

## Loading / success / error motion

Loading preserves layout (skeletons shaped like the content). Success is
content (mastery before→after, review dates) — no confetti, no toasts-as-
reward. Errors appear in place (Callout/ErrorState), focus moves to them
where the flow breaks (study errors use `errorRef`).
