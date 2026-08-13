import type { Metadata } from 'next';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@friday/ui';
import { CheckCircle2 } from 'lucide-react';
import { requireUser } from '@/lib/auth/server';

export const metadata: Metadata = { title: 'Billing & Plan' };

export default async function BillingPage() {
  await requireUser();

  const currentPlan = {
    name: 'Beta Access',
    status: 'Active',
    price: 'Free during Beta',
    renewalDate: 'Public Beta Period',
    features: [
      'Unlimited AI Learning Coach sessions',
      'Personalized knowledge graph & spaced repetition',
      'Unlimited practice problem generation',
      'Advanced root-cause analytics & evidence citations',
      'Priority model reasoning (Gemini & Claude)',
    ],
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing & Subscriptions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your plan, payment methods, and invoice history.
        </p>
      </div>

      <div className="rounded-lg border border-sky-500/20 bg-sky-500/10 p-4 text-sm text-sky-800 dark:text-sky-300">
        <p className="font-semibold">FRIDAY Public Beta</p>
        <p className="mt-0.5 text-xs text-sky-700 dark:text-sky-400">
          All core features are complimentary during the Public Beta period. Paid subscription
          management is currently disabled.
        </p>
      </div>

      {/* Active Plan Overview */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CardTitle>{currentPlan.name}</CardTitle>
                <Badge variant="success">{currentPlan.status}</Badge>
              </div>
              <CardDescription>Full access enabled for Public Beta testers.</CardDescription>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold tracking-tight">{currentPlan.price}</div>
              <span className="text-xs text-muted-foreground">No credit card required</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="border-t border-border pt-4">
            <h3 className="mb-3 text-sm font-medium text-foreground">Included Features</h3>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-sm text-muted-foreground">
              {currentPlan.features.map((feature) => (
                <li key={feature} className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button variant="secondary" size="sm" disabled>
              Manage Subscription (Coming Soon)
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
