'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ApiClientError, EmailSchema, z } from '@friday/contracts';
import { Button, Card, CardContent, ErrorState, Field, Input } from '@friday/ui';
import { api } from '@/lib/api/client';

const FormSchema = z.object({
  guardianEmail: EmailSchema,
  confirmed: z.literal(true, {
    errorMap: () => ({ message: 'Please confirm your parent or guardian agrees.' }),
  }),
});

type FormValues = z.infer<typeof FormSchema>;

/** Version of the consent text being agreed to. Recorded with the grant. */
const CONSENT_VERSION = '2026-07-01';

export function GuardianConsentForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(FormSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.call('recordConsent', {
        body: {
          consentType: 'guardian',
          granted: true,
          version: CONSENT_VERSION,
          guardianEmail: values.guardianEmail,
        },
      });
      router.push('/dashboard');
      router.refresh();
    } catch (error) {
      setFormError(
        error instanceof ApiClientError ? error.message : 'Could not save that. Please try again.',
      );
    }
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">One quick step first</h1>
        <p className="text-sm text-muted-foreground">
          Because you are under 18, we need a parent or guardian&apos;s consent before setting up
          your study plan. This is a legal requirement, not a formality.
        </p>
      </div>

      {formError && <ErrorState description={formError} />}

      <Card>
        <CardContent className="space-y-4 pt-6">
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Field
              label="Parent or guardian's email"
              htmlFor="guardianEmail"
              hint="We will send them a note explaining what FRIDAY does with your data."
              error={errors.guardianEmail?.message}
              required
            >
              <Input
                id="guardianEmail"
                type="email"
                invalid={!!errors.guardianEmail}
                {...register('guardianEmail')}
              />
            </Field>

            <div className="flex gap-2.5">
              <input
                id="confirmed"
                type="checkbox"
                className="mt-0.5 size-4 rounded border-input accent-[var(--primary)]"
                {...register('confirmed')}
              />
              <label htmlFor="confirmed" className="text-sm text-muted-foreground">
                My parent or guardian has read how FRIDAY uses my data and agrees to it.
              </label>
            </div>
            {errors.confirmed && (
              <p role="alert" className="text-xs text-destructive">
                {errors.confirmed.message}
              </p>
            )}

            <Button type="submit" className="w-full" loading={isSubmitting}>
              Continue
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
