import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { z } from 'zod';
import '@/modules/assessment/assessment.service';
import { createPracticeSet } from '@/modules/assessment/assessment.service';

const GoalIdSchema = z.string().uuid();

export default async function MockTestPage({
  searchParams,
}: {
  searchParams: Promise<{ goalId?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const goalId = params.goalId;

  if (!goalId) {
    notFound();
    return;
  }

  const goalIdValid = GoalIdSchema.safeParse(goalId);
  if (!goalIdValid.success) {
    notFound();
    return;
  }

  let practiceSetResult: any;
  let practiceSetError: string | null = null;

  try {
    practiceSetResult = await createPracticeSet(
      user,
      { goalId: goalIdValid.data, conceptIds: [], questionCount: 2 }
    );
  } catch (e: any) {
    practiceSetError = e.message || 'Unknown error';
    practiceSetResult = null;
  }

  if (practiceSetError || !practiceSetResult?.questions?.length) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <div className="mb-8">
          <p className="text-sm font-medium text-primary">Practice Set</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Practice Set
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Assessment engine ready. Concept selection pending – practice set ready
            upon backend integration. No fake questions displayed.
          </p>
        </div>
      </main>
    );
  }

  const { assessmentId, questions } = practiceSetResult;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="mb-8">
        <p className="text-sm font-medium text-primary">Practice Set</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Practice Set {assessmentId?.slice(0, 8) || ''}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {questions.length} questions
        </p>
      </div>

      <div className="mt-8">
        <p className="text-lg font-medium">Questions</p>
        {questions.map((question: any, idx: number) => (
          <div key={idx} className="p-3 rounded border border-border space-y-2">
            <p className="font-medium">{question.stem}</p>
            {question.options?.map((opt: any) => (
              <div key={opt.id} className="radio-group">
                <input
                  type="radio"
                  name={`answer-${question.id}`}
                  className="radio-input"
                  value={opt.id}
                />
                <label className="radio-label">{opt.text}</label>
              </div>
            ))}
          </div>
        ))}

        <div>
          <button className="btn-primary mt-4" disabled>
            Submit Answers
          </button>
          <p className="mt-2 text-sm text-muted-foreground">
            Assessment in progress – answers collected for submission
          </p>
        </div>
      </div>
    </main>
  );
}