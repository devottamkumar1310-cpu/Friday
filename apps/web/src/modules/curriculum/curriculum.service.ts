import {
  breakCycles,
  type ConceptEdge as CoreConceptEdge,
  type ConceptNode as CoreConceptNode,
} from '@friday/core';
import {
  ApiError,
  ERROR_CODES,
  type CreateGoalRequest,
  type UpdateConceptStatusRequest,
  type UpdateGoalRequest,
} from '@friday/contracts';
import {
  canonicalConceptsRepository,
  curriculumRepository,
  getDb,
  goalsRepository,
  memoryRepository,
  type ConceptEdgeRow,
  type ConceptRow,
  type CurriculumTemplateTree,
  type GoalRow,
  type UserRow,
} from '@friday/db';
import { logger } from '@friday/observability';
import { generateInitialPlan, replanQuietly } from '../planning/planning.service';
import { EVENTS, trackEvent } from '../platform/analytics.service';

/**
 * The knowledge graph — curriculum model, concepts, prerequisites
 * (IMPLEMENTATION_ROADMAP 1.1). Phase 1 clones a curated template
 * (roadmap 1.8); the Curriculum Architect AI agent (roadmap 1.9) is out of
 * scope — `source` is fixed to `'template'` here, and `'ai_generated'`
 * remains a valid value for when that agent ships.
 */

