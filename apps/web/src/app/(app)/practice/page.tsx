import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EmptyState, PageHeader } from '@friday/ui';
import { requireOnboardedUser } from '@/lib/auth/server';
import { listGoals } from '@/modules/curriculum/curriculum.service';
import { getWeakConcepts } from '@/modules/intelligence/intelligence.service';
import { PracticeStarter } from '@/components/practice/practice-starter';

export const metadata: Metadata = { title: 'Practice' };

export default async function PracticePage() {
  const user = await requireOnboardedUser();
  const goals = await listGoals(user);
  const goal = goals.find((g) => g.status === 'active') ?? goals[0];
  if (!goal) redirect('/onboarding/availability');

  // Weak concepts first — practice is most valuable where the gap is, and
  // retrieval produces far stronger evidence than a self-rating (§5.2).
  const weak = await getWeakConcepts(user, goal.id, 8);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader
        title="Practice"
        description="Answering questions teaches FRIDAY more about your understanding than rating yourself does. Your weakest concepts come first."
      />

      {weak.length === 0 ? (
        <EmptyState
          title="No concepts ready to practise yet"
          description="FRIDAY needs more study sessions before it can identify concepts to practise. Start a session from Mission Control."
          action={{ label: 'Go to Mission Control', href: '/dashboard' }}
        />
      ) : (
        /*
          The card chrome moved inside `PracticeStarter`, which drops it once a
          set is running. A page header, a paragraph, a card header and a second
          paragraph all used to stay on screen while the learner was mid-question.
        */
        <>
          <PracticeStarter
            goalId={goal.id}
            concepts={weak.map((w) => ({
              id: w.conceptId,
              title: w.title,
              mastery: w.mastery,
              provisional: w.evidence.provisional,
            }))}
          />
          <p className="text-center text-sm text-muted-foreground">
            Need a full exam instead?{' '}
            <Link href="/mock-test" className="font-medium text-primary hover:underline">
              Take a mock test
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
