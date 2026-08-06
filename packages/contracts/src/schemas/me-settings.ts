import { z } from '../zod';
import { envelope } from '../envelope';
import { DateOnlySchema, UuidSchema } from '../primitives';

/**
 * Availability and preferences — API_SPECIFICATION §5.1.
 *
 * Specified since Phase 0 but never built: nothing needed them until the UI
 * did. Availability in particular is load-bearing — the scheduler cannot
 * produce a plan without it (E-6), and until now it could only be seeded.
 */

const TimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM in 24-hour time.')
  .openapi({ example: '18:00' });

export const AvailabilityRuleSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6).openapi({ description: '0 = Sunday' }),
    startTime: TimeSchema,
    endTime: TimeSchema,
    kind: z.enum(['available', 'blocked']).default('available'),
    effectiveFrom: DateOnlySchema.nullable().optional(),
    effectiveUntil: DateOnlySchema.nullable().optional(),
  })
  .refine((r) => r.endTime > r.startTime, {
    message: 'End time must be after start time.',
    path: ['endTime'],
  })
  .openapi('AvailabilityRule');

export const AvailabilityResponseSchema = envelope(
  z.object({
    rules: z.array(AvailabilityRuleSchema.and(z.object({ id: UuidSchema }))),
    /** Total weekly minutes the rules add up to — what feasibility plans against. */
    weeklyMinutes: z.number().int(),
  }),
);

/** `PUT` replaces the whole set — partial edits are ambiguous for a weekly grid. */
export const SetAvailabilityRequestSchema = z
  .object({ rules: z.array(AvailabilityRuleSchema).max(50) })
  .strict()
  .openapi('SetAvailabilityRequest');
export type SetAvailabilityRequest = z.infer<typeof SetAvailabilityRequestSchema>;

export const PreferencesSchema = z
  .object({
    quietHoursStart: z.string(),
    quietHoursEnd: z.string(),
    maxDirectivesPerDay: z.number().int().min(0).max(20),
    theme: z.enum(['light', 'dark', 'system']),
    notificationChannels: z.record(z.boolean()),
  })
  .openapi('Preferences');

export const PreferencesResponseSchema = envelope(PreferencesSchema);

export const UpdatePreferencesRequestSchema = z
  .object({
    quietHoursStart: TimeSchema.optional(),
    quietHoursEnd: TimeSchema.optional(),
    maxDirectivesPerDay: z.number().int().min(0).max(20).optional(),
    theme: z.enum(['light', 'dark', 'system']).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update.' })
  .openapi('UpdatePreferencesRequest');
export type UpdatePreferencesRequest = z.infer<typeof UpdatePreferencesRequestSchema>;
