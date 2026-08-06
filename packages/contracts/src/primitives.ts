import { z } from './zod';

/** UUIDv7, generated in the application layer (DATABASE_DESIGN D1). */
export const UuidSchema = z.string().uuid().openapi({
  description: 'UUIDv7 identifier',
  example: '018f3a2b-7c4d-7e1f-9a2b-3c4d5e6f7a8b',
});

export const EmailSchema = z
  .string()
  .email()
  .max(254)
  .transform((v) => v.trim().toLowerCase())
  .openapi({ example: 'student@example.com' });

/**
 * NFR-3.2 uses Argon2id, which has no practical length ceiling, but an
 * unbounded field is a trivial DoS vector — hashing cost scales with input.
 */
export const PasswordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200)
  .openapi({ description: 'Minimum 10 characters' });

/** IANA timezone. Validated against the runtime's own database, not a list. */
export const TimezoneSchema = z
  .string()
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Must be a valid IANA timezone, e.g. Asia/Kolkata.' },
  )
  .openapi({ example: 'Asia/Kolkata' });

/** Calendar date, YYYY-MM-DD. Never a timestamp — see DATABASE_DESIGN D9. */
export const DateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD.')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), { message: 'Not a real date.' })
  .openapi({ format: 'date', example: '2007-05-14' });

/** Instant, ISO 8601 UTC. */
export const DateTimeSchema = z
  .string()
  .datetime()
  .openapi({ format: 'date-time', example: '2026-07-24T09:30:00Z' });

export const LocaleSchema = z
  .string()
  .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Expected a BCP-47 tag such as "en" or "en-IN".')
  .openapi({ example: 'en' });

export const DisplayNameSchema = z.string().trim().min(1).max(80).openapi({ example: 'Aarav' });

export const UserRoleSchema = z.enum(['learner', 'admin', 'system']);
export type UserRole = z.infer<typeof UserRoleSchema>;
