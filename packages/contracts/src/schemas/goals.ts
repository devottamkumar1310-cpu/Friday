import { z } from '../zod';
import { envelope } from '../envelope';
import { DateOnlySchema, DateTimeSchema, UuidSchema } from '../primitives';

/**
 * Goals & curriculum — API_SPECIFICATION §5.2-5.3. Phase 1 ships the
 * deterministic engine, not the Curriculum Architect AI agent (roadmap 1.9),
 * so goal creation here takes a curated template only — `curriculum.source`
 * is fixed to `'template'`. AI generation is additive later behind the same
 * contract shape (`source: 'ai_generated'` is already a valid DB enum value).
 */

export const GoalTypeSchema = z.enum(['exam', 'skill', 'course', 'custom']);
export const GoalStatusSchema = z.enum(['draft', 'active', 'paused', 'completed', 'abandoned']);

export const CreateGoalRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(2000).optional(),
    type: GoalTypeSchema,
    targetDate: DateOnlySchema,
    targetWeeklyMinutes: z.number().int().min(30).max(10_080).default(600),
    selfReportedLevel: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    templateSlug: z.string().min(1),
  })
  .strict()
  .openapi('CreateGoalRequest');

export type CreateGoalRequest = z.infer<typeof CreateGoalRequestSchema>;

export const GoalSchema = z
  .object({
    id: UuidSchema,
    title: z.string(),
    type: GoalTypeSchema,
    status: GoalStatusSchema,
    startDate: DateOnlySchema,
    targetDate: DateOnlySchema,
    targetWeeklyMinutes: z.number().int(),
    createdAt: DateTimeSchema,
  })
  .openapi('Goal');

export const CreateGoalResponseSchema = envelope(
  z.object({
    goal: GoalSchema,
    curriculum: z.object({ id: UuidSchema, totalConcepts: z.number().int() }),
  }),
);
export type CreateGoalResponse = z.infer<typeof CreateGoalResponseSchema>;

export const GoalResponseSchema = envelope(GoalSchema);

export const GoalListResponseSchema = envelope(z.array(GoalSchema));

export const CurriculumTemplateSchema = z
  .object({
    id: UuidSchema,
    slug: z.string(),
    title: z.string(),
    examBoard: z.string().nullable(),
    region: z.string().nullable(),
  })
  .openapi('CurriculumTemplate');

export const CurriculumTemplateListResponseSchema = envelope(z.array(CurriculumTemplateSchema));

export const ConceptStatusSchema = z.enum([
  'not_started',
  'in_progress',
  'learned',
  'mastered',
  'excluded',
  'already_known',
]);

export const ConceptSchema = z
  .object({
    id: UuidSchema,
    title: z.string(),
    status: ConceptStatusSchema,
    examWeight: z.number(),
    estimatedMinutes: z.number().int(),
    mastery: z.number().min(0).max(1).nullable(),
  })
  .openapi('Concept');

export const ConceptEdgeSchema = z
  .object({
    fromConceptId: UuidSchema,
    toConceptId: UuidSchema,
    type: z.enum(['prerequisite_of', 'related_to', 'applies_to', 'specializes']),
    strength: z.number().min(0).max(1),
  })
  .openapi('ConceptEdge');

export const GraphResponseSchema = envelope(
  z.object({
    nodes: z.array(ConceptSchema),
    edges: z.array(ConceptEdgeSchema),
  }),
);

export const UpdateConceptStatusRequestSchema = z
  .object({ status: ConceptStatusSchema })
  .strict()
  .openapi('UpdateConceptStatusRequest');
export type UpdateConceptStatusRequest = z.infer<typeof UpdateConceptStatusRequestSchema>;

export const ConceptResponseSchema = envelope(ConceptSchema);