export async function listTemplates() {
  const db = getDb();
  const rows = await db.query.curriculumTemplates.findMany({
    where: (t, { eq }) => eq(t.isPublished, true),
  });
  return rows;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function createGoal(user: UserRow, input: CreateGoalRequest) {
  if (input.targetDate <= today()) {
    throw new ApiError(ERROR_CODES.TARGET_DATE_IN_PAST); // E-7
  }

  const db = getDb();
  const template = await db.query.curriculumTemplates.findFirst({
    where: (t, { eq, and }) => and(eq(t.slug, input.templateSlug), eq(t.isPublished, true)),
  });
  if (!template) throw new ApiError(ERROR_CODES.TEMPLATE_NOT_FOUND);

  const tree = template.tree as CurriculumTemplateTree;

  // Resolve every template concept's canonical key before writing anything —
  // an AI-generated curriculum must not invent keys (NFR-7.2); a curated
  // template is trusted, but we still verify the vocabulary exists.
  const conceptKeys = tree.subjects.flatMap((s) =>
    s.units.flatMap((u) => u.topics.flatMap((t) => t.concepts.map((c) => c.conceptKey))),
  );
  const known = await canonicalConceptsRepository(db).findByKeys(conceptKeys);
  const knownSet = new Set(known.map((k) => k.key));
  const unresolved = conceptKeys.filter((k) => !knownSet.has(k));
  if (unresolved.length > 0) {
    throw new ApiError(
      ERROR_CODES.CURRICULUM_VALIDATION_FAILED,
      `Template references unknown canonical concept keys: ${unresolved.join(', ')}`,
    );
  }

  const { goal, curriculum } = await db.transaction(async (tx) => {
    const goalsRepo = goalsRepository(tx);
    const curriculumRepo = curriculumRepository(tx);

    const goal = await goalsRepo.create({
      userId: user.id,
      title: input.title,
      description: input.description ?? null,
      type: input.type,
      status: 'active',
      targetDate: input.targetDate,
      targetWeeklyMinutes: input.targetWeeklyMinutes,
      selfReportedLevel: input.selfReportedLevel ?? null,
    });

    const curriculum = await curriculumRepo.create({
      goalId: goal.id,
      userId: user.id,
      source: 'template',
      templateId: template.id,
      version: 1,
      totalConcepts: conceptKeys.length,
      totalEstimatedMinutes: tree.subjects
        .flatMap((s) => s.units.flatMap((u) => u.topics.flatMap((t) => t.concepts)))
        .reduce((sum, c) => sum + c.estimatedMinutes, 0),
    });

    const conceptIdByTemplateKey = new Map<string, string>();
    let subjectPosition = 0;

    for (const subject of tree.subjects) {
      const [subjectRow] = await curriculumRepo.insertSubjects([
        {
          curriculumId: curriculum.id,
          userId: user.id,
          title: subject.title,
          position: subjectPosition++,
          weight: subject.weight.toFixed(3),
        },
      ]);
      if (!subjectRow) continue;

      for (const unit of subject.units) {
        const [unitRow] = await curriculumRepo.insertUnits([
          {
            subjectId: subjectRow.id,
            userId: user.id,
            title: unit.title,
            position: unit.position,
            weight: unit.weight.toFixed(3),
          },
        ]);
        if (!unitRow) continue;

        for (const topic of unit.topics) {
          const [topicRow] = await curriculumRepo.insertTopics([
            {
              unitId: unitRow.id,
              userId: user.id,
              title: topic.title,
              position: topic.position,
              weight: topic.weight.toFixed(3),
            },
          ]);
          if (!topicRow) continue;

          const conceptRows = await curriculumRepo.insertConcepts(
            topic.concepts.map((c, i) => ({
              topicId: topicRow.id,
              curriculumId: curriculum.id,
              userId: user.id,
              conceptKey: c.conceptKey,
              title: c.title,
              description: c.description ?? null,
              position: i,
              estimatedMinutes: c.estimatedMinutes,
              difficulty: c.difficulty,
              examWeight: c.examWeight.toFixed(3),
              status: 'not_started' as const,
            })),
          );
          topic.concepts.forEach((c, i) => {
            const row = conceptRows[i];
            if (row) conceptIdByTemplateKey.set(c.key, row.id);
          });
        }
      }
    }

    // Acyclicity is enforced here rather than by a DB trigger, which would be
    // O(n^2) on bulk insert (DATABASE_DESIGN §4.2 note). `breakCycles` is the
    // same function the scheduler uses, so "no cycle at write time" and "no
    // cycle at schedule time" are the same guarantee (E-5).
    const candidateEdges: CoreConceptEdge[] = tree.edges
      .map((e): CoreConceptEdge | null => {
        const fromConceptId = conceptIdByTemplateKey.get(e.from);
        const toConceptId = conceptIdByTemplateKey.get(e.to);
        if (!fromConceptId || !toConceptId) return null;
        return { fromConceptId, toConceptId, type: 'prerequisite_of', strength: e.strength };
      })
      .filter((e): e is CoreConceptEdge => e !== null);

    const nodesForCycleCheck: CoreConceptNode[] = Array.from(conceptIdByTemplateKey.values()).map(
      (id) => ({ id, title: '', examWeight: 0, estimatedMinutes: 0, status: 'not_started' }),
    );
    const { edges: acyclicEdges, brokenEdges } = breakCycles(nodesForCycleCheck, candidateEdges);
    if (brokenEdges.length > 0) {
      logger.warn('curriculum template produced a prerequisite cycle; weakest edges dropped', {
        templateSlug: input.templateSlug,
        brokenCount: brokenEdges.length,
      });
    }

    await curriculumRepo.insertEdges(
      acyclicEdges.map((e) => ({
        userId: user.id,
        curriculumId: curriculum.id,
        fromConceptId: e.fromConceptId,
        toConceptId: e.toConceptId,
        type: e.type,
        strength: e.strength.toFixed(2),
      })),
    );

    return { goal, curriculum };
  });

  await generateInitialPlan(user, goal);

  logger.info('goal created', { goalId: goal.id, templateSlug: input.templateSlug });
  trackEvent(user.id, EVENTS.goalCreated, {
    templateSlug: input.templateSlug,
    conceptCount: curriculum.totalConcepts,
  });
  return { goal, curriculum };
}

export async function getGoal(user: UserRow, goalId: string): Promise<GoalRow> {
  const goal = await goalsRepository(getDb()).findById(user.id, goalId);
  if (!goal) throw ApiError.notFound();
  return goal;
}

export async function listGoals(user: UserRow): Promise<GoalRow[]> {
  return goalsRepository(getDb()).listForUser(user.id);
}

export async function getGraph(
  user: UserRow,
  goalId: string,
): Promise<{
  concepts: ConceptRow[];
  edges: ConceptEdgeRow[];
  masteryByConcept: Map<string, number>;
}> {
  const db = getDb();
  const goal = await getGoal(user, goalId);
  const curriculum = await curriculumRepository(db).findByGoal(user.id, goal.id);
  if (!curriculum) throw ApiError.notFound();

  const concepts = await curriculumRepository(db).listConcepts(user.id, curriculum.id);
  const edges = await curriculumRepository(db).listEdges(user.id, curriculum.id);
  const masteryStates = await memoryRepository(db).listMasteryStates(
    user.id,
    concepts.map((c) => c.id),
  );
  const masteryByConcept = new Map(masteryStates.map((m) => [m.conceptId, Number(m.mastery)]));

  return { concepts, edges, masteryByConcept };
}

export async function updateConceptStatus(
  user: UserRow,
  conceptId: string,
  input: UpdateConceptStatusRequest,
): Promise<ConceptRow> {
  const updated = await curriculumRepository(getDb()).updateConceptStatus(
    user.id,
    conceptId,
    input.status,
  );
  if (!updated) throw ApiError.notFound();
  // §10.5: excluding or marking a concept already_known changes scope and
  // feasibility. M0 ships manual-trigger re-planning only (§1.1) — the
  // caller re-plans explicitly via POST /goals/{goalId}/plans/regenerate
  // rather than this endpoint doing it implicitly.
  return updated;
}

export async function updateConceptStatusWithMastery(
  user: UserRow,
  conceptId: string,
  input: UpdateConceptStatusRequest,
): Promise<{ concept: ConceptRow; mastery: number | null }> {
  const concept = await updateConceptStatus(user, conceptId, input);
  const masteryState = await memoryRepository(getDb()).getMasteryState(user.id, conceptId);
  return { concept, mastery: masteryState ? Number(masteryState.mastery) : null };
}

/**
 * Change a goal's planner constraints, and make the change actually mean
 * something.
 *
 * The exam date is the most consequential number in the product — it sets the
 * horizon every projection, verdict and priority is computed against — and it
 * was the one number a learner could not change. Exams move. A learner sitting
 * on an obsolete date had a planner confidently optimising towards a day that
 * no longer existed, with no route out short of abandoning their history.
 *
 * Two things make this safe to allow:
 *
 *   **Evidence is untouched.** Mastery, memory and session rows are keyed to
 *   concepts; the curriculum is not editable here, so nothing they have earned
 *   is orphaned or rewritten. Moving the date changes what FRIDAY *plans*, never
 *   what the learner *did*.
 *
 *   **The plan is re-derived, not left stale.** Writing the row without a
 *   re-plan would be the availability bug again — a saved constraint the
 *   planner never read. This fires the same `constraint` trigger, which is
 *   exempt from the churn budget precisely because the learner asked for it.
 */
export async function updateGoal(
  user: UserRow,
  goalId: string,
  input: UpdateGoalRequest,
): Promise<GoalRow> {
  const db = getDb();
  const goal = await goalsRepository(db).findById(user.id, goalId);
  if (!goal) throw ApiError.notFound();

  if (input.targetDate !== undefined) {
    if (input.targetDate <= today()) {
      throw new ApiError(ERROR_CODES.TARGET_DATE_IN_PAST); // E-7, same rule as creation
    }
    // `goals_target_after_start` is a table-level check; failing it would
    // surface as a 500. A learner moving an exam earlier than the day they
    // started studying is a validation error, not a server error.
    if (input.targetDate <= goal.startDate) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `The target date must be after the goal's start date (${goal.startDate}).`,
      );
    }
  }

  const updated = await goalsRepository(db).update(user.id, goalId, {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.targetDate !== undefined ? { targetDate: input.targetDate } : {}),
    ...(input.targetWeeklyMinutes !== undefined
      ? { targetWeeklyMinutes: input.targetWeeklyMinutes }
      : {}),
  });
  if (!updated) throw ApiError.notFound();

  logger.info('goal updated', {
    goalId,
    changed: Object.keys(input),
    targetDate: updated.targetDate,
  });
  trackEvent(user.id, EVENTS.goalUpdated, { changed: Object.keys(input).sort().join(',') });

  // Only a horizon or capacity change can alter what the planner would decide;
  // renaming a goal must not churn the plan.
  const affectsPlanning = input.targetDate !== undefined || input.targetWeeklyMinutes !== undefined;
  if (affectsPlanning && updated.status === 'active') {
    await replanQuietly(user, goalId, 'goal_changed', 'constraint');
  }

  return updated;
}

export function toWireGoal(goal: GoalRow) {
  return {
    id: goal.id,
    title: goal.title,
    type: goal.type,
    status: goal.status,
    startDate: goal.startDate,
    targetDate: goal.targetDate,
    targetWeeklyMinutes: goal.targetWeeklyMinutes,
    createdAt: goal.createdAt.toISOString(),
  };
}

export function toWireConcept(concept: ConceptRow, mastery: number | null) {
  return {
    id: concept.id,
    title: concept.title,
    status: concept.status,
    examWeight: Number(concept.examWeight),
    estimatedMinutes: concept.estimatedMinutes,
    mastery,
  };
}
