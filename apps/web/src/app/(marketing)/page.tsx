import Link from 'next/link';
import { ArrowRight, Brain, Compass, LineChart } from 'lucide-react';
import { Button, Card, CardContent } from '@friday/ui';

export default function LandingPage() {
  return (
    <main id="main" className="mx-auto max-w-5xl px-6 py-20 sm:py-28">
      <section className="max-w-2xl">
        <p className="mb-4 text-sm font-medium uppercase tracking-widest text-muted-foreground">
          AI Learning Operating System
        </p>
        <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Stop planning what to study. Start studying.
        </h1>
        <p className="mt-5 text-pretty text-lg text-muted-foreground">
          FRIDAY holds your goal, your deadline, and everything you have learned so far — and tells
          you the single highest-impact thing to do right now. It re-plans when life happens, so you
          never have to.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/sign-up">
              Get started <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
      </section>

      <section className="mt-20 grid gap-4 sm:grid-cols-3">
        {[
          {
            icon: Compass,
            title: 'One next action',
            body: 'Not a list of ten options. A decision, with the reasoning shown.',
          },
          {
            icon: Brain,
            title: 'Memory that compounds',
            body: 'Every session sharpens what FRIDAY knows about how you learn.',
          },
          {
            icon: LineChart,
            title: 'Honest forecasts',
            body: 'Whether you will finish in time, with the arithmetic behind it.',
          },
        ].map(({ icon: Icon, title, body }) => (
          <Card key={title}>
            <CardContent className="pt-6">
              <Icon className="mb-3 size-5 text-primary" aria-hidden />
              <h2 className="font-medium">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
