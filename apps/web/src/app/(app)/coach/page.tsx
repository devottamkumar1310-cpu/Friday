import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CoachChat } from '@/components/coach/coach-chat';
import { requireOnboardedUser } from '@/lib/auth/server';
import { listGoals } from '@/modules/curriculum/curriculum.service';
import { createThread, getThread, listThreads } from '@/modules/coach/coach.service';

export const metadata: Metadata = { title: 'Coach' };

export default async function CoachPage() {
  const user = await requireOnboardedUser();
  const goals = await listGoals(user);
  const goal = goals.find((g) => g.status === 'active') ?? goals[0];
  if (!goal) redirect('/onboarding/availability');

  // One rolling thread keeps the surface simple. Thread management (list,
  // rename, archive) has API support already and is a UI addition, not a
  // backend change, whenever it earns its place.
  const threads = await listThreads(user);
  const thread = threads[0] ?? (await createThread(user, goal.id));
  const { messages } = await getThread(user, thread.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Coach</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Grounded in your actual plan and mastery — no context to re-explain.
        </p>
      </div>

      <CoachChat
        threadId={thread.id}
        initialMessages={messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            createdAt: m.createdAt.toISOString(),
          }))}
      />
    </div>
  );
}
