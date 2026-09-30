'use client';

import { useEffect, useState } from 'react';
import { initializeRevenueCat } from '@/lib/revenuecat';

export function RevenueCatProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (userId && !initialized) {
      initializeRevenueCat(userId);
      setInitialized(true);
    }
  }, [userId, initialized]);

  return <>{children}</>;
}
