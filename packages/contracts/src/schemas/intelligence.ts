import { z } from '../zod';
import { envelope } from '../envelope';
import { DateOnlySchema, DateTimeSchema, UuidSchema } from '../primitives';
import { FeasibilityVerdictSchema } from './planning';

/** Intelligence — API_SPECIFICATION §5.9. Roadmap 2.1, 2.2. */

export const ProgressResponseSchema = envelope(
  z.object({
    weightedProgress: z.number().min(0).max(1),
    rawProgress: z.number().min(0).max(1),
    conceptsMastered: z.number().int(),
    conceptsTotal: z.number().int(),
    conceptsInProgress: z.number().int(),
    conceptsNotStarted: z.number().int(),
    verdict: FeasibilityVerdictSchema,
    projectedCompletionDate: DateOnlySchema.nullable(),
    daysRemaining: z.number().int(),
    velocity: z.object({
      perWeek: z.number(),
      requiredPerWeek: z.number(),
      trend: z.enum(['ahead', 'on_pace', 'declining']),
    }),
    retentionHealth: z.object({
      dueNow: z.number().int(),
      overdue: z.number().int(),
      atRisk: z.number().int(),
    }),
    adherence: z.object({
      last7d: z.number().nullable(),
      last30d: z.number().nullable(),
    }),
  }),
);
export type ProgressResponse = z.infer<typeof ProgressResponseSchema>;

export const WeakConceptSchema = z
  .object({
    conceptId: UuidSchema,
    title: z.string(),
    mastery: z.number(),
    effectiveMastery: z.number(),
    examWeight: z.number(),
    weaknessScore: z.number(),
    evidence: z.object({
      evidenceCount: z.number().int(),
      beliefConfidence: z.number(),
      lastEvidenceAt: DateTimeSchema.nullable(),
      /** True when there is too little evidence to assert weakness confidently. */
      provisional: z.boolean(),
    }),
  })
  .openapi('WeakConcept');

export const WeakConceptsResponseSchema = envelope(z.array(WeakConceptSchema));

export const TrendPointSchema = z.object({
  date: DateOnlySchema,
  weightedProgress: z.number(),
  conceptsMastered: z.number().int(),
});

export const TrendsResponseSchema = envelope(z.array(TrendPointSchema));

export const InsightSchema = z
  .object({
    id: UuidSchema,
    type: z.enum([
      'weakness',
      'strength',
      'trend',
      'risk',
      'milestone',
      'root_cause',
      'recommendation',
    ]),
    title: z.string(),
    body: z.string(),
    severity: z.number().int(),
    conceptIds: z.array(UuidSchema),
    evidence: z.unknown(),
    createdAt: DateTimeSchema,
  })
  .openapi('Insight');

export const InsightsResponseSchema = envelope(z.array(InsightSchema));
