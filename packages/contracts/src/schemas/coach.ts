import { z } from '../zod';
import { envelope } from '../envelope';
import { DateTimeSchema, UuidSchema } from '../primitives';

/** Coach — API_SPECIFICATION §5.10. Roadmap 2.6. */

export const CoachThreadSchema = z
  .object({
    id: UuidSchema,
    goalId: UuidSchema.nullable(),
    title: z.string().nullable(),
    lastMessageAt: DateTimeSchema,
    createdAt: DateTimeSchema,
  })
  .openapi('CoachThread');

export const CoachThreadListResponseSchema = envelope(z.array(CoachThreadSchema));

export const CreateThreadRequestSchema = z
  .object({ goalId: UuidSchema.nullable().optional() })
  .strict()
  .openapi('CreateThreadRequest');
export type CreateThreadRequest = z.infer<typeof CreateThreadRequestSchema>;

export const CoachThreadResponseSchema = envelope(CoachThreadSchema);

export const CoachMessageSchema = z
  .object({
    id: UuidSchema,
    role: z.enum(['user', 'assistant', 'tool']),
    content: z.string(),
    toolCalls: z.unknown().nullable(),
    createdAt: DateTimeSchema,
  })
  .openapi('CoachMessage');

export const CoachThreadDetailResponseSchema = envelope(
  z.object({ thread: CoachThreadSchema, messages: z.array(CoachMessageSchema) }),
);

export const SendCoachMessageRequestSchema = z
  .object({ content: z.string().trim().min(1).max(4000) })
  .strict()
  .openapi('SendCoachMessageRequest');
export type SendCoachMessageRequest = z.infer<typeof SendCoachMessageRequestSchema>;

/**
 * The SSE event union (§5.10). Documented as a schema even though the endpoint
 * streams rather than returning JSON — clients still need the shape, and it is
 * what keeps the route handler a pass-through.
 */
export const CoachStreamEventSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('start'), messageId: UuidSchema, model: z.string() }),
    z.object({ type: z.literal('tool_call'), name: z.string(), args: z.unknown() }),
    z.object({ type: z.literal('tool_result'), name: z.string(), summary: z.string() }),
    z.object({ type: z.literal('delta'), text: z.string() }),
    z.object({
      type: z.literal('done'),
      messageId: UuidSchema,
      usage: z.object({
        inputTokens: z.number().int(),
        outputTokens: z.number().int(),
        cachedTokens: z.number().int(),
      }),
      costUsd: z.number(),
    }),
    z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
  ])
  .openapi('CoachStreamEvent');
