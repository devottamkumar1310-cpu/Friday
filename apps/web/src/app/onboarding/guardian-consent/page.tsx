import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { GuardianConsentForm } from '@/components/onboarding/guardian-consent-form';
import { requireUser } from '@/lib/auth/server';
import { getMePayload } from '@/modules/identity/identity.service';

export const metadata: Metadata = { title: 'Guardian consent' };

export default async function GuardianConsentPage() {
  const user = await requireUser();
  const { onboarding } = await getMePayload(user);

  // Already past this gate — do not show a consent form to someone who does not
  // need it, or who has already given it.
  if (onboarding.blockedBy !== 'guardian_consent') redirect('/dashboard');

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md items-center px-6 py-12">
      <div className="w-full">
        <GuardianConsentForm />
      </div>
    </main>
  );
}
