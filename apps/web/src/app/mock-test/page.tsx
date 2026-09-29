import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { listGoals, getGraph } from '@/modules/curriculum/curriculum.service';
import { MockTestStarter } from './mock-test-starter';

export default async function MockTestPage() {
  const user = await requireUser();
  const goals = await listGoals(user);
  const goal = goals.find((g) => g.status === 'active') ?? goals[0];
  
  if (!goal) {
    notFound();
    return;
  }

  const { concepts } = await getGraph(user, goal.id);
  const conceptIds = concepts.map(c => c.id);

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mock Test</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Take a full-length mock exam to evaluate your overall readiness.
        </p>
      </div>

      <MockTestStarter goalId={goal.id} conceptIds={conceptIds} />
    </main>
  );
}