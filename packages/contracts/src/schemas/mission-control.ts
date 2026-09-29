import { z } from '../zod';
import { envelope } from '../envelope';
import { DateOnlySchema, DateTimeSchema, UuidSchema } from '../primitives';
import { FeasibilityVerdictSchema, TaskSchema } from './planning';
import { NextActionResponseSchema } from './next-action';

/**
 * Mission Control — the composite deterministic-engine surface the user asked
 * for in Phase 1: Today's Mission, Next Action, Progress, Risks, and
 * recommendation rationale, in one response. Each field is a direct
 * projection of `packages/core` output; nothing here is computed by an LLM
 * (DP1). `GET /goals/{goalId}/next-action` also exists standalone, exactly
 * per API_SPECIFICATION §5.5 — this endpoint composes it with the rest.
 */

const NextActionDataSchema = NextActionResponseSchema.shape.data;

export const TodaysMissionSchema = z
  .object({
    date: DateOnlySchema,
    capacityMinutes: z.number().int(),
    plannedMinutes: z.number().int(),
    tasks: z.array(TaskSchema),
  })
  .openapi('TodaysMission');

export const ProgressSummarySchema = z
  .object({
    weightedProgress: z.number().min(0).max(1),
    conceptsMastered: z.number().int(),
    conceptsTotal: z.number().int(),
    verdict: FeasibilityVerdictSchema,
    projectedCompletionDate: DateOnlySchema.nullable(),
    daysRemaining: z.number().int(),
  })
  .openapi('ProgressSummary');

export const RiskSchema = z
  .object({
    id: z.string(),
    severity: z.enum(['low', 'medium', 'high']),
    title: z.string(),
    detail: z.string(),
    conceptIds: z.array(UuidSchema).default([]),
  })
  .openapi('Risk');

export const MissionControlResponseSchema = envelope(
  z.object({
    goalId: UuidSchema,
    /**
     * What the last committed re-plan actually did, when it retired missed
     * work. Null otherwise — there is no "nothing changed" wording, because a
     * reassurance nobody asked for reads as one the system needed to give.
     */
    planChange: z.object({ statement: z.string(), evidence: z.string() }).nullable(),
    today: TodaysMissionSchema,
    nextAction: NextActionDataSchema,
    progress: ProgressSummarySchema,
    risks: z.array(RiskSchema),
    computedAt: DateTimeSchema,
  }),
);
export type MissionControlResponse = z.infer<typeof MissionControlResponseSchema>;
