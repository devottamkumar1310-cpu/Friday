import { z } from '../zod';
import { envelope } from '../envelope';
import { DateOnlySchema, DateTimeSchema, UuidSchema } from '../primitives';

/** Planning — API_SPECIFICATION §5.4. */

export const FeasibilityVerdictSchema = z.enum(['on_track', 'at_risk', 'not_feasible']);
export const TaskTypeSchema = z.enum(['learn', 'practice', 'revise', 'assess', 'project', 'break']);
export const TaskStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'skipped',
  'rescheduled',
  'cancelled',
]);

export const TaskConceptRefSchema = z.object({ id: UuidSchema, title: z.string() });

export const TaskSchema = z
  .object({
    id: UuidSchema,
    type: TaskTypeSchema,
    title: z.string(),
    estimatedMinutes: z.number().int(),
    status: TaskStatusSchema,
    scheduledDate: DateOnlySchema,
    concepts: z.array(TaskConceptRefSchema),
  })
  .openapi('Task');

export const StudyBlockSchema = z
  .object({
    id: UuidSchema,
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    plannedMinutes: z.number().int(),
    isLocked: z.boolean(),
    tasks: z.array(TaskSchema),
  })
  .openapi('StudyBlock');

export const ScheduleDaySchema = z.object({
  date: DateOnlySchema,
  capacityMinutes: z.number().int(),
  plannedMinutes: z.number().int(),
  blocks: z.array(StudyBlockSchema),
});

export const ProjectionWeekSchema = z.object({
  week: z.string(),
  conceptIds: z.array(UuidSchema),
  plannedMinutes: z.number().int(),
});

export const ScheduleResponseSchema = envelope(
  z.object({
    planVersion: z.number().int(),
    window: z.object({ start: DateOnlySchema, end: DateOnlySchema }),
    days: z.array(ScheduleDaySchema),
    projection: z.array(ProjectionWeekSchema),
  }),
);

export const PlanSchema = z
  .object({
    id: UuidSchema,
    version: z.number().int(),
    status: z.enum(['active', 'superseded', 'archived']),
    reason: z.string(),
    windowStart: DateOnlySchema,
    windowEnd: DateOnlySchema,
    verdict: FeasibilityVerdictSchema,
    requiredMinutes: z.number().int(),
    availableMinutes: z.number().int(),
    slackMinutes: z.number().int(),
    projectedCompletionDate: DateOnlySchema.nullable(),
    createdAt: DateTimeSchema,
  })
  .openapi('Plan');

export const PlanListResponseSchema = envelope(z.array(PlanSchema));
export const PlanResponseSchema = envelope(PlanSchema);

export const RegeneratePlanRequestSchema = z
  .object({ reason: z.string().max(200).optional() })
  .strict()
  .openapi('RegeneratePlanRequest');
export type RegeneratePlanRequest = z.infer<typeof RegeneratePlanRequestSchema>;

export const RegeneratePlanResponseSchema = envelope(
  z.object({
    committed: z.boolean(),
    reason: z.string(),
    plan: PlanSchema.nullable(),
    drift: z.object({
      drift: z.number(),
      verdictChanged: z.boolean(),
    }),
  }),
);

export const FeasibilityRemediationOptionSchema = z.object({
  type: z.enum(['increase_hours', 'reduce_scope', 'extend_deadline']),
  detail: z.string(),
  conceptIds: z.array(UuidSchema).optional(),
  impact: z.object({ verdict: FeasibilityVerdictSchema, slackPercent: z.number().optional() }),
});

export const FeasibilityResponseSchema = envelope(
  z.object({
    verdict: FeasibilityVerdictSchema,
    requiredMinutes: z.number().int(),
    availableMinutes: z.number().int(),
    slackMinutes: z.number().int(),
    slackPercent: z.number(),
    projectedCompletionDate: DateOnlySchema.nullable(),
    confidenceIntervalDays: z.number().int(),
    remediationOptions: z.array(FeasibilityRemediationOptionSchema),
  }),
);
