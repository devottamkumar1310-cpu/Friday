import Link from 'next/link';

/**
 * Auth layout — premium split-panel design.
 *
 * Left (lg+): FRIDAY branding + product quote, subtle grid background.
 * Right: centered form card, clean white background.
 *
 * Light-first — no forced dark mode on public auth pages.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      {/* ── Left branding panel (desktop only) ─────────────────────────── */}
      <aside
        className="relative hidden w-[42%] shrink-0 flex-col justify-between overflow-hidden border-r border-border bg-muted/40 p-10 lg:flex xl:w-[38%]"
        aria-hidden="true"
      >
        {/* Subtle dot-grid background */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              'radial-gradient(circle, currentColor 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        />

        {/* Wordmark */}
        <Link
          href="/"
          className="relative inline-flex flex-col focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          tabIndex={-1}
        >
          <span className="text-sm font-semibold tracking-tight">FRIDAY</span>
          <span className="text-[10px] text-muted-foreground">AI Learning Operating System</span>
        </Link>

        {/* Quote / tagline */}
        <div className="relative max-w-xs space-y-4">
          <p className="text-2xl font-semibold leading-snug tracking-tight text-foreground">
            &ldquo;Your study plan should learn from you.&rdquo;
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            FRIDAY watches what you actually remember, finds where you&rsquo;re losing ground, and
            continuously rebuilds your plan around what matters next.
          </p>

          {/* Adaptive loop micro-badge */}
          <div className="flex flex-wrap gap-2 pt-1">
            {['OBSERVE', 'UNDERSTAND', 'ADAPT', 'EXPLAIN'].map((step) => (
              <span
                key={step}
                className="rounded-md border border-border bg-background px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-primary"
              >
                {step}
              </span>
            ))}
          </div>
        </div>

        {/* Bottom note */}
        <p className="relative text-xs text-muted-foreground">
          Built for JEE &amp; NEET aspirants.
        </p>
      </aside>

      {/* ── Right form panel ────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col">
        {/* Mobile-only top bar */}
        <header className="flex items-center px-6 py-5 lg:hidden">
          <Link
            href="/"
            className="inline-flex flex-col focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            <span className="text-sm font-semibold tracking-tight">FRIDAY</span>
            <span className="text-[10px] text-muted-foreground">AI Learning Operating System</span>
          </Link>
        </header>

        {/* Centered form */}
        <main
          id="main"
          className="flex flex-1 items-start justify-center px-6 pb-20 pt-6 sm:items-center sm:pt-0"
        >
          <div className="w-full max-w-sm">{children}</div>
        </main>
      </div>
    </div>
  );
}
