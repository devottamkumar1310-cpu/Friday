import { z } from '../zod';
import { envelope } from '../envelope';
import {
  DateOnlySchema,
  DisplayNameSchema,
  EmailSchema,
  PasswordSchema,
  TimezoneSchema,
} from '../primitives';
import { UserSchema } from './me';

/**
 * Auth contracts — API_SPECIFICATION.md §4.3.
 *
 * `dateOfBirth` is collected at sign-up rather than deferred (FR-1.6). The
 * launch segment is predominantly 16–18, so minors are the common case, not an
 * edge case; the age policy itself lives in the identity service, which returns
 * UNDER_MINIMUM_AGE or MINOR_CONSENT_REQUIRED. The schema only checks that the
 * date is real and plausible.
 */
export const SignUpRequestSchema = z
  .object({
    email: EmailSchema,
    password: PasswordSchema,
    displayName: DisplayNameSchema,
    timezone: TimezoneSchema,
    dateOfBirth: DateOnlySchema.refine(
      (s) => {
        const d = Date.parse(`${s}T00:00:00Z`);
        const now = Date.now();
        const oneTwentyYears = 120 * 365.25 * 24 * 60 * 60 * 1000;
        return d <= now && d > now - oneTwentyYears;
      },
      { message: 'Enter a real date of birth.' },
    ),
  })
  .strict()
  .openapi('SignUpRequest');

export type SignUpRequest = z.infer<typeof SignUpRequestSchema>;

export const SignUpPayloadSchema = z
  .object({
    user: UserSchema,
    requiresVerification: z.boolean(),
  })
  .openapi('SignUpPayload');

export const SignUpResponseSchema = envelope(SignUpPayloadSchema);

export const SignInRequestSchema = z
  .object({
    email: EmailSchema,
    password: z.string().min(1).max(200),
  })
  .strict()
  .openapi('SignInRequest');

export type SignInRequest = z.infer<typeof SignInRequestSchema>;

export const SignInPayloadSchema = z.object({ user: UserSchema }).openapi('SignInPayload');
export const SignInResponseSchema = envelope(SignInPayloadSchema);

export const SignOutResponseSchema = envelope(z.object({ signedOut: z.literal(true) }));

/** Active devices, so a learner can revoke a session they do not recognise. */
export const AuthSessionSchema = z
  .object({
    id: z.string().uuid(),
    createdAt: z.string().datetime(),
    lastActiveAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    isCurrent: z.boolean(),
  })
  .openapi('AuthSession');
