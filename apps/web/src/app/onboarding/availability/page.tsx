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
 * back-navigation, and a learner who lost it was sent to Settings in the middle
 * of onboarding, having never been offered the goal step. They were also shown
 * "Step 1 of 2" while editing from Settings, where there is no step 2.
 *
 * Whether a learner is onboarding is a fact about their account, not about
 * their URL, so it is derived from whether they have a goal yet.
 */
export default async function AvailabilityPage() {
  const user = await requireUser();
  const { onboarding } = await getMePayload(user);
  if (onboarding.blockedBy) redirect('/dashboard');

  const [availability, goals] = await Promise.all([getAvailability(user), listGoals(user)]);
  const isOnboarding = goals.length === 0;

  return (
    <main id="main" className="mx-auto max-w-2xl px-6 py-12">
      <div className="mb-8">
        {isOnboarding ? <p className="text-sm font-medium text-primary">Step 1 of 2</p> : null}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">When can you study?</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Give FRIDAY the hours you realistically have, not the ones you wish you had. Every
          forecast it makes is measured against this — an optimistic answer here produces a plan
          that quietly fails.
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
    </main>
  );
}
