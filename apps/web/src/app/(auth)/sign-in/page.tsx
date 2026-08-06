import { Suspense } from 'react';
import type { Metadata } from 'next';
import { SkeletonText } from '@friday/ui';
import { SignInForm } from '@/components/auth/sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    // useSearchParams needs a Suspense boundary to keep the route statically
    // renderable up to the point where the query string matters.
    <Suspense fallback={<SkeletonText lines={5} />}>
      <SignInForm />
    </Suspense>
  );
}
