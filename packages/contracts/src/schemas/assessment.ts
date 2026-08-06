import { z } from '../zod';
import { envelope } from '../envelope';
import { DateTimeSchema, UuidSchema } from '../primitives';

/** Assessment — API_SPECIFICATION §5.7. Roadmap 2.7, 2.8. */

export const QuestionTypeSchema = z.enum([
  'mcq_single',
  'mcq_multi',
  'short_answer',
  'numeric',
  'true_false',
]);

export const CreatePracticeSetRequestSchema = z
  .object({
    goalId: UuidSchema,
    conceptIds: z.array(UuidSchema).min(1).max(10),
    questionCount: z.number().int().min(1).max(20).default(5),
    difficulty: z.number().int().min(1).max(5).default(3),
  })
  .strict()
  .openapi('CreatePracticeSetRequest');
export type CreatePracticeSetRequest = z.infer<typeof CreatePracticeSetRequestSchema>;

/** Answers and explanations are deliberately absent until submission. */
export const ServedQuestionSchema = z
  .object({
    id: UuidSchema,
    type: QuestionTypeSchema,
    stem: z.string(),
    options: z
      .array(z.object({ id: z.string(), text: z.string() }))
      .nullable()
      .optional(),
  })
  .openapi('ServedQuestion');

export const PracticeSetResponseSchema = envelope(
  z.object({
    assessmentId: UuidSchema,
    attemptId: UuidSchema,
    questions: z.array(ServedQuestionSchema),
    /** Observability for the content cache — true means no model call was made. */
    servedFromCache: z.boolean(),
  }),
);

export const AnswerSchema = z.object({
  selected: z.array(z.string()).optional(),
  value: z.string().optional(),
});

export const SubmitResponseRequestSchema = z
  .object({
    questionId: UuidSchema,
    answer: AnswerSchema,
    responseMs: z.number().int().min(0).optional(),
  })
  .strict()
  .openapi('SubmitResponseRequest');
export type SubmitResponseRequest = z.infer<typeof SubmitResponseRequestSchema>;

export const SubmitResponseResponseSchema = envelope(
  z.object({
    isCorrect: z.boolean(),
    correctAnswer: z.unknown(),
    explanation: z.string(),
    gradingMethod: z.string(),
  }),
);

export const SubmitAttemptResponseSchema = envelope(
  z.object({
    attemptId: UuidSchema,
    score: z.number(),
    maxScore: z.number(),
    submittedAt: DateTimeSchema.nullable(),
    conceptBreakdown: z.array(
      z.object({
        conceptId: UuidSchema,
        accuracy: z.number(),
        correct: z.number().int(),
        total: z.number().int(),
      }),
    ),
    /** Proof the practice moved something real (pain point P10). */
    masteryChanges: z.array(
      z.object({
        conceptId: UuidSchema,
        before: z.number(),
        after: z.number(),
        delta: z.number(),
      }),
    ),
  }),
);

export const ReportQuestionResponseSchema = envelope(z.object({ reported: z.boolean() }));
