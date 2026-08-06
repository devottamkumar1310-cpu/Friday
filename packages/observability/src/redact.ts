/**
 * Log redaction — NFR-3.7: PII is minimised in logs and traces.
 *
 * Deny-list by key name, applied recursively. A deny-list is imperfect, but an
 * allow-list on arbitrary structured log payloads is unusable in practice; the
 * mitigation is that anything genuinely sensitive should not be handed to the
 * logger in the first place.
 */

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'token',
  'tokenhash',
  'token_hash',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'secret',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'authsecret',
  'auth_secret',
  'dateofbirth',
  'date_of_birth',
  'guardianemail',
  'guardian_email',
]);

const REDACTED = '[redacted]';
const MAX_DEPTH = 6;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[truncated]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (value instanceof Date) return value.toISOString();

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redact(val, depth + 1);
  }
  return out;
}

/** Partial email for support correlation without storing the address in logs. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return REDACTED;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'*'.repeat(Math.max(1, local.length - head.length))}${domain}`;
}
