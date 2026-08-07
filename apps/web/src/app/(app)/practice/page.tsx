import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@friday/ui';
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Practice</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Answering questions tells FRIDAY far more than rating yourself does — it is the strongest
          evidence the engine accepts.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pick what to practise</CardTitle>
          <CardDescription>
            Ranked by what it costs to leave weak — exam weight, how far off you are, and how much
            else depends on it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PracticeStarter
            goalId={goal.id}
            concepts={weak.map((w) => ({
              id: w.conceptId,
              title: w.title,
              mastery: w.mastery,
              provisional: w.evidence.provisional,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
