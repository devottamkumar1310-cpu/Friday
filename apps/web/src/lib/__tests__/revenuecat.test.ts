import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@revenuecat/purchases-js', () => {
  const mockGetCustomerInfo = vi.fn();
  const mockGetOfferings = vi.fn();
  const mockPurchasePackage = vi.fn();

  const mockConfigure = vi.fn(() => ({
    getCustomerInfo: mockGetCustomerInfo,
    getOfferings: mockGetOfferings,
    purchasePackage: mockPurchasePackage,
  }));

  return {
    Purchases: {
      configure: mockConfigure,
    },
    mockGetCustomerInfo,
    mockGetOfferings,
    mockPurchasePackage,
    mockConfigure,
  };
});

import { Purchases } from '@revenuecat/purchases-js';
import {
  initializeRevenueCat,
  isFridayProActive,
  purchasePackage,
} from '../revenuecat';

describe('RevenueCat Integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    // Mock window object
    globalThis.window = {} as any;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('handles missing API key gracefully', () => {
    delete process.env.NEXT_PUBLIC_REVENUECAT_WEB_API_KEY;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    initializeRevenueCat('test-user');
    expect(consoleSpy).toHaveBeenCalledWith('RevenueCat Web API key is missing');
  });

  it('initializes with appUserId when API key is provided', () => {
    process.env.NEXT_PUBLIC_REVENUECAT_WEB_API_KEY = 'test_key';
    initializeRevenueCat('test-user-123');

    expect(Purchases.configure).toHaveBeenCalledWith('test_key', 'test-user-123');
  });

  it('determines when friday_pro entitlement is active', async () => {
    process.env.NEXT_PUBLIC_REVENUECAT_WEB_API_KEY = 'test_key';
    initializeRevenueCat('test-user-123');

    const rcModule = await import('@revenuecat/purchases-js');
    const mockClient = (rcModule.Purchases.configure as any)();
    mockClient.getCustomerInfo.mockResolvedValueOnce({
      entitlements: {
        active: {
          friday_pro: { identifier: 'friday_pro' },
        },
      },
    });

    const active = await isFridayProActive();
    expect(active).toBe(true);
  });

  it('determines when friday_pro entitlement is inactive', async () => {
    process.env.NEXT_PUBLIC_REVENUECAT_WEB_API_KEY = 'test_key';
    initializeRevenueCat('test-user-123');

    const rcModule = await import('@revenuecat/purchases-js');
    const mockClient = (rcModule.Purchases.configure as any)();
    mockClient.getCustomerInfo.mockResolvedValueOnce({
      entitlements: {
        active: {},
      },
    });

    const active = await isFridayProActive();
    expect(active).toBe(false);
  });

  it('handles user purchase cancellation', async () => {
    process.env.NEXT_PUBLIC_REVENUECAT_WEB_API_KEY = 'test_key';
    initializeRevenueCat('test-user-123');

    const rcModule = await import('@revenuecat/purchases-js');
    const mockClient = (rcModule.Purchases.configure as any)();

    const cancelError = new Error('User cancelled');
    (cancelError as any).userCancelled = true;

    mockClient.purchasePackage.mockRejectedValueOnce(cancelError);

    const result = await purchasePackage({ identifier: 'monthly' });
    expect(result).toBeNull();
  });
});
