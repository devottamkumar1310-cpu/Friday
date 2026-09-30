'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowRight,
  Brain,
  CalendarDays,
  Check,
  Eye,
  Lightbulb,
  Menu,
  PlayCircle,
  Sparkles,
  Target,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { Button } from '@friday/ui';

/**
 * FRIDAY landing page.
 *
 * Positioning: AI Learning Operating System — not an AI chatbot, not a generic
 * study planner. FRIDAY actively observes, decides, and explains.
 *
 * Design direction: Linear / Vercel restraint. Low-chroma palette. Typography
 * does the work. No fake statistics, no fake testimonials, no fake logos.
 *
 * Sections:
 *  1. Hero with adaptive loop illustration
 *  2. Adaptive loop narrative       (#how-it-works)
 *  3. Capabilities / product        (#product)
 *  4. Mission Control callout       (#intelligence)
 *  5. Pricing                       (#pricing)
 *  6. Final CTA
 */
export default function LandingPage() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* ─── Nav ──────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4 sm:px-6">
          {/* Wordmark */}
          <span className="text-sm font-semibold tracking-tight">FRIDAY</span>

          {/* Desktop nav links */}
          <nav className="hidden items-center gap-6 md:flex" aria-label="Primary navigation">
            <a
              href="#product"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Product
            </a>
            <a
              href="#how-it-works"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              How it works
            </a>
            <a
              href="#intelligence"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Intelligence
            </a>
            <a
              href="#pricing"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Pricing
            </a>
          </nav>

          {/* Desktop CTA buttons */}
          <div className="hidden items-center gap-2 md:flex">
            <Button asChild variant="ghost" size="sm">
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/sign-up">Start free</Link>
            </Button>
          </div>

          {/* Mobile hamburger */}
          <button
            className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground md:hidden"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>

        {/* Mobile dropdown sheet */}
        <div
          className={`overflow-hidden transition-all duration-200 ease-out md:hidden ${
            mobileOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
          }`}
          aria-hidden={!mobileOpen}
        >
          <nav
            className="flex flex-col border-t border-border/60 px-5 pb-5 pt-4"
            aria-label="Mobile navigation"
          >
            {[
              { label: 'Product', href: '#product' },
              { label: 'How it works', href: '#how-it-works' },
              { label: 'Intelligence', href: '#intelligence' },
              { label: 'Pricing', href: '#pricing' },
            ].map(({ label, href }) => (
              <a
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className="border-b border-border/40 py-3 text-sm text-muted-foreground transition-colors hover:text-foreground last:border-0"
              >
                {label}
              </a>
            ))}
            <div className="mt-4 flex flex-col gap-2">
              <Button asChild variant="secondary" size="sm" className="w-full">
                <Link href="/sign-in" onClick={() => setMobileOpen(false)}>
                  Sign in
                </Link>
              </Button>
              <Button asChild size="sm" className="w-full">
                <Link href="/sign-up" onClick={() => setMobileOpen(false)}>
                  Start free
                </Link>
              </Button>
            </div>
          </nav>
        </div>
      </header>

      <main id="main">
        {/* ─── Hero ────────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-5 pb-16 pt-14 sm:px-6 sm:pt-24">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
            {/* Left: copy */}
            <div className="max-w-xl">
              {/* Eyebrow */}
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">
                AI Learning Operating System
              </p>

              <h1 className="mt-4 text-balance text-5xl font-bold leading-[1.08] tracking-tight text-foreground lg:text-6xl">
                FRIDAY learns how you learn.
              </h1>

              <p className="mt-5 max-w-lg text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
                FRIDAY watches what you actually remember, finds where you&apos;re losing ground,
                and continuously rebuilds your study plan around what matters next.
              </p>

              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button asChild size="lg" className="w-full sm:w-auto">
                  <Link href="/sign-up">
                    Start free →
                  </Link>
                </Button>
                <Button asChild variant="ghost" size="lg" className="w-full sm:w-auto">
                  <a href="#how-it-works">See how FRIDAY works</a>
                </Button>
              </div>

              <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                {['No card required', 'Adaptive planning', 'Built for serious exam prep'].map(
                  (item) => (
                    <li key={item} className="flex items-center gap-1.5">
                      <Check className="size-4 text-success" aria-hidden />
                      {item}
                    </li>
                  ),
                )}
              </ul>
            </div>

            {/* Right: Mission Control preview */}
            <MissionControlPreview />
          </div>
        </section>

        {/* ─── Adaptive Loop ───────────────────────────────────────────────── */}
        <section
          id="how-it-works"
          className="border-t border-border bg-muted/30"
          aria-labelledby="adaptive-loop-heading"
        >
          <div className="mx-auto max-w-5xl px-5 py-16 sm:px-6 sm:py-20">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold text-primary">How FRIDAY thinks</p>
              <h2
                id="adaptive-loop-heading"
                className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
              >
                The adaptive learning loop
              </h2>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                Every session runs through a deterministic engine that watches, decides, and
                explains. Not an AI that guesses what sounds good — a system that works from
                evidence.
              </p>
            </div>

            <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  step: 'OBSERVE',
                  icon: Eye,
                  description:
                    'Records every session: what you did, how long, and whether it stuck.',
                },
                {
                  step: 'UNDERSTAND',
                  icon: Brain,
                  description:
                    'Builds a mastery model from session evidence. Detects weak concepts and root causes.',
                },
                {
                  step: 'PLAN',
                  icon: CalendarDays,
                  description:
                    'Backwards from your deadline, forwards from what you already know, inside the hours you actually have.',
                },
                {
                  step: 'STUDY',
                  icon: PlayCircle,
                  description:
                    'One mission at a time, timed to your real pace — not a list you are meant to feel bad about.',
                },
                {
                  step: 'ADAPT',
                  icon: Zap,
                  description:
                    'Resizes sessions, redistributes missed work, and rebalances the plan.',
                },
                {
                  step: 'EXPLAIN',
                  icon: Lightbulb,
                  description:
                    'Every decision is shown in plain English. You always know why the plan changed.',
                },
              ].map(({ step, icon: Icon, description }) => (
                <div key={step} className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface shadow-sm">
                    <Icon className="size-4 text-primary" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                      {step}
                    </p>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      {description}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <p className="mx-auto mt-10 max-w-xl text-center text-sm leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">The loop closes on itself.</span>{' '}
              Every session produces the evidence that refines the model that chose the
              next session. That is the whole product.
            </p>
          </div>
        </section>

        {/* ─── Capabilities ────────────────────────────────────────────────── */}
        <section
          id="product"
          className="mx-auto max-w-5xl px-5 py-16 sm:px-6 sm:py-20"
          aria-labelledby="capabilities-heading"
        >
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold text-primary">What FRIDAY does</p>
            <h2
              id="capabilities-heading"
              className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              Built for the demands of competitive exams
            </h2>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">
              Every feature listed below is live. Nothing is a roadmap item.
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Target,
                title: 'Adaptive Planning',
                description:
                  'A 14-day detailed schedule updated every session. Missed yesterday? Work is redistributed automatically, not silently dropped.',
              },
              {
                icon: Brain,
                title: 'Root-Cause Intelligence',
                description:
                  'When a concept is weak, FRIDAY traces the prerequisite chain to find where it broke down — not just which topic to revise.',
              },
              {
                icon: Eye,
                title: 'Evidence-Backed Decisions',
                description:
                  'Every recommendation shows its evidence: mastery score, exam weight, retention decay, and the factor that dominated the ranking.',
              },
              {
                icon: Zap,
                title: 'Workload Adaptation',
                description:
                  'Struggling? Sessions shorten. Thriving? Sessions expand. The engine detects your band from recent history and adjusts the time budget.',
              },
              {
                icon: Lightbulb,
                title: 'Weekly Review',
                description:
                  'A structured end-of-week summary of what shifted, what the engine noticed, and what it changed for next week.',
              },
              {
                icon: TrendingUp,
                title: 'Mock Assessments',
                description:
                  'Full-length mock tests with per-question analysis. Results feed back into the mastery model so the plan adjusts after each test.',
              },
            ].map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="rounded-lg border border-border bg-surface p-5 transition-colors hover:border-border-strong"
              >
                <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="size-4 text-primary" aria-hidden />
                </div>
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ─── Mission Control Feature Callout ─────────────────────────────── */}
        <section
          id="intelligence"
          className="border-t border-border bg-muted/30"
          aria-labelledby="mc-heading"
        >
          <div className="mx-auto max-w-5xl px-5 py-16 sm:px-6 sm:py-20">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="text-sm font-semibold text-primary">Mission Control</p>
                <h2
                  id="mc-heading"
                  className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
                >
                  Mission Control answers five questions
                </h2>
                <ul className="mt-6 space-y-3">
                  {[
                    'What should I do now?',
                    'Why should I do it?',
                    'How much time will it take?',
                    'What changed since yesterday?',
                    'What should I do next?',
                  ].map((q) => (
                    <li key={q} className="flex items-start gap-3 text-sm">
                      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                      <span>{q}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
                  Every answer is deterministic — computed from your session data, not generated by
                  an LLM. FRIDAY&apos;s AI Coach reads the same model, so the two never disagree.
                </p>
              </div>

              <MissionControlDetailPreview />
            </div>
          </div>
        </section>

        {/* ─── Pricing ─────────────────────────────────────────────────────── */}
        <section
          id="pricing"
          className="mx-auto max-w-5xl px-5 py-16 sm:px-6 sm:py-20"
          aria-labelledby="pricing-heading"
        >
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold text-primary">FRIDAY Pro</p>
            <h2
              id="pricing-heading"
              className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              Start free. Upgrade when it matters.
            </h2>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">
              The core adaptive engine — planning, adaptation, progress tracking — is free. Pro
              unlocks unlimited AI Coach sessions and priority reasoning.
            </p>
          </div>

          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            {/* Free */}
            <div className="rounded-xl border border-border bg-surface p-6">
              <p className="font-semibold">Free</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Everything you need to start learning adaptively.
              </p>
              <ul className="mt-5 space-y-2.5 text-sm">
                {[
                  'Adaptive planning engine',
                  'Workload adaptation',
                  'Progress & mastery tracking',
                  'Root-cause attribution',
                  'Weekly review',
                  'Basic practice problems',
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2.5 text-muted-foreground">
                    <Check className="size-4 shrink-0 text-success" aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
              <Button asChild variant="secondary" className="mt-6 w-full">
                <Link href="/sign-up">Start free</Link>
              </Button>
            </div>

            {/* Pro */}
            <div className="rounded-xl border border-primary/40 bg-primary/5 p-6 shadow-md">
              <div className="flex items-center gap-2">
                <p className="font-semibold">FRIDAY Pro</p>
                <Sparkles className="size-4 text-primary" aria-hidden />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Unlimited AI sessions and priority reasoning.
              </p>
              <ul className="mt-5 space-y-2.5 text-sm">
                {[
                  'Everything in Free',
                  'Unlimited AI Coach sessions',
                  'Personalized spaced repetition',
                  'Unlimited practice generation',
                  'Advanced root-cause analytics',
                  'Priority model reasoning (Gemini & Claude)',
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2.5 text-muted-foreground">
                    <Check className="size-4 shrink-0 text-primary" aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-6 w-full">
                <Link href="/sign-up">Start free, upgrade inside</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* ─── Final CTA ───────────────────────────────────────────────────── */}
        <section className="border-t border-border bg-muted/30">
          <div className="mx-auto max-w-5xl px-5 py-16 sm:px-6 sm:py-20">
            <div className="mx-auto max-w-xl text-center">
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Ready to study with a system that adapts?
              </h2>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                Takes two minutes to set up your first goal. No credit card required.
              </p>
              <Button asChild size="lg" className="mt-7 w-full sm:w-auto">
                <Link href="/sign-up">
                  Start learning with FRIDAY
                  <ArrowRight className="ml-1.5 size-4" aria-hidden />
                </Link>
              </Button>
              <p className="mt-4 text-sm text-muted-foreground">
                Built for JEE &amp; NEET aspirants. Physics first, more subjects coming.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* ─── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-5 py-6 sm:px-6">
          <span className="text-sm font-semibold tracking-tight">FRIDAY</span>
          <div className="flex items-center gap-4">
            <a
              href="#"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Privacy
            </a>
            <a
              href="#"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Terms
            </a>
            <p className="text-xs text-muted-foreground">
              AI Learning Operating System · Built for the exam grind
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}

/**
 * Hero proof block — shows what Mission Control actually looks like.
 *
 * Built from static values faithful to the real screen. `aria-hidden` because
 * this is a visual illustration; screen-reader users get the surrounding copy.
 */
function MissionControlPreview() {
  return (
    <div className="relative" aria-hidden>
      {/* Ambient glow */}
      <div className="absolute -inset-6 rounded-[2.5rem] bg-primary/5 blur-3xl" />

      <div className="relative mx-auto w-full max-w-sm rounded-xl border border-border bg-surface p-5 shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wide text-primary">
              Adjusting to keep you moving
            </span>
          </div>
        </div>

        {/* "What I noticed" beat */}
        <div className="mt-4 space-y-2 rounded-xl border border-border bg-muted/40 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            What I noticed
          </p>
          <p className="text-sm leading-relaxed">Session durations dropped to ~18 min this week.</p>
          <p className="text-xs text-muted-foreground">
            4 of your last 5 sessions were shorter than planned.
          </p>
        </div>

        {/* "What I changed" beat */}
        <div className="mt-2 space-y-2 rounded-xl border border-border bg-muted/40 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            What I changed
          </p>
          <p className="text-sm leading-relaxed">Shortened sessions to about 20 minutes.</p>
          <p className="text-xs text-muted-foreground">Targets your actual pace, not the plan.</p>
        </div>

        {/* Next action */}
        <div className="mt-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Next action
          </p>
          <div className="mt-1.5 flex items-baseline justify-between">
            <p className="text-lg font-semibold leading-snug tracking-tight">Rotational Motion</p>
            <span className="text-sm text-muted-foreground">20 min</span>
          </div>
          <p className="mt-1 text-sm font-medium">
            Worth 12% of the paper and you&apos;re at 20% — best use of the time you have.
          </p>
        </div>

        <div className="mt-4">
          <Button size="sm" className="w-full" tabIndex={-1}>
            Start this now →
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Detailed Mission Control preview for the feature callout section.
 */
function MissionControlDetailPreview() {
  const factors = [
    { label: 'Exam weight', value: 84, primary: true, reason: 'main reason' },
    { label: 'Urgency (days left)', value: 60, primary: false, reason: null },
    { label: 'Mastery gap', value: 78, primary: false, reason: null },
    { label: 'Prerequisite readiness', value: 100, primary: false, reason: null },
    { label: 'Retention decay', value: 32, primary: false, reason: null },
  ];

  return (
    <div className="relative" aria-hidden>
      <div className="relative mx-auto w-full max-w-sm rounded-xl border border-border bg-surface p-5 shadow-lg">
        <p className="mb-1 text-sm font-medium">Why this one</p>
        <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
          Rotational Motion is worth 12% of the paper and your mastery is at 20%. Closing this gap
          moves your score more than anything else today.
        </p>
        <div className="space-y-2.5">
          {factors.map((f) => (
            <div key={f.label}>
              <div className="flex items-center justify-between text-xs">
                <span className={f.primary ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                  {f.label}
                </span>
                {f.reason && (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
                    {f.reason}
                  </span>
                )}
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all ${f.primary ? 'bg-primary' : 'bg-border-strong'}`}
                  style={{ width: `${f.value}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
