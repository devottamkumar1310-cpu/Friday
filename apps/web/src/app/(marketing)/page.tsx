import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '@friday/ui';

/**
 * The landing page.
 *
 * What it replaced described a category ("AI Learning Operating System") in
 * enterprise vocabulary, promised a philosophy ("stop planning, start
 * studying"), and never once named the exam its only curriculum is built for.
 * A Class 12 JEE aspirant could read the whole page and not learn that it was
 * for them. Nothing about the product was visible anywhere on it.
 *
 * This page does three things instead:
 *
 *   1. **Names the reader in the first line.** "For JEE & NEET aspirants" is
 *      worth more than any headline, because the first question is not "is
 *      this good" but "is this mine".
 *   2. **Shows the product instead of describing it.** The mission card below
 *      is the actual Mission Control layout with real-looking numbers. The
 *      differentiator — that FRIDAY explains *why* — is the one thing a
 *      screenshot can carry, and it was previously buried behind a collapsed
 *      disclosure three screens into the app.
 *   3. **Sets an honest expectation about setup**, because the old CTA said
 *      "start studying" and led to a four-step onboarding.
 *
 * Mobile first throughout: single column, full-width primary action, and the
 * proof card sized to sit inside a 390px screen.
 */
export default function LandingPage() {
  return (
    <>
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-4 sm:px-6">
        <span className="text-lg font-semibold tracking-tight">FRIDAY</span>
        <Button asChild variant="ghost" size="sm">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </header>

      <main id="main" className="mx-auto max-w-5xl px-5 pb-20 pt-6 sm:px-6 sm:pt-16">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
          <section className="max-w-xl">
            <p className="text-sm font-semibold text-primary">For JEE &amp; NEET aspirants</p>

            <h1 className="mt-3 text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
              Adaptive study plans. Zero backlog.
            </h1>

            <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
              Smart daily planning tuned to your exam date. Open FRIDAY, get one high-leverage
              topic, and start. Your plan dynamically rewrites itself after every session based on
              what you actually remember.
            </p>

            <div className="mt-7 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link href="/sign-up">
                  Start free <ArrowRight />
                </Link>
              </Button>
              <p className="text-center text-sm text-muted-foreground sm:text-left">
                Already have an account?{' '}
                <Link href="/sign-in" className="text-primary underline underline-offset-4">
                  Sign in
                </Link>
              </p>
            </div>

            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
              {['Free to start', 'No card needed', 'Setup takes 2 minutes'].map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <Check className="size-4 text-success" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <MissionPreview />
        </div>

        <section className="mt-20 grid gap-4 sm:grid-cols-3">
          {[
            {
              title: 'One thing at a time',
              body: 'No ten-item to-do list to feel guilty about. One topic, chosen for you, with the reason in plain English.',
            },
            {
              title: 'It notices what you forget',
              body: 'Topics come back for review right before you would have lost them, so revision actually sticks.',
            },
            {
              title: 'It tells you the truth',
              body: 'You will see whether your deadline is reachable, and what to change if it is not.',
            },
          ].map(({ title, body }) => (
            <div key={title} className="rounded-xl border border-border bg-surface p-5">
              <h2 className="font-medium">{title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>

        <p className="mt-12 text-center text-sm text-muted-foreground">
          Built for the Indian exam grind. Physics first, more subjects coming.
        </p>
      </main>
    </>
  );
}

/**
 * The proof block.
 *
 * Deliberately hand-built rather than importing the real `WhyThis` component:
 * that one renders `priorityScore.toFixed(3)` and a confidence band, which are
 * engine internals and have no business on a marketing page. The *shape* is
 * faithful to Mission Control, which is the honest part — this is what the
 * product actually looks like, not an idealised mock of something that does not
 * exist.
 *
 * `aria-hidden` because it is an illustration; a screen-reader user gets the
 * sentence above it instead, and reading out a fake mission would be confusing.
 */
function MissionPreview() {
  return (
    <div className="relative" aria-hidden>
      {/* A soft wash behind the card so it reads as a screen, not a table. */}
      <div className="absolute -inset-4 rounded-[2rem] bg-primary/5 blur-2xl" />

      <div className="relative mx-auto w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-lg">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-primary">
            Today&rsquo;s mission
          </span>
          <span className="rounded-full border border-border px-2.5 py-1 text-xs tabular-nums text-muted-foreground">
            40 min
          </span>
        </div>

        <p className="mt-4 text-2xl font-semibold leading-snug tracking-tight">Rotational Motion</p>

        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Worth 12% of the paper and you&rsquo;re at 20%. Nothing else you could do today moves your
          score this much.
        </p>

        <div className="mt-5 space-y-2.5">
          {[
            // Same labels the real screen uses, so the hero is a promise the
            // product keeps rather than a better-written version of it.
            { label: 'How much it matters', width: 'w-[84%]', strong: true },
            { label: 'How soon you need it', width: 'w-[46%]', strong: false },
            { label: 'Whether you can start', width: 'w-[100%]', strong: false },
          ].map((factor) => (
            <div key={factor.label}>
              <div className="flex items-center justify-between text-xs">
                <span
                  className={
                    factor.strong ? 'font-medium text-foreground' : 'text-muted-foreground'
                  }
                >
                  {factor.label}
                </span>
                {factor.strong ? (
                  // Solid fill, not a 10% tint: tinted primary-on-primary at
                  // this size falls below the 4.5:1 contrast floor.
                  <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
                    main reason
                  </span>
                ) : null}
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${factor.strong ? 'bg-primary' : 'bg-border-strong'} ${factor.width}`}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 w-full rounded-lg bg-primary px-4 py-3 text-center text-sm font-medium text-primary-foreground">
          Start studying
        </div>
      </div>
    </div>
  );
}
