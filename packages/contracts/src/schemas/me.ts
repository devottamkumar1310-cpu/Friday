import { z } from '../zod';
import { envelope } from '../envelope';
import {
  DateOnlySchema,
  DateTimeSchema,
  DisplayNameSchema,
  EmailSchema,
  LocaleSchema,
  TimezoneSchema,
  UserRoleSchema,
  UuidSchema,
} from '../primitives';

/**
 * Public projection of a user. `passwordHash`, `dateOfBirth`, and `deletedAt`
 * are deliberately absent — the wire type is not the row type.
 */
export const UserSchema = z
  .object({
    id: UuidSchema,
    email: EmailSchema,
    emailVerified: z.boolean(),
    displayName: DisplayNameSchema,
    avatarUrl: z.string().url().nullable(),
    timezone: TimezoneSchema,
    locale: LocaleSchema,
    role: UserRoleSchema,
    createdAt: DateTimeSchema,
  })
  .openapi('User');

export type User = z.infer<typeof UserSchema>;

export const OnboardingStepSchema = z.enum([
  'date_of_birth',
  'guardian_consent',
  'goal',
  'availability',
  'curriculum',
  'complete',
]);

/**
 * What, if anything, prevents the learner from proceeding.
 *
 * FR-1.6: date of birth is required before a Goal may be created, and a minor
 * cannot proceed until guardian consent is recorded. Surfacing the specific
 * blocker lets the client route without replicating the age policy.
 */
export const OnboardingStateSchema = z
  .object({
    step: OnboardingStepSchema,
    completed: z.boolean(),
    blockedBy: z.enum(['date_of_birth', 'guardian_consent']).nullable(),
  })
  .openapi('OnboardingState');

export type OnboardingState = z.infer<typeof OnboardingStateSchema>;

export const MePayloadSchema = z
  .object({
    user: UserSchema,
    onboarding: OnboardingStateSchema,
    /** Null until Phase 1 introduces goals. */
    activeGoal: z.null(),
  })
  .openapi('MePayload');

export const MeResponseSchema = envelope(MePayloadSchema);
export type MeResponse = z.infer<typeof MeResponseSchema>;

/**
 * PATCH /me.
 *
 * `dateOfBirth` is accepted here so OAuth users — whose account exists before
 * any form is shown — can supply it. It is write-once: the service rejects a
 * second attempt, because changing it would silently change minor status.
 */
export const UpdateMeRequestSchema = z
  .object({
    displayName: DisplayNameSchema.optional(),
    timezone: TimezoneSchema.optional(),
    locale: LocaleSchema.optional(),
    avatarUrl: z.string().url().nullable().optional(),
    dateOfBirth: DateOnlySchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update.' })
  .openapi('UpdateMeRequest');

export type UpdateMeRequest = z.infer<typeof UpdateMeRequestSchema>;

export const ConsentTypeSchema = z.enum(['terms', 'privacy', 'guardian', 'marketing']);

export const RecordConsentRequestSchema = z
  .object({
    consentType: ConsentTypeSchema,
    granted: z.boolean(),
    version: z.string().min(1).max(40),
    /** Required when consentType is 'guardian'. Enforced in the service. */
    guardianEmail: EmailSchema.optional(),
  })
  .strict()
  .openapi('RecordConsentRequest');

export type RecordConsentRequest = z.infer<typeof RecordConsentRequestSchema>;

export const ConsentSchema = z
  .object({
    id: UuidSchema,
    consentType: ConsentTypeSchema,
    granted: z.boolean(),
    version: z.string(),
    createdAt: DateTimeSchema,
  })
  .openapi('Consent');

export const ConsentResponseSchema = envelope(ConsentSchema);
