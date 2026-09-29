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

/**
 * The parts of a goal a learner may change after creating it.
 *
 * Goals were write-once: `POST` and `GET`, no `PATCH` anywhere, and no `update`
 * on the repository. A learner whose exam moved had a planner optimising
 * towards a date that no longer existed, and no way to say so — the single most
 * consequential input in the product was the one input they could not correct.
 *
 * What is editable here, and what is deliberately not:
 *
 *   `targetDate`, `targetWeeklyMinutes`, `title`, `description` are pure
 *   planner inputs. Changing them re-derives a plan and cannot touch a single
 *   piece of evidence, because mastery, memory and sessions are keyed to
 *   concepts, and the concepts do not move.
 *
 *   The **curriculum** — the subject, the target exam, the concept set — is
 *   not editable, and should not be. Swapping it would orphan every mastery and
 *   FSRS row the learner has earned against concepts that no longer belong to
 *   the goal. A learner changing what they are studying is starting something
 *   new, and `POST /v1/goals` already expresses that correctly: the old goal
 *   keeps its history intact, and nothing is silently rewritten.
 *
 * At least one field must be present, so an empty body is a client bug rather
 * than a silent no-op re-plan.
 */
export const UpdateGoalRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    targetDate: DateOnlySchema.optional(),
    targetWeeklyMinutes: z.number().int().min(30).max(10_080).optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'Provide at least one field to update.',
  })
  .openapi('UpdateGoalRequest');

export type UpdateGoalRequest = z.infer<typeof UpdateGoalRequestSchema>;

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
