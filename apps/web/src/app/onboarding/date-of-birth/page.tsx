import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DateOfBirthForm } from '@/components/onboarding/date-of-birth-form';
import { requireUser } from '@/lib/auth/server';
import { getMePayload } from '@/modules/identity/identity.service';

export const metadata: Metadata = { title: 'Date of birth' };

export default async function DateOfBirthPage() {
  const user = await requireUser();
  const { onboarding } = await getMePayload(user);

  if (onboarding.blockedBy !== 'date_of_birth') redirect('/dashboard');

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md items-center px-6 py-12">
      <div className="w-full">
        <DateOfBirthForm />
      </div>
    </main>
  );
}
