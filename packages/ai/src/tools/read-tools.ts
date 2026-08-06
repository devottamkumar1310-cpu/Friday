import { z } from 'zod';
import { defineTool, type ExecutorMap, type ToolDefinition } from './types';

/**
 * Read tools — SYSTEM_ARCHITECTURE §5.6. Roadmap 2.5.
 *
 * Declarations only. `packages/ai` may not import `packages/db` (ADR-017), so
 * every one of these is executed by an injected, user-scoped function supplied
 * by the service layer. The agent receives an executor map at construction and
 * never holds a database handle.
 *
 * All seven are `kind: 'read'` and therefore run without confirmation. Write
 * tools arrive in M1 and return a *proposal* instead (§5.6) — the distinction
 * is carried in the type so it cannot be forgotten at the call site.
 */

const ConceptRefSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  mastery: z.number().min(0).max(1),
});

export const getGoalStatus = defineTool({
  name: 'get_goal_status',
  description:
    "The learner's active goal, weighted progress, feasibility verdict, and projected completion date.",
  kind: 'read',
  args: z.object({}),
  result: z.object({
    title: z.string(),
    targetDate: z.string(),
    daysRemaining: z.number().int(),
    weightedProgress: z.number(),
    verdict: z.enum(['on_track', 'at_risk', 'not_feasible']),
    projectedCompletionDate: z.string().nullable(),
  }),
});

export const getPlan = defineTool({
  name: 'get_plan',
  description:
    'Scheduled tasks in a date range, from the current plan version. Dates are YYYY-MM-DD.',
  kind: 'read',
  args: z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  result: z.object({
    planVersion: z.number().int(),
    tasks: z.array(
      z.object({
        title: z.string(),
        type: z.string(),
        scheduledDate: z.string(),
        estimatedMinutes: z.number().int(),
        status: z.string(),
      }),
    ),
  }),
});

export const getMastery = defineTool({
  name: 'get_mastery',
  description: 'Mastery for specific concepts, or the whole curriculum when no ids are given.',
  kind: 'read',
  args: z.object({ conceptIds: z.array(z.string().uuid()).max(50).optional() }),
  result: z.object({ concepts: z.array(ConceptRefSchema) }),
});

export const getWeakConcepts = defineTool({
  name: 'get_weak_concepts',
  description:
    'The learner’s weakest concepts, ranked by exam-weighted mastery gap. Use this before giving study advice.',
  kind: 'read',
  args: z.object({ limit: z.number().int().min(1).max(20).default(5) }),
  result: z.object({
    concepts: z.array(
      ConceptRefSchema.extend({
        examWeight: z.number(),
        evidenceCount: z.number().int(),
      }),
    ),
  }),
});

export const getDueReviews = defineTool({
  name: 'get_due_reviews',
  description: 'Concepts due or overdue for review, most overdue first.',
  kind: 'read',
  args: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
  result: z.object({
    dueNow: z.number().int(),
    overdue: z.number().int(),
    concepts: z.array(
      ConceptRefSchema.extend({
        dueAt: z.string(),
        daysOverdue: z.number(),
      }),
    ),
  }),
});

export const getSessionHistory = defineTool({
  name: 'get_session_history',
  description: 'Recent study sessions with duration and self-rating.',
  kind: 'read',
  args: z.object({ limit: z.number().int().min(1).max(20).default(5) }),
  result: z.object({
    sessions: z.array(
      z.object({
        date: z.string(),
        activeMinutes: z.number().int(),
        selfRating: z.string().nullable(),
        conceptTitles: z.array(z.string()),
      }),
    ),
  }),
});

export const getNextAction = defineTool({
  name: 'get_next_action',
  description:
    'The single highest-priority next action, with its factor breakdown. This is computed deterministically — report it, do not recompute or second-guess it.',
  kind: 'read',
  args: z.object({ availableMinutes: z.number().int().min(1).max(600).default(60) }),
  result: z.object({
    title: z.string().nullable(),
    type: z.string().nullable(),
    estimatedMinutes: z.number().int().nullable(),
    rationale: z.string().nullable(),
    dominantFactor: z.string().nullable(),
  }),
});

/** The Coach's tool set. Ordered for a stable prompt prefix (§5.4). */
export const COACH_TOOLS = {
  getGoalStatus,
  getPlan,
  getMastery,
  getWeakConcepts,
  getDueReviews,
  getSessionHistory,
  getNextAction,
} as const satisfies Record<string, ToolDefinition>;

export type CoachToolRegistry = typeof COACH_TOOLS;
export type CoachExecutors = ExecutorMap<CoachToolRegistry>;

/** Resolves a wire tool name (`get_weak_concepts`) to its registry entry. */
export function findToolByName(
  name: string,
): { key: keyof CoachToolRegistry; definition: ToolDefinition } | undefined {
  for (const [key, definition] of Object.entries(COACH_TOOLS)) {
    if (definition.name === name) {
      return { key: key as keyof CoachToolRegistry, definition };
    }
  }
  return undefined;
}
