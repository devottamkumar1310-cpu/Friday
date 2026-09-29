import { z } from '../zod';
import { envelope } from '../envelope';
import { DateTimeSchema, UuidSchema } from '../primitives';

/** Execution — API_SPECIFICATION §5.6. */

export const FsrsRatingSchema = z.enum(['again', 'hard', 'good', 'easy']);
export const SessionStatusSchema = z.enum(['active', 'paused', 'completed', 'abandoned']);

export const StartSessionRequestSchema = z
  .object({
    goalId: UuidSchema,
    taskId: UuidSchema.optional(),
    originatedFrom: z.enum(['recommendation', 'plan', 'manual', 'directive']).default('manual'),
  })
  .strict()
  .openapi('StartSessionRequest');
export type StartSessionRequest = z.infer<typeof StartSessionRequestSchema>;

export const SessionSchema = z
  .object({
    id: UuidSchema,
    goalId: UuidSchema,
    taskId: UuidSchema.nullable(),
    status: SessionStatusSchema,
    startedAt: DateTimeSchema,
    endedAt: DateTimeSchema.nullable(),
    activeMinutes: z.number().int(),
  })
  .openapi('Session');

export const StartSessionResponseSchema = envelope(SessionSchema);

export const ConceptRatingSchema = z.object({
  conceptId: UuidSchema,
  rating: FsrsRatingSchema,
  confidence: z.number().min(0).max(1).optional(),
});

export const CompleteSessionRequestSchema = z
  .object({
    activeMinutes: z.number().int().min(0).max(1440),
    /**
     * One rating per concept, enforced.
     *
     * An audit sent fifty ratings for the same concept in a single completion
     * and watched mastery go from 9.8% to 68.8% — fifty evidence events from one
     * sitting. Everything downstream is computed from that number: what the
     * planner schedules, what the learner is told they know, whether the goal
     * looks feasible.
     *
     * Rejected rather than de-duplicated. Two ratings for one concept in one
     * session is not a request with a sensible reading — silently keeping the
     * first or the last would guess at which one the client meant, and a
     * double-submitting client would never find out it was broken.
     */
    ratings: z
      .array(ConceptRatingSchema)
      .min(1)
      .refine((rows) => new Set(rows.map((r) => r.conceptId)).size === rows.length, {
        message: 'Each concept may be rated once per session.',
      }),
    notes: z.string().max(2000).optional(),
  })
  .strict()
  .openapi('CompleteSessionRequest');
export type CompleteSessionRequest = z.infer<typeof CompleteSessionRequestSchema>;

export const MasteryChangeSchema = z.object({
  conceptId: UuidSchema,
  before: z.number(),
  after: z.number(),
  delta: z.number(),
});

export const RetentionChangeSchema = z.object({
  conceptId: UuidSchema,
  previousDue: DateTimeSchema.nullable(),
  nextDue: DateTimeSchema,
  intervalDays: z.number(),
});

export const CompleteSessionResponseSchema = envelope(
  z.object({
    session: SessionSchema,
    changes: z.object({
      mastery: z.array(MasteryChangeSchema),
      retention: z.array(RetentionChangeSchema),
    }),
    nextActionInvalidated: z.boolean(),
  }),
);
