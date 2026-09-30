import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AvailabilityForm } from '@/components/onboarding/availability-form';
import { requireUser } from '@/lib/auth/server';
import { listGoals } from '@/modules/curriculum/curriculum.service';
import { getMePayload } from '@/modules/identity/identity.service';
import { getAvailability } from '@/modules/identity/settings.service';

export const metadata: Metadata = { title: 'When can you study?' };

/**
 * This page is two things: step one of onboarding, and the schedule editor
 * reached from Settings. Which one it is used to be decided by a `?next=goal`
 * query parameter — but a parameter is lost on a refresh, a bookmark, or a
 * back-navigation. Whether a learner is onboarding is a fact about their
 * account, not about their URL, so it is derived from whether they have a goal yet.
 */
export default async function AvailabilityPage() {
  const user = await requireUser();
  const { onboarding } = await getMePayload(user);
  if (onboarding.blockedBy) redirect('/dashboard');

  const [availability, goals] = await Promise.all([getAvailability(user), listGoals(user)]);
  const isOnboarding = goals.length === 0;

  return (
    <main id="main" className="min-h-dvh bg-background flex items-start justify-center px-6 py-16">
      <div className="w-full max-w-2xl">
        {/* Progress */}
        {isOnboarding && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Setting up your system
              </span>
              <span className="text-xs text-muted-foreground">— Step 1 of 2</span>
            </div>
            <div className="flex gap-1.5">
              <div className="h-1 flex-1 rounded-full bg-primary" />
              <div className="h-1 flex-1 rounded-full bg-border" />
            </div>
          </div>
        )}

        {/* Header */}
        <div className="mb-10 space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">When can you study?</h1>
          <p className="text-base text-muted-foreground leading-relaxed max-w-lg">
            Give FRIDAY the hours you realistically have, not the ones you wish you had.
          </p>
          <p className="text-sm text-subtle-foreground bg-surface border border-border rounded-lg px-4 py-3">
            <strong className="text-foreground">Why this matters:</strong> Every forecast FRIDAY makes is measured against this capacity.
            An optimistic answer here produces a plan that quietly fails.
          </p>
        </div>

        <AvailabilityForm
          initialRules={availability.rules.map((r) => ({
            dayOfWeek: r.dayOfWeek,
            startTime: r.startTime,
            endTime: r.endTime,
          }))}
          nextStep={isOnboarding ? 'goal' : 'settings'}
        />
      </div>
    </main>
  );
}
