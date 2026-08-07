import { z } from '../zod';
import { envelope } from '../envelope';
import { DateTimeSchema, UuidSchema } from '../primitives';

/**
 * Learner feedback — CR-007.
 *
 * The private beta needs a channel that belongs to the product rather than to
 * whoever the learner happens to know.
 */

export const FeedbackKindSchema = z.enum(['bug', 'confusing', 'idea', 'praise', 'other']);

export const SubmitFeedbackRequestSchema = z
  .object({
    kind: FeedbackKindSchema,
    // Long enough to describe a problem, short enough that the field cannot be
    // used as free storage.
    message: z.string().trim().min(4).max(4000),
    /**
     * Where the learner was. A path only — an absolute URL would carry a query
     * string, which is where personal data hides. The server normalises ids out
     * of it regardless; this is defence in depth, not the only check.
     */
    path: z.string().max(200).startsWith('/').optional(),
  })
  .strict()
  .openapi('SubmitFeedbackRequest');
export type SubmitFeedbackRequest = z.infer<typeof SubmitFeedbackRequestSchema>;

export const FeedbackSchema = z
  .object({
    id: UuidSchema,
    kind: FeedbackKindSchema,
    message: z.string(),
    path: z.string().nullable(),
    status: z.enum(['new', 'triaged', 'closed']),
    createdAt: DateTimeSchema,
  })
  .openapi('Feedback');

export const SubmitFeedbackResponseSchema = envelope(FeedbackSchema);
export const FeedbackListResponseSchema = envelope(z.array(FeedbackSchema));
