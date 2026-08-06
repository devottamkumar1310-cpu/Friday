import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AvailabilityForm } from '@/components/onboarding/availability-form';
import { requireUser } from '@/lib/auth/server';
import { getMePayload } from '@/modules/identity/identity.service';
import { getAvailability } from '@/modules/identity/settings.service';

export const metadata: Metadata = { title: 'When can you study?' };

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await requireUser();
  const { onboarding } = await getMePayload(user);
  if (onboarding.blockedBy) redirect('/dashboard');

  const { next } = await searchParams;
  const availability = await getAvailability(user);

  return (
    <main id="main" className="mx-auto max-w-2xl px-6 py-12">
      <div className="mb-8">
        <p className="text-sm font-medium text-primary">Step 1 of 2</p>
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
        nextStep={next === 'goal' ? 'goal' : 'settings'}
      />
    </main>
  );
}
