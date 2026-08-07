import { Suspense } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SkeletonText } from '@friday/ui';
import { SignInForm } from '@/components/auth/sign-in-form';
import { getCurrentUser } from '@/lib/auth/server';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage() {
  // Checked here rather than in middleware, which can only see that a cookie
  // exists. A stale cookie sent here used to bounce to /dashboard, which
  // bounced straight back — an unbreakable redirect loop for exactly the people
  // who most need this page.
  if (await getCurrentUser()) redirect('/dashboard');

  return (
    // useSearchParams needs a Suspense boundary to keep the route statically
    // renderable up to the point where the query string matters.
    <Suspense fallback={<SkeletonText lines={5} />}>
      <SignInForm />
    </Suspense>
  );
}
