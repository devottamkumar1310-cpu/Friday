import { notFound } from 'next/navigation';
import { PageHeader } from '@friday/ui';
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
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader
        eyebrow={goal.title}
        title="Mock test"
        description="A full-length exam across your entire curriculum. Treat it like the real thing — FRIDAY learns from every answer."
      />

      <MockTestStarter goalId={goal.id} conceptIds={conceptIds} />
    </div>
  );
}