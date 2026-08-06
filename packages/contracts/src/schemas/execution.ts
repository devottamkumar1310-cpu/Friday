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
    ratings: z.array(ConceptRatingSchema).min(1),
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
