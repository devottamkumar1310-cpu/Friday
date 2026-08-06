'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { Button, toast } from '@friday/ui';
import { api } from '@/lib/api/client';

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <Button
      variant="ghost"
      size="sm"
      loading={pending}
      onClick={async () => {
        setPending(true);
        try {
          await api.call('signOut', {});
          router.push('/sign-in');
          router.refresh();
        } catch {
          toast.error('Could not sign out. Please try again.');
          setPending(false);
        }
      }}
    >
      <LogOut aria-hidden />
      Sign out
    </Button>
  );
}
