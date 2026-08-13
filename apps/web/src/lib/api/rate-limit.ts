import type { NextRequest } from 'next/server';
import { ApiError, ERROR_CODES } from '@friday/contracts';

interface RateLimitStore {
  count: number;
  resetAt: number;
}

const stores = new Map<string, RateLimitStore>();

/** Expired keys are swept lazily; a limiter must not become the memory leak. */
const SWEEP_EVERY = 500;
let sinceSweep = 0;

/**
 * Fixed-window rate limiter, in memory.
 *
 * Blunts scripted abuse on the endpoints where it matters — credentials and
 * anything that starts work. Two honest limitations, both acceptable at beta
 * scale and neither safe to forget:
 *
 *  - **Per instance, not global.** On serverless each cold instance keeps its
 *    own map, so the effective ceiling is the configured limit times the number
 *    of live instances. It raises the cost of an attack; it does not cap it.
 *    A shared store (Redis, Upstash) is the real answer when traffic justifies
 *    one.
 *  - **Per IP.** Which is exactly why the limits are not tight — see below.
 */
export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
}

export function checkRateLimit(
  req: NextRequest,
  keyPrefix: string,
  options: RateLimitOptions,
): void {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? '127.0.0.1';
  const key = `${keyPrefix}:${ip}`;
  const now = Date.now();

  // Drop expired windows periodically. Without this the map grows by one entry
  // per unique IP per route, forever, on a long-lived instance.
  sinceSweep += 1;
  if (sinceSweep >= SWEEP_EVERY) {
    sinceSweep = 0;
    for (const [k, v] of stores) if (v.resetAt <= now) stores.delete(k);
  }

  const current = stores.get(key);
  if (!current || current.resetAt <= now) {
    stores.set(key, { count: 1, resetAt: now + options.windowMs });
    return;
  }

  current.count += 1;
  if (current.count > options.maxRequests) {
    throw new ApiError(
      ERROR_CODES.RATE_LIMITED,
      'Too many requests. Please wait a moment before trying again.',
    );
  }
}

/**
 * Shared limits, named rather than scattered as literals.
 *
 * **Why these are generous.** The limiter keys on IP, and FRIDAY's learners are
 * Indian exam aspirants: a coaching centre, a school lab, or a mobile carrier's
 * CGNAT puts hundreds of students behind one address. A limit tuned for one
 * person per IP locks out a classroom that signs up together — which is both
 * the best possible day for the product and the worst possible time to fail.
 *
 * The numbers below still stop a script cold while leaving room for a room full
 * of real people. Five per minute — the first setting — was tight enough that
 * it broke the test suite within one run, which is a fair preview of what it
 * would have done to a shared connection.
 */
export const RATE_LIMITS = {
  /** Credential guessing. Generous per IP because the account is the real target. */
  signIn: { windowMs: 60_000, maxRequests: 20 },
  /** Bulk account creation. A classroom signing up together must get through. */
  signUp: { windowMs: 60_000, maxRequests: 30 },
  /** Starting work is cheap but not free. */
  session: { windowMs: 60_000, maxRequests: 30 },
  /** Re-planning runs the scheduler, so this one is about cost, not abuse. */
  replan: { windowMs: 60_000, maxRequests: 10 },
} as const;
