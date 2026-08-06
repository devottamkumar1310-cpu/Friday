import { z } from '../zod';
import { envelope } from '../envelope';
import { DateTimeSchema, UuidSchema } from '../primitives';
import { TaskConceptRefSchema, TaskTypeSchema } from './planning';

/**
 * Next Action — the hot path. API_SPECIFICATION §5.5. NFR-1.7: no LLM call
 * is permitted anywhere in the production of this response.
 */

export const DominantFactorSchema = z.enum(['impact', 'urgency', 'decayRisk', 'readiness', 'cost']);

export const FactorSchema = z.object({
  value: z.number(),
  contribution: z.number().nullable(),
  detail: z.string(),
});

export const WhyBlockSchema = z
  .object({
    priorityScore: z.number(),
    factors: z.object({
      impact: FactorSchema,
      urgency: FactorSchema,
      decayRisk: FactorSchema,
      readiness: FactorSchema,
      cost: FactorSchema,
    }),
    dominantFactor: DominantFactorSchema,
    confidence: z.object({
      score: z.number(),
      band: z.enum(['exploratory', 'low', 'moderate', 'high']),
    }),
  })
  .openapi('WhyBlock');

export const NextActionConceptSchema = TaskConceptRefSchema.extend({
  mastery: z.number().min(0).max(1),
});

export const AlternateActionSchema = z.object({
  taskId: UuidSchema,
  title: z.string(),
  estimatedMinutes: z.number().int(),
  priorityScore: z.number(),
});

export const NextActionResponseSchema = envelope(
  z.object({
    action: z
      .object({
        taskId: UuidSchema,
        type: TaskTypeSchema,
        title: z.string(),
        estimatedMinutes: z.number().int(),
        concepts: z.array(NextActionConceptSchema),
        rationale: z.string(),
      })
      .nullable(),
    why: WhyBlockSchema.nullable(),
    alternates: z.array(AlternateActionSchema),
    computedAt: DateTimeSchema,
    cacheHit: z.boolean(),
  }),
);
export type NextActionResponse = z.infer<typeof NextActionResponseSchema>;

export const SkipActionRequestSchema = z
  .object({ taskId: UuidSchema, reason: z.string().max(200).optional() })
  .strict()
  .openapi('SkipActionRequest');
export type SkipActionRequest = z.infer<typeof SkipActionRequestSchema>;
