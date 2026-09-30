import { Purchases } from '@revenuecat/purchases-js';
import type { CustomerInfo, Offerings } from '@revenuecat/purchases-js';

let purchasesInstance: Purchases | null = null;

export function initializeRevenueCat(userId: string) {
  if (typeof window === 'undefined') return;
  const apiKey = process.env.NEXT_PUBLIC_REVENUECAT_WEB_API_KEY;
  if (!apiKey) {
    console.error('RevenueCat Web API key is missing');
    return;
  }
  if (purchasesInstance) return;

  // @revenuecat/purchases-js 1.x API for web
  purchasesInstance = Purchases.configure(apiKey, userId);
}

export function getRevenueCatClient(): Purchases {
  if (!purchasesInstance) {
    throw new Error('RevenueCat not initialized');
  }
  return purchasesInstance;
}

export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (!purchasesInstance) return null;
  try {
    return await purchasesInstance.getCustomerInfo();
  } catch (error) {
    console.error('Failed to get customer info:', error);
    return null;
  }
}

export async function getOfferings(): Promise<Offerings | null> {
  if (!purchasesInstance) return null;
  try {
    return await purchasesInstance.getOfferings();
  } catch (error) {
    console.error('Failed to get offerings:', error);
    return null;
  }
}

export async function isFridayProActive(): Promise<boolean> {
  const info = await getCustomerInfo();
  if (!info) return false;
  return info.entitlements.active['friday_pro'] !== undefined;
}

export async function purchasePackage(pkg: any) {
  if (!purchasesInstance) throw new Error('RevenueCat not initialized');
  try {
    const { customerInfo } = await purchasesInstance.purchasePackage(pkg);
    return customerInfo;
  } catch (error: any) {
    if (error.userCancelled) {
      console.log('User cancelled purchase');
      return null;
    }
    throw error;
  }
}
