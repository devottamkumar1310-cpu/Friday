import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Session tokens — API_SPECIFICATION §4.1, ADR-007.
 *
 * Opaque random tokens in an httpOnly cookie, with only a hash stored. Database
 * sessions rather than stateless JWTs because revocation must be immediate and
 * global: deleting the row ends the session everywhere, with no token lifetime
 * to wait out.
 *
 * The stored value is an HMAC rather than a bare SHA-256. A plain digest of a
 * high-entropy token is already impractical to reverse, but keying it means a
 * database leak alone is not enough to forge a lookup — the attacker also needs
 * AUTH_SECRET, which lives in a different system.
 */

export const SESSION_COOKIE = 'friday_session';

/** Absolute ceiling. Sliding expiry renews within this bound (§4.1). */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** How much idle time before a session lapses; each request renews it. */
export const SESSION_IDLE_SECONDS = 60 * 60 * 24 * 14;

const TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

function authSecret(): string {
  const secret = process.env['AUTH_SECRET'];
  if (!secret || secret.length < 32) {
    throw new Error(
      'AUTH_SECRET is missing or too short (needs 32+ characters). ' +
        "Generate one: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  return secret;
}

export function hashSessionToken(token: string): string {
  return createHmac('sha256', authSecret()).update(token).digest('base64url');
}

/** Constant-time comparison, for any path that compares tokens directly. */
export function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export type SessionCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
};

/**
 * SameSite=Lax rather than Strict: Strict would drop the cookie on the OAuth
 * callback redirect, breaking sign-in. Lax plus the Origin check on mutating
 * requests is the CSRF defence (§4.1).
 */
export function sessionCookieOptions(maxAgeSeconds = SESSION_IDLE_SECONDS): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export function sessionExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_IDLE_SECONDS * 1000);
}
