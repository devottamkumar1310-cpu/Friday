import { z } from '../zod';
import { envelope } from '../envelope';
import { DateOnlySchema, DateTimeSchema, UuidSchema } from '../primitives';
import { SessionStatusSchema } from './execution';
import { TaskSchema } from './planning';

/**
 * Session history and task listing — API_SPECIFICATION §5.4, §5.6.
 *
 * The write side shipped in Phase 1; these are the reads the UI needs to show
 * a learner what they have actually done.
 */

export const SessionSummarySchema = z
  .object({
    id: UuidSchema,
    goalId: UuidSchema,
    taskId: UuidSchema.nullable(),
    taskTitle: z.string().nullable(),
    status: SessionStatusSchema,
    startedAt: DateTimeSchema,
    endedAt: DateTimeSchema.nullable(),
    activeMinutes: z.number().int(),
    selfRating: z.enum(['again', 'hard', 'good', 'easy']).nullable(),
    originatedFrom: z.string().nullable(),
  })
  .openapi('SessionSummary');

export const SessionListResponseSchema = envelope(z.array(SessionSummarySchema));
export const SessionDetailResponseSchema = envelope(SessionSummarySchema);
export const AbandonSessionResponseSchema = envelope(z.object({ abandoned: z.boolean() }));

export const TaskListResponseSchema = envelope(z.array(TaskSchema));

export const UpdateTaskRequestSchema = z
  .object({
    status: z.enum(['pending', 'in_progress', 'completed', 'skipped', 'rescheduled']).optional(),
    scheduledDate: DateOnlySchema.optional(),
    skippedReason: z.string().max(200).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update.' })
  .openapi('UpdateTaskRequest');
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;

export const TaskResponseSchema = envelope(TaskSchema);

/**
 * A task with everything the study screen needs, so starting a session is one
 * request rather than four.
 */
export const StudyTaskResponseSchema = envelope(
  z.object({
    task: TaskSchema,
    goalId: UuidSchema,
    concepts: z.array(
      z.object({
        id: UuidSchema,
        title: z.string(),
        description: z.string().nullable(),
        mastery: z.number(),
        estimatedMinutes: z.number().int(),
      }),
    ),
    /** An in-flight session for this task, if one exists (E-19). */
    activeSessionId: UuidSchema.nullable(),
  }),
);
