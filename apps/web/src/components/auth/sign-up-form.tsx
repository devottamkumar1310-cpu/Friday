'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ERROR_CODES, SignUpRequestSchema, type SignUpRequest } from '@friday/contracts';
import { ApiClientError } from '@friday/contracts';
import { Button, ErrorState, Field, Input } from '@friday/ui';
import { api } from '@/lib/api/client';

/** Detected rather than asked. The learner can change it later in settings. */
function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function SignUpForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<{ message: string; requestId?: string } | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignUpRequest>({
    resolver: zodResolver(SignUpRequestSchema),
    defaultValues: { timezone: detectTimezone() },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.call('signUp', { body: values });
      // The server decides where to go next based on the consent gate, so land
      // on the dashboard and let it redirect rather than guessing here.
      router.push('/dashboard');
      router.refresh();
    } catch (error) {
      if (!(error instanceof ApiClientError)) {
        setFormError({ message: 'Could not reach the server. Check your connection.' });
        return;
      }

      switch (error.code) {
        case ERROR_CODES.EMAIL_IN_USE:
          setError('email', { message: 'An account already exists for this email.' });
          break;
        case ERROR_CODES.UNDER_MINIMUM_AGE:
          setError('dateOfBirth', { message: error.message });
          break;
        case ERROR_CODES.WEAK_PASSWORD:
          setError('password', { message: error.message });
          break;
        default:
          setFormError({ message: error.message, requestId: error.requestId });
      }
    }
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted-foreground">
          Takes about a minute. You will set up your first goal next.
        </p>
      </div>

      {formError && <ErrorState description={formError.message} requestId={formError.requestId} />}

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Name" htmlFor="displayName" error={errors.displayName?.message} required>
          <Input
            id="displayName"
            autoComplete="name"
            invalid={!!errors.displayName}
            {...register('displayName')}
          />
        </Field>

        <Field label="Email" htmlFor="email" error={errors.email?.message} required>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            invalid={!!errors.email}
            {...register('email')}
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          hint="At least 10 characters."
          error={errors.password?.message}
          required
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            invalid={!!errors.password}
            {...register('password')}
          />
        </Field>

        {/*
          Collected at sign-up rather than later (FR-1.6). India's DPDP Act
          requires verifiable guardian consent under 18, and the learners FRIDAY
          is built for are mostly 16–18 — so this is the common path, not an edge
          case, and asking after an account exists would be too late.
        */}
        <Field
          label="Date of birth"
          htmlFor="dateOfBirth"
          hint="We ask because under-18 accounts need a parent or guardian's consent."
          error={errors.dateOfBirth?.message}
          required
        >
          <Input
            id="dateOfBirth"
            type="date"
            autoComplete="bday"
            invalid={!!errors.dateOfBirth}
            {...register('dateOfBirth')}
          />
        </Field>

        <input type="hidden" {...register('timezone')} />

        <Button type="submit" className="w-full" loading={isSubmitting}>
          Create account
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/sign-in" className="text-primary underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
