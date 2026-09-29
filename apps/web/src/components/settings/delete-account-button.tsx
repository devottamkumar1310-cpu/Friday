'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Spinner, toast } from '@friday/ui';
import { AlertTriangle } from 'lucide-react';

export function DeleteAccountButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch('/api/v1/me', { method: 'DELETE' });
      if (!res.ok) {
        throw new Error('Account deletion failed.');
      }
      toast.success('Your account has been deleted.');
      router.push('/sign-in');
    } catch {
      toast.error('Could not delete account. Please try again.');
      setDeleting(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 space-y-3">
        <div className="flex items-start gap-3 text-red-700 dark:text-red-400">
          <AlertTriangle className="size-5 shrink-0 mt-0.5" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold">Are you absolutely sure?</p>
            <p className="text-xs text-red-600 dark:text-red-300">
              This action cannot be undone. All your goals, study sessions, learning progress, and
              personal data will be permanently removed.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 pt-1">
          <Button
            variant="destructive"
            size="sm"
            className="h-11 px-4"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? <Spinner label="Deleting account…" /> : 'Yes, delete my account'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-11 px-4"
            onClick={() => setConfirming(false)}
            disabled={deleting}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button
      variant="destructive"
      size="sm"
      className="h-11 px-4"
      onClick={() => setConfirming(true)}
    >
      Delete Account
    </Button>
  );
}
