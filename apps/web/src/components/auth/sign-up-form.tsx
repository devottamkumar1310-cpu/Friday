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

      <div className="space-y-4">
        <a href="/api/v1/auth/google" className="block w-full">
          <Button variant="secondary" type="button" className="w-full flex items-center justify-center gap-2">
            <svg className="size-4 shrink-0" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            Continue with Google
          </Button>
        </a>

        <div className="relative flex items-center justify-center">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
          <span className="relative bg-background px-3 text-xs uppercase tracking-wider text-muted-foreground">
            Or continue with email
          </span>
        </div>
      </div>

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
          requires verifiable guardian consent under 18.
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
