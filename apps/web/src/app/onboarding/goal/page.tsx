import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { GoalForm } from '@/components/onboarding/goal-form';
import { requireUser } from '@/lib/auth/server';
import { getMePayload } from '@/modules/identity/identity.service';
import { listGoals, listTemplates } from '@/modules/curriculum/curriculum.service';
import { getAvailability, weeklyMinutes } from '@/modules/identity/settings.service';

export const metadata: Metadata = { title: 'Set your goal' };

export default async function GoalPage() {
  const user = await requireUser();
  const { onboarding } = await getMePayload(user);

  // FR-1.6: date of birth and, for minors, guardian consent come first.
  if (onboarding.blockedBy) redirect('/dashboard');

  // A goal without availability cannot be planned (E-6), so collect capacity
  // first rather than failing at the end of a form they already filled in.
  const availability = await getAvailability(user);
  if (availability.rules.length === 0) redirect('/onboarding/availability');

  // Already has a goal — nothing to do here.
  const goals = await listGoals(user);
  if (goals.length > 0) redirect('/dashboard');

  const templates = await listTemplates();

  return (
    <main id="main" className="mx-auto max-w-2xl px-6 py-12">
      <div className="mb-8">
        <p className="text-sm font-medium text-primary">Step 2 of 2</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          What are you working towards?
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          FRIDAY plans backwards from your deadline and forwards from what you know. Both answers
          below can be changed later.
        </p>
      </div>

      <GoalForm
        // Single source of truth. The form used to ask for weekly hours again
        // and default to "10 hours a week", which silently contradicted the
        // availability the learner had just set on the previous screen.
        weeklyMinutes={weeklyMinutes(availability.rules)}
        templates={templates.map((t) => ({
          id: t.id,
          slug: t.slug,
          title: t.title,
          examBoard: t.examBoard,
          region: t.region,
        }))}
      />
    </main>
  );
}
