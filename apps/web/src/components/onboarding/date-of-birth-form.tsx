'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ApiClientError, DateOnlySchema, ERROR_CODES, z } from '@friday/contracts';
import { Button, Card, CardContent, ErrorState, Field, Input } from '@friday/ui';
import { api } from '@/lib/api/client';

const FormSchema = z.object({ dateOfBirth: DateOnlySchema });
type FormValues = z.infer<typeof FormSchema>;

/**
 * Captures date of birth for accounts created without it — today that means
 * OAuth sign-ups, where the user row exists from the callback, before any form
 * has been shown. Email sign-up collects it inline (FR-1.6).
 */
export function DateOfBirthForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(FormSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.call('updateMe', { body: { dateOfBirth: values.dateOfBirth } });
      router.push('/dashboard');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError && error.code === ERROR_CODES.UNDER_MINIMUM_AGE) {
        setError('dateOfBirth', { message: error.message });
        return;
      }
      setFormError(
        error instanceof ApiClientError ? error.message : 'Could not save that. Please try again.',
      );
    }
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">How old are you?</h1>
        <p className="text-sm text-muted-foreground">
          We need this to know whether your account requires a guardian&apos;s consent. You can only
          set it once.
        </p>
      </div>

      {formError && <ErrorState description={formError} />}

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Field
              label="Date of birth"
              htmlFor="dateOfBirth"
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

            <Button type="submit" className="w-full" loading={isSubmitting}>
              Continue
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
