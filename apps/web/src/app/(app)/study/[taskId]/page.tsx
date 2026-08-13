import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StudySession } from '@/components/study/study-session';
import { requireOnboardedUser } from '@/lib/auth/server';
import { getStudyTask } from '@/modules/planning/planning.service';

export const metadata: Metadata = { title: 'Study' };

export default async function StudyPage({ params }: { params: Promise<{ taskId: string }> }) {
  const user = await requireOnboardedUser();
  const { taskId } = await params;

  let data;
  try {
    data = await getStudyTask(user, taskId);
  } catch {
    // Not found, or not this learner's task — indistinguishable by design
    // (API_SPECIFICATION §4.4: a 403 would leak existence).
    notFound();
  }

  return (
    <StudySession
      taskId={data.task.id}
      goalId={data.goalId}
      taskTitle={data.task.title}
      taskType={data.task.type}
      estimatedMinutes={data.task.estimatedMinutes}
      concepts={data.concepts}
      existingSessionId={data.activeSessionId}
      existingSessionStartedAt={data.activeSessionStartedAt}
    />
  );
}
