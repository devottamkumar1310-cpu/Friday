import { and, eq, inArray } from 'drizzle-orm';
import {
  canonicalConcepts,
  conceptEdges,
  concepts,
  curricula,
  goals,
  subjects,
  topics,
  units,
  type CanonicalConceptRow,
  type ConceptEdgeRow,
  type ConceptRow,
  type CurriculumRow,
  type GoalRow,
  type NewConceptEdgeRow,
  type NewConceptRow,
  type NewCurriculumRow,
  type NewGoalRow,
} from '../schema/curriculum';
import type { Executor } from './executor';

/** Goals — DATABASE_DESIGN §4.2. NFR-3.3: every method is scoped by `userId`. */
export function goalsRepository(db: Executor) {
  return {
    async create(input: NewGoalRow): Promise<GoalRow> {
      const [row] = await db.insert(goals).values(input).returning();
      if (!row) throw new Error('Insert into goals returned no row.');
      return row;
    },

    async findById(userId: string, goalId: string): Promise<GoalRow | undefined> {
      const [row] = await db
        .select()
        .from(goals)
        .where(and(eq(goals.id, goalId), eq(goals.userId, userId)))
        .limit(1);
      return row;
    },

    async listForUser(userId: string): Promise<GoalRow[]> {
      return db.select().from(goals).where(eq(goals.userId, userId));
    },

    async activate(userId: string, goalId: string): Promise<void> {
      await db
        .update(goals)
        .set({ status: 'active' })
        .where(and(eq(goals.id, goalId), eq(goals.userId, userId)));
    },
  };
}

/**
 * The knowledge graph — curricula, the subject/unit/topic/concept tree, and
 * prerequisite edges (DATABASE_DESIGN §4.2). Bulk-insert methods exist
 * because curriculum creation writes the whole tree in one transaction.
 */
export function curriculumRepository(db: Executor) {
  return {
    async create(input: NewCurriculumRow): Promise<CurriculumRow> {
      const [row] = await db.insert(curricula).values(input).returning();
      if (!row) throw new Error('Insert into curricula returned no row.');
      return row;
    },

    async findByGoal(userId: string, goalId: string): Promise<CurriculumRow | undefined> {
      const [row] = await db
        .select()
        .from(curricula)
        .where(and(eq(curricula.goalId, goalId), eq(curricula.userId, userId)))
        .limit(1);
      return row;
    },

    async insertSubjects(rows: (typeof subjects.$inferInsert)[]) {
      if (rows.length === 0) return [];
      return db.insert(subjects).values(rows).returning();
    },

    async insertUnits(rows: (typeof units.$inferInsert)[]) {
      if (rows.length === 0) return [];
      return db.insert(units).values(rows).returning();
    },

    async insertTopics(rows: (typeof topics.$inferInsert)[]) {
      if (rows.length === 0) return [];
      return db.insert(topics).values(rows).returning();
    },

    async insertConcepts(rows: NewConceptRow[]): Promise<ConceptRow[]> {
      if (rows.length === 0) return [];
      return db.insert(concepts).values(rows).returning();
    },

    async insertEdges(rows: NewConceptEdgeRow[]): Promise<ConceptEdgeRow[]> {
      if (rows.length === 0) return [];
      return db.insert(conceptEdges).values(rows).returning();
    },

    async listConcepts(userId: string, curriculumId: string): Promise<ConceptRow[]> {
      return db
        .select()
        .from(concepts)
        .where(and(eq(concepts.curriculumId, curriculumId), eq(concepts.userId, userId)));
    },

    async listEdges(userId: string, curriculumId: string): Promise<ConceptEdgeRow[]> {
      return db
        .select()
        .from(conceptEdges)
        .where(and(eq(conceptEdges.curriculumId, curriculumId), eq(conceptEdges.userId, userId)));
    },

    async findConceptsByIds(userId: string, conceptIds: string[]): Promise<ConceptRow[]> {
      if (conceptIds.length === 0) return [];
      return db
        .select()
        .from(concepts)
        .where(and(inArray(concepts.id, conceptIds), eq(concepts.userId, userId)));
    },

    async updateConceptStatus(
      userId: string,
      conceptId: string,
      status: ConceptRow['status'],
    ): Promise<ConceptRow | undefined> {
      const [row] = await db
        .update(concepts)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(concepts.id, conceptId), eq(concepts.userId, userId)))
        .returning();
      return row;
    },
  };
}

/** Shared, unscoped controlled vocabulary (DATABASE_DESIGN §4.2). */
export function canonicalConceptsRepository(db: Executor) {
  return {
    async upsertMany(rows: (typeof canonicalConcepts.$inferInsert)[]): Promise<void> {
      if (rows.length === 0) return;
      await db
        .insert(canonicalConcepts)
        .values(rows)
        .onConflictDoNothing({ target: canonicalConcepts.key });
    },

    async findByKeys(keys: string[]): Promise<CanonicalConceptRow[]> {
      if (keys.length === 0) return [];
      return db.select().from(canonicalConcepts).where(inArray(canonicalConcepts.key, keys));
    },

    async listAll(): Promise<CanonicalConceptRow[]> {
      return db.select().from(canonicalConcepts);
    },
  };
}

export type GoalsRepository = ReturnType<typeof goalsRepository>;
export type CurriculumRepository = ReturnType<typeof curriculumRepository>;
export type CanonicalConceptsRepository = ReturnType<typeof canonicalConceptsRepository>;
