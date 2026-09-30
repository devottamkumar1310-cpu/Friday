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
    <main id="main" className="min-h-dvh bg-background flex items-start justify-center px-6 py-16">
      <div className="w-full max-w-2xl">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Setting up your system
            </span>
            <span className="text-xs text-muted-foreground">— Step 2 of 2</span>
          </div>
          <div className="flex gap-1.5">
            <div className="h-1 flex-1 rounded-full bg-primary" />
            <div className="h-1 flex-1 rounded-full bg-primary" />
          </div>
        </div>

        {/* Header */}
        <div className="mb-10 space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">What are you working towards?</h1>
          <p className="text-base text-muted-foreground leading-relaxed max-w-lg">
            FRIDAY plans backwards from your deadline and forwards from what you know.
          </p>
          <p className="text-sm text-subtle-foreground bg-surface border border-border rounded-lg px-4 py-3">
            <strong className="text-foreground">Why this matters:</strong> Your exam date and curriculum determine
            how FRIDAY allocates urgency. Both can be changed later.
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
      </div>
    </main>
  );
}
