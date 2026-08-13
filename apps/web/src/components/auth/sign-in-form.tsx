'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ApiClientError,
  ERROR_CODES,
  SignInRequestSchema,
  type SignInRequest,
} from '@friday/contracts';
import { Button, Callout, ErrorState, Field, Input } from '@friday/ui';
import { api } from '@/lib/api/client';

/**
 * A rejected password is not an error.
 *
 * It used to be presented as one: a red panel, a warning triangle, the words
 * "Something went wrong", and a request UUID underneath. To someone who simply
 * mistyped, that reads as *the site* being broken rather than the attempt being
 * wrong — and a reference code is intimidating noise when there is nothing to
 * report. Expected outcomes get a plain sentence; only genuine faults get the
 * panel and the id support would actually need.
 */
const EXPECTED = new Set<string>([
  ERROR_CODES.INVALID_CREDENTIALS,
  ERROR_CODES.EMAIL_NOT_VERIFIED,
  ERROR_CODES.RATE_LIMITED,
]);

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formError, setFormError] = useState<{
    message: string;
    requestId?: string;
    expected: boolean;
  } | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInRequest>({ resolver: zodResolver(SignInRequestSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.call('signIn', { body: values });

      // Only follow `next` when it is a local path — an open redirect here
      // would hand an attacker a credible-looking phishing hop.
      const next = searchParams.get('next');
      const destination = next?.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';

      router.push(destination);
      router.refresh();
    } catch (error) {
      if (!(error instanceof ApiClientError)) {
        setFormError({
          message: 'Could not reach the server. Check your connection and try again.',
          expected: true,
        });
        return;
      }

      const expected = EXPECTED.has(error.code);
      setFormError({
        // Deliberately does not say which of the two was wrong: naming the
        // email would confirm to a stranger that an account exists.
        message:
          error.code === ERROR_CODES.INVALID_CREDENTIALS
            ? 'Incorrect email or password.'
            : error.message,
        expected,
        ...(expected ? {} : { requestId: error.requestId }),
      });
    }
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Pick up where you left off.</p>
      </div>

      {formError &&
        (formError.expected ? (
          // `title` rather than children: children render muted, and an error
          // the learner must act on should not be the quietest text on screen.
          <Callout tone="danger" title={formError.message} />
        ) : (
          <ErrorState description={formError.message} requestId={formError.requestId} />
        ))}

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="email" error={errors.email?.message} required>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            invalid={!!errors.email}
            {...register('email')}
          />
        </Field>

        <Field label="Password" htmlFor="password" error={errors.password?.message} required>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            invalid={!!errors.password}
            {...register('password')}
          />
        </Field>

        <Button type="submit" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        New here?{' '}
        <Link href="/sign-up" className="text-primary underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </div>
  );
}
