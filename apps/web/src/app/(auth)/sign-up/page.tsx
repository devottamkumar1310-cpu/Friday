import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SignUpForm } from '@/components/auth/sign-up-form';
import { getCurrentUser } from '@/lib/auth/server';

export const metadata: Metadata = { title: 'Create your account' };

export default async function SignUpPage() {
  // Same reasoning as /sign-in: only a real session sends someone away, because
  // middleware can see a cookie but not whether it still means anything.
  if (await getCurrentUser()) redirect('/dashboard');

  return <SignUpForm />;
}
