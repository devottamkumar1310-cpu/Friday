import type { CoachMessageRow, CoachThreadRow } from '@friday/db';

/** Wire projections for coach resources — API_SPECIFICATION §5.10. */

export function toWireThread(row: CoachThreadRow) {
  return {
    id: row.id,
    goalId: row.goalId,
    title: row.title,
    lastMessageAt: row.lastMessageAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toWireMessage(row: CoachMessageRow) {
  return {
    id: row.id,
    role: row.role as 'user' | 'assistant' | 'tool',
    content: row.content,
    toolCalls: row.toolCalls ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
