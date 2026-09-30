'use client';

import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  LoadingState,
} from '@friday/ui';
import { CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import {
  getOfferings,
  getRevenueCatClient,
  isFridayProActive,
  purchasePackage,
} from '@/lib/revenuecat';
import type { Offering, Package } from '@revenuecat/purchases-js';

function formatPackageTitle(pkg: Package): string {
  const id = pkg.identifier.toLowerCase();
  const type = pkg.packageType.toLowerCase();

  if (id.includes('monthly') || type.includes('monthly') || type === '$rc_monthly') {
    return 'Monthly';
  }
  if (id.includes('annual') || id.includes('yearly') || type.includes('annual') || type === '$rc_annual') {
    return 'Yearly';
  }
  if (id.includes('lifetime') || type.includes('lifetime') || type === '$rc_lifetime') {
    return 'Lifetime';
  }
  return pkg.identifier;
}

export function BillingClient() {
  const [isPro, setIsPro] = useState<boolean | null>(null);
  const [offering, setOffering] = useState<Offering | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const active = await isFridayProActive();
      setIsPro(active);

      const offerings = await getOfferings();
      if (offerings && offerings.current) {
        setOffering(offerings.current);
      } else {
        setOffering(null);
      }
    } catch (err: any) {
      console.error('Failed to load RevenueCat data:', err);
      setError(err.message || 'Failed to load subscription offerings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handlePurchase = async (pkg: Package) => {
    setPurchasingId(pkg.identifier);
    setError(null);
    try {
      const updatedInfo = await purchasePackage(pkg);
      if (updatedInfo) {
        const active = updatedInfo.entitlements.active['friday_pro'] !== undefined;
        setIsPro(active);
      }
    } catch (err: any) {
      console.error('Purchase failed:', err);
      setError(err.message || 'Purchase failed. Please try again.');
    } finally {
      setPurchasingId(null);
    }
  };

  const handlePresentPaywall = async () => {
    setError(null);
    try {
      const client = getRevenueCatClient();
      await (client as any).presentPaywall({});
      await loadData();
    } catch (err: any) {
      if (err.errorCode === 1 || err.userCancelled) {
        // User cancelled, ignore
        return;
      }
      console.error('Paywall error:', err);
      setError(err.message || 'Failed to display paywall.');
    }
  };

  if (loading) {
    return <LoadingState title="Loading subscription" lines={2} />;
  }

  const features = [
    'Unlimited AI Learning Coach sessions',
    'Personalized knowledge graph & spaced repetition',
    'Unlimited practice problem generation',
    'Advanced root-cause analytics & evidence citations',
    'Priority model reasoning (Gemini & Claude)',
  ];

  // Map package identifiers safely
  const availablePackages = offering?.availablePackages ?? [];

  return (
    <div className="space-y-6">
      {error && (
        <Callout tone="danger" title="Something went wrong with billing">
          {error}{' '}
          <button
            type="button"
            onClick={() => void loadData()}
            className="font-medium text-foreground underline underline-offset-4"
          >
            Try again
          </button>
          . Your current plan is unchanged.
        </Callout>
      )}

      {/* Pro Status Overview */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CardTitle className="flex items-center gap-2">
                  FRIDAY Pro
                  {isPro && <Sparkles className="size-5 text-warning" aria-hidden />}
                </CardTitle>
                <Badge variant={isPro ? 'success' : 'neutral'}>
                  {isPro ? 'Active' : 'Free Tier'}
                </Badge>
              </div>
              <CardDescription>
                {isPro
                  ? 'You have full access to FRIDAY Pro features.'
                  : 'Upgrade to unlock full AI capabilities, custom scheduling, and priority reasoning.'}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="border-t border-border pt-4">
            <h3 className="mb-3 text-sm font-medium text-foreground">Pro Included Features</h3>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-sm text-muted-foreground">
              {features.map((feature) => (
                <li key={feature} className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* RevenueCat Native Paywall Trigger */}
      {!isPro && (
        <Card className="border-border bg-ai-surface">
          <CardHeader>
            <CardTitle>Upgrade to Pro</CardTitle>
            <CardDescription>
              Check out with FRIDAY&apos;s secure payment experience.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handlePresentPaywall} className="w-full sm:w-auto">
              <Sparkles className="mr-2 size-4" aria-hidden />
              See Pro plans
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Available Plans / Packages */}
      {!isPro && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Available Plans</h2>
          {availablePackages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No subscription packages currently available from RevenueCat.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {availablePackages.map((pkg) => (
                <Card key={pkg.identifier} className="flex flex-col justify-between">
                  <CardHeader>
                    <CardTitle>{formatPackageTitle(pkg)}</CardTitle>
                    <CardDescription>{(pkg as any).rcBillingProduct?.description || 'Access FRIDAY Pro'}</CardDescription>
                    <div className="mt-2 text-2xl font-bold">
                      {(pkg as any).rcBillingProduct?.currentPrice?.formattedPrice || 'Custom Price'}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <Button
                      onClick={() => handlePurchase(pkg)}
                      disabled={purchasingId !== null}
                      className="w-full"
                    >
                      {purchasingId === pkg.identifier ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        `Subscribe`
                      )}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
