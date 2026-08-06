import { z } from '../zod';
import { envelope } from '../envelope';
import { DateTimeSchema, UuidSchema } from '../primitives';

/** Memory — API_SPECIFICATION §5.8. */

export const MasteryEntrySchema = z.object({
  conceptId: UuidSchema,
  title: z.string(),
  mastery: z.number(),
  confidence: z.number(),
  evidenceCount: z.number().int(),
  lastEvidenceAt: DateTimeSchema.nullable(),
});

export const MasteryListResponseSchema = envelope(z.array(MasteryEntrySchema));

export const DueReviewSchema = z.object({
  conceptId: UuidSchema,
  title: z.string(),
  dueAt: DateTimeSchema,
  retrievability: z.number(),
  reps: z.number().int(),
  lapses: z.number().int(),
});

export const DueReviewsResponseSchema = envelope(z.array(DueReviewSchema));

export const FactCategorySchema = z.enum([
  'learning_style',
  'misconception',
  'strength',
  'weakness',
  'preference',
  'constraint',
  'motivation',
  'goal_context',
]);

/**
 * `evidenceRefs` is required on the wire as well as in storage. A belief FRIDAY
 * cannot source is a belief it should not hold, and the client shows the
 * citation (FR-7.4).
 */
export const LearnerFactSchema = z
  .object({
    id: UuidSchema,
    category: FactCategorySchema,
    statement: z.string(),
    confidence: z.number(),
    reinforcementCount: z.number().int(),
    evidenceRefs: z.unknown(),
    conceptIds: z.array(UuidSchema),
    isUserEdited: z.boolean(),
    createdAt: DateTimeSchema,
  })
  .openapi('LearnerFact');

export const LearnerFactsResponseSchema = envelope(z.array(LearnerFactSchema));
export const LearnerFactResponseSchema = envelope(LearnerFactSchema);

export const UpdateFactRequestSchema = z
  .object({
    statement: z.string().trim().min(1).max(500).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update.' })
  .openapi('UpdateFactRequest');
export type UpdateFactRequest = z.infer<typeof UpdateFactRequestSchema>;

export const DeleteFactResponseSchema = envelope(z.object({ deleted: z.boolean() }));
