import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { newId } from '../ids';
import { users } from './identity';

/** The shape stored in `curriculum_templates.tree` — cloned into rows on use. */
export interface TemplateConcept {
  key: string;
  conceptKey: string;
  title: string;
  description?: string;
  examWeight: number;
  estimatedMinutes: number;
  difficulty: number;
}
export interface TemplateTopic {
  title: string;
  position: number;
  weight: number;
  concepts: TemplateConcept[];
}
export interface TemplateUnit {
  title: string;
  position: number;
  weight: number;
  topics: TemplateTopic[];
}
export interface TemplateSubject {
  title: string;
  position: number;
  weight: number;
  units: TemplateUnit[];
}
export interface TemplateEdge {
  from: string;
  to: string;
  strength: number;
}
export interface CurriculumTemplateTree {
  subjects: TemplateSubject[];
  edges: TemplateEdge[];
}

/**
 * Curriculum tables — DATABASE_DESIGN §4.2. The knowledge graph
 * (IMPLEMENTATION_ROADMAP 1.1): goals -> curricula -> subjects -> units ->
 * topics -> concepts, plus the `concept_edges` prerequisite graph.
 */

export const goalType = pgEnum('goal_type', ['exam', 'skill', 'course', 'custom']);
export const goalStatus = pgEnum('goal_status', [
  'draft',
  'active',
  'paused',
  'completed',
  'abandoned',
]);
export const curriculumSource = pgEnum('curriculum_source', [
  'template',
  'ai_generated',
  'uploaded',
  'manual',
]);
export const conceptStatus = pgEnum('concept_status', [
  'not_started',
  'in_progress',
  'learned',
  'mastered',
  'excluded',
  'already_known',
]);
export const edgeType = pgEnum('edge_type', [
  'prerequisite_of',
  'related_to',
  'applies_to',
  'specializes',
]);

export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    type: goalType('type').notNull(),
    status: goalStatus('status').notNull().default('draft'),
    startDate: date('start_date').notNull().defaultNow(),
    targetDate: date('target_date').notNull(),
    targetWeeklyMinutes: integer('target_weekly_minutes').notNull().default(600),
    selfReportedLevel: text('self_reported_level'),
    /** Multi-goal arbitration hook, unused until M3 (§18.6). */
    isPrimary: boolean('is_primary').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('goals_user_idx').on(t.userId, t.status),
    check('goals_target_after_start', sql`${t.targetDate} > ${t.startDate}`),
  ],
);

export const curriculumTemplates = pgTable(
  'curriculum_templates',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    examBoard: text('exam_board'),
    region: text('region'),
    locale: text('locale').notNull().default('en'),
    /** Full hierarchy + edges, cloned on use. */
    tree: jsonb('tree').$type<CurriculumTemplateTree>().notNull(),
    version: integer('version').notNull().default(1),
    isPublished: boolean('is_published').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('curriculum_templates_slug_key').on(t.slug)],
);

export const curricula = pgTable(
  'curricula',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: curriculumSource('source').notNull(),
    templateId: uuid('template_id').references(() => curriculumTemplates.id),
    version: integer('version').notNull().default(1),
    generationMeta: jsonb('generation_meta'),
    totalConcepts: integer('total_concepts').notNull().default(0),
    totalEstimatedMinutes: integer('total_estimated_minutes').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('curricula_goal_idx').on(t.goalId)],
);

/**
 * Controlled vocabulary, shared across every learner (DATABASE_DESIGN §4.2) —
 * exists so generated content can be cached across users. Not user-scoped.
 */
export const canonicalConcepts = pgTable('canonical_concepts', {
  key: text('key').primaryKey(),
  title: text('title').notNull(),
  domain: text('domain').notNull(),
  aliases: text('aliases')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const subjects = pgTable(
  'subjects',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    curriculumId: uuid('curriculum_id')
      .notNull()
      .references(() => curricula.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    position: integer('position').notNull(),
    weight: numeric('weight', { precision: 4, scale: 3 }).notNull().default('1.0'),
    color: text('color'),
  },
  (t) => [index('subjects_curriculum_idx').on(t.curriculumId, t.position)],
);

export const units = pgTable(
  'units',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    position: integer('position').notNull(),
    weight: numeric('weight', { precision: 4, scale: 3 }).notNull().default('1.0'),
  },
  (t) => [index('units_subject_idx').on(t.subjectId, t.position)],
);

export const topics = pgTable(
  'topics',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    position: integer('position').notNull(),
    weight: numeric('weight', { precision: 4, scale: 3 }).notNull().default('1.0'),
  },
  (t) => [index('topics_unit_idx').on(t.unitId, t.position)],
);

/** The atomic masterable unit. Everything in the learning engine keys off this. */
export const concepts = pgTable(
  'concepts',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    curriculumId: uuid('curriculum_id')
      .notNull()
      .references(() => curricula.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** NULL = private, no cross-learner content sharing. */
    conceptKey: text('concept_key').references(() => canonicalConcepts.key),
    title: text('title').notNull(),
    description: text('description'),
    position: integer('position').notNull(),
    estimatedMinutes: integer('estimated_minutes').notNull().default(30),
    difficulty: smallint('difficulty').notNull().default(3),
    examWeight: numeric('exam_weight', { precision: 4, scale: 3 }).notNull().default('0.5'),
    status: conceptStatus('status').notNull().default('not_started'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('concepts_curriculum_status_idx').on(t.curriculumId, t.status),
    index('concepts_key_idx').on(t.conceptKey),
    index('concepts_user_idx').on(t.userId),
    check('concepts_minutes_range', sql`${t.estimatedMinutes} between 5 and 600`),
    check('concepts_difficulty_range', sql`${t.difficulty} between 1 and 5`),
    check('concepts_exam_weight_range', sql`${t.examWeight} between 0 and 1`),
  ],
);

/** The knowledge graph. */
export const conceptEdges = pgTable(
  'concept_edges',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    curriculumId: uuid('curriculum_id')
      .notNull()
      .references(() => curricula.id, { onDelete: 'cascade' }),
    fromConceptId: uuid('from_concept_id')
      .notNull()
      .references(() => concepts.id, { onDelete: 'cascade' }),
    toConceptId: uuid('to_concept_id')
      .notNull()
      .references(() => concepts.id, { onDelete: 'cascade' }),
    type: edgeType('type').notNull().default('prerequisite_of'),
    strength: numeric('strength', { precision: 3, scale: 2 }).notNull().default('1.0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('concept_edges_unique').on(t.fromConceptId, t.toConceptId, t.type),
    index('concept_edges_to_idx').on(t.toConceptId, t.type),
    index('concept_edges_from_idx').on(t.fromConceptId, t.type),
    check('concept_edges_no_self_loop', sql`${t.fromConceptId} <> ${t.toConceptId}`),
  ],
);

export type GoalRow = typeof goals.$inferSelect;
export type NewGoalRow = typeof goals.$inferInsert;
export type CurriculumRow = typeof curricula.$inferSelect;
export type NewCurriculumRow = typeof curricula.$inferInsert;
export type CanonicalConceptRow = typeof canonicalConcepts.$inferSelect;
export type SubjectRow = typeof subjects.$inferSelect;
export type UnitRow = typeof units.$inferSelect;
export type TopicRow = typeof topics.$inferSelect;
export type ConceptRow = typeof concepts.$inferSelect;
export type NewConceptRow = typeof concepts.$inferInsert;
export type ConceptEdgeRow = typeof conceptEdges.$inferSelect;
export type NewConceptEdgeRow = typeof conceptEdges.$inferInsert;
