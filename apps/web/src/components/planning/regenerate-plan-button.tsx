'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { ApiClientError } from '@friday/contracts';
import { Button, Spinner, toast } from '@friday/ui';
import { api } from '@/lib/api/client';

/**
 * Manual re-plan (M0 §1.1 — the nightly cron is Phase 3 of the roadmap).
 *
 * The interesting case is the one that changes nothing: §10.3's materiality
 * gate discards a candidate plan whose drift is below threshold. Reporting that
 * honestly — rather than pretending something happened — is the point. Nightly
 * re-planning that *usually changes nothing* is the design goal.
 */
export function RegeneratePlanButton({ goalId }: { goalId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function regenerate() {
    setBusy(true);
    try {
      const result = await api.call('regeneratePlan', {
        params: { goalId },
        body: { reason: 'user_request' },
      });

      if (result.data.committed) {
        toast.success(`Plan updated to version ${result.data.plan?.version ?? '?'}.`);
        router.refresh();
      } else {
        toast('Nothing changed — your current plan is still the right one.', {
          description: 'FRIDAY only rewrites the plan when the difference is material.',
        });
      }
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : 'Could not regenerate the plan.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={regenerate} disabled={busy}>
      {busy ? (
        <Spinner label="Re-planning…" />
      ) : (
        <>
          <RefreshCw className="size-4" aria-hidden /> Re-plan
        </>
      )}
    </Button>
  );
}
