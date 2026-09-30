import type { Metadata } from 'next';
import type { JSX } from 'react';
import { PageHeader } from '@friday/ui';
import { requireUser } from '@/lib/auth/server';
import { BillingClient } from '@/components/billing/billing-client';

export const metadata: Metadata = { title: 'Billing' };

export default async function BillingPage(): Promise<JSX.Element> {
  await requireUser();

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader
        title="Billing"
        description="The core adaptive engine is free forever. FRIDAY Pro unlocks the full intelligence layer."
      />

      {/* Free vs Pro — a divider, not cards. */}
      <div className="flex items-start gap-0 divide-x divide-border rounded-xl border border-border bg-surface px-6 py-5">
        <div className="pr-6">
          <p className="text-sm font-medium text-foreground">
            Core adaptive engine
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Free forever</p>
        </div>
        <div className="pl-6">
          <p className="text-sm font-medium text-foreground">
            Coach &amp; advanced analysis
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">FRIDAY Pro</p>
        </div>
      </div>

      <BillingClient />
    </div>
  );
}
