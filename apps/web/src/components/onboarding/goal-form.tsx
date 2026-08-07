'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ApiClientError,
  CreateGoalRequestSchema,
  ERROR_CODES,
  type CreateGoalRequest,
} from '@friday/contracts';
import { Button, Callout, Card, CardContent, Field, Input, Select, Spinner } from '@friday/ui';
import { api } from '@/lib/api/client';

export interface TemplateOption {
  id: string;
  slug: string;
  title: string;
  examBoard: string | null;
  region: string | null;
}

/** A year out is the common case for an exam goal, and a sane default beats an empty field. */
function defaultTargetDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function GoalForm({ templates }: { templates: TemplateOption[] }) {
  const router = useRouter();
  const [formError, setFormError] = useState<{ message: string; requestId?: string } | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateGoalRequest>({
    resolver: zodResolver(CreateGoalRequestSchema),
    defaultValues: {
      type: 'exam',
      targetDate: defaultTargetDate(),
      targetWeeklyMinutes: 600,
      templateSlug: templates[0]?.slug ?? '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.call('createGoal', { body: values });
      // Goal creation also generates the first plan, so the dashboard has
      // something real to show the moment we land on it.
      router.push('/dashboard');
      router.refresh();
    } catch (error) {
      if (!(error instanceof ApiClientError)) {
        setFormError({ message: 'Could not reach the server. Check your connection.' });
        return;
      }

      switch (error.code) {
        case ERROR_CODES.TARGET_DATE_IN_PAST:
          setError('targetDate', { message: 'Pick a date in the future.' });
          break;
        case ERROR_CODES.NO_AVAILABILITY_DEFINED:
          // The scheduler cannot invent capacity (E-6). Send them to fix it
          // rather than failing with an error they cannot act on.
          router.push('/onboarding/availability');
          break;
        case ERROR_CODES.TEMPLATE_NOT_FOUND:
          setError('templateSlug', { message: 'That curriculum is no longer available.' });
          break;
        default:
          setFormError({ message: error.message, requestId: error.requestId });
      }
    }
  });

  if (templates.length === 0) {
    return (
      <Callout tone="warning" title="No curriculum templates are published">
        FRIDAY needs a curriculum to plan against. Ask an administrator to publish one, or seed the
        development data.
      </Callout>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {formError && (
        <Callout tone="danger" title="Could not create your goal">
          {formError.message}
          {formError.requestId ? (
            <span className="mt-1 block font-mono text-xs">Reference: {formError.requestId}</span>
          ) : null}
        </Callout>
      )}

      <Field
        label="What are you working towards?"
        htmlFor="title"
        required
        error={errors.title?.message}
        hint="The exam or outcome you are aiming for."
      >
        <Input id="title" placeholder="JEE Advanced 2027" autoFocus {...register('title')} />
      </Field>

      <Field
        label="Curriculum"
        htmlFor="templateSlug"
        required
        error={errors.templateSlug?.message}
        hint="FRIDAY builds your plan from this syllabus."
      >
        <Select id="templateSlug" {...register('templateSlug')}>
          {templates.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.title}
              {t.examBoard ? ` · ${t.examBoard}` : ''}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Goal type" htmlFor="type" required error={errors.type?.message}>
          <Select id="type" {...register('type')}>
            <option value="exam">Exam</option>
            <option value="skill">Skill</option>
            <option value="course">Course</option>
            <option value="custom">Custom</option>
          </Select>
        </Field>

        <Field
          label="Target date"
          htmlFor="targetDate"
          required
          error={errors.targetDate?.message}
          hint="Everything is planned backwards from here."
        >
          <Input id="targetDate" type="date" min={tomorrow()} {...register('targetDate')} />
        </Field>
      </div>

      <Field
        label="Hours you can study each week"
        htmlFor="targetWeeklyMinutes"
        required
        error={errors.targetWeeklyMinutes?.message}
        hint="An honest number. FRIDAY plans against what you actually do, and adjusts as it learns."
      >
        <Select
          id="targetWeeklyMinutes"
          {...register('targetWeeklyMinutes', { valueAsNumber: true })}
        >
          <option value={300}>5 hours a week</option>
          <option value={600}>10 hours a week</option>
          <option value={900}>15 hours a week</option>
          <option value={1200}>20 hours a week</option>
          <option value={1800}>30 hours a week</option>
        </Select>
      </Field>

      <Field
        label="How much do you already know?"
        htmlFor="selfReportedLevel"
        error={errors.selfReportedLevel?.message}
        hint="A starting guess only. FRIDAY corrects it from evidence as soon as you study."
      >
        {/*
          "Prefer not to say" is the default, and a native select reports it as
          `""` — which is not a member of the enum and not `undefined` either,
          so the form failed validation before it could ever be submitted. The
          field is optional in the contract; absent has to mean absent.
        */}
        <Select
          id="selfReportedLevel"
          {...register('selfReportedLevel', {
            setValueAs: (v: string) => (v === '' ? undefined : v),
          })}
        >
          <option value="">Prefer not to say</option>
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </Select>
      </Field>

      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          When you continue, FRIDAY builds your curriculum, works out whether the deadline is
          reachable, and generates a two-week plan. That takes a few seconds.
        </CardContent>
      </Card>

      <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
        {isSubmitting ? <Spinner label="Building your plan…" /> : 'Create goal and build my plan'}
      </Button>
    </form>
  );
}
