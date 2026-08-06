import {
  COACH_PROMPT,
  estimateCostUsd,
  modelIdFor,
  redactPacketForLog,
  runCoachTurn,
  tierFor,
  type CoachEvent,
} from '@friday/ai';
import { ApiError, ERROR_CODES } from '@friday/contracts';
import {
  coachRepository,
  getDb,
  goalsRepository,
  newId,
  type CoachMessageRow,
  type CoachThreadRow,
  type UserRow,
} from '@friday/db';
import { logger } from '@friday/observability';
import { buildLearnerContext } from '../ai/context-builder';
import { buildCoachExecutors } from '../ai/tool-executors';
import { checkBudget, getModelProvider, recordAiCall } from '../ai/provider';

/**
 * Coach service — roadmap 2.6.
 *
 * Owns the transaction boundary and persistence around a turn; the agent itself
 * lives in `packages/ai` and knows nothing about the database (ADR-017).
 *
 * The assistant message is persisted **after** the stream completes, not
 * during. A turn that dies halfway leaves no half-written reply in the thread,
 * which matters because `coach_messages` is replayed as history on the next
 * turn — a truncated message would silently corrupt every subsequent one.
 */

const MAX_HISTORY_MESSAGES = 20;

export async function listThreads(user: UserRow): Promise<CoachThreadRow[]> {
  return coachRepository(getDb()).listThreads(user.id);
}

export async function createThread(user: UserRow, goalId: string | null): Promise<CoachThreadRow> {
  if (goalId) {
    const goal = await goalsRepository(getDb()).findById(user.id, goalId);
    if (!goal) throw ApiError.notFound();
  }
  return coachRepository(getDb()).createThread({ userId: user.id, goalId });
}

export async function getThread(
  user: UserRow,
  threadId: string,
): Promise<{ thread: CoachThreadRow; messages: CoachMessageRow[] }> {
  const db = getDb();
  const thread = await coachRepository(db).findThread(user.id, threadId);
  if (!thread) throw ApiError.notFound();
  const messages = await coachRepository(db).listMessages(user.id, threadId);
  return { thread, messages };
}

export async function archiveThread(user: UserRow, threadId: string): Promise<void> {
  const thread = await coachRepository(getDb()).findThread(user.id, threadId);
  if (!thread) throw ApiError.notFound();
  await coachRepository(getDb()).archiveThread(user.id, threadId);
}

export interface SendMessageInput {
  threadId: string;
  content: string;
  requestId?: string;
}

/**
 * Streams one Coach turn, persisting both sides of it.
 *
 * Yields the same `CoachEvent` shape the route serialises to SSE, so the
 * handler stays a pass-through (API_SPECIFICATION §5.10).
 */
export async function* sendMessage(
  user: UserRow,
  input: SendMessageInput,
): AsyncIterable<CoachEvent> {
  const db = getDb();
  const coach = coachRepository(db);

  const thread = await coach.findThread(user.id, input.threadId);
  if (!thread) throw ApiError.notFound();

  // Persist the learner's message first: if the model call fails, what they
  // said is still in the thread and they are not asked to retype it.
  await coach.appendMessage({
    threadId: thread.id,
    userId: user.id,
    role: 'user',
    content: input.content,
  });
  await coach.touchThread(user.id, thread.id);

  const priorMessages = await coach.listMessages(user.id, thread.id);
  const history = priorMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-MAX_HISTORY_MESSAGES - 1, -1) // exclude the message we just wrote
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const { overBudget } = await checkBudget(user.id);
  const packet = await buildLearnerContext(user, thread.goalId, 'coach');
  const executors = buildCoachExecutors(user, thread.goalId);
  const messageId = newId();
  const startedAt = Date.now();

  let assistantText = '';
  let finalUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  let status: 'ok' | 'error' = 'ok';
  let errorMessage: string | null = null;
  const toolCalls: { name: string; args: unknown }[] = [];

  for await (const event of runCoachTurn({
    provider: getModelProvider(),
    packet,
    history,
    userMessage: input.content,
    executors,
    userId: user.id,
    messageId,
    overBudget,
  })) {
    if (event.type === 'delta') assistantText += event.text;
    if (event.type === 'tool_call') toolCalls.push({ name: event.name, args: event.args });
    if (event.type === 'done') finalUsage = event.usage;
    if (event.type === 'error') {
      status = 'error';
      errorMessage = event.message;
    }
    yield event;
  }

  const costUsd = estimateCostUsd(tierFor('coach'), finalUsage);

  const aiCall = await recordAiCallSafely({
    userId: user.id,
    agent: 'coach',
    model: modelIdFor('coach'),
    promptVersion: COACH_PROMPT.version,
    status,
    usage: finalUsage,
    costUsd,
    latencyMs: Date.now() - startedAt,
    contextPacket: redactPacketForLog(packet),
    error: errorMessage,
    requestId: input.requestId ?? null,
  });

  if (status === 'ok' && assistantText.length > 0) {
    await coach.appendMessage({
      threadId: thread.id,
      userId: user.id,
      role: 'assistant',
      content: assistantText,
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
      contextPacketRef: aiCall,
    });
    await coach.touchThread(user.id, thread.id);

    // First exchange names the thread, from the learner's own words rather than
    // a model call — a title is not worth a round trip (§5.3 control 3).
    if (!thread.title) {
      const title = input.content.trim().slice(0, 60);
      await coach.setThreadTitle(user.id, thread.id, title || 'New conversation');
    }
  }

  logger.info('coach turn complete', {
    threadId: thread.id,
    status,
    toolCalls: toolCalls.length,
    outputTokens: finalUsage.outputTokens,
  });
}

/**
 * Logging a call must never be the reason a turn fails. The learner already
 * has their answer by this point; losing the audit row is a real cost but a
 * smaller one than a 500 after a successful reply.
 */
async function recordAiCallSafely(
  input: Parameters<typeof recordAiCall>[0],
): Promise<string | null> {
  try {
    return await recordAiCall(input);
  } catch {
    logger.warn('failed to record ai_call', { agent: input.agent });
    return null;
  }
}

export function assertCoachAvailable(): void {
  // The Coach is the one surface that genuinely cannot degrade to a
  // deterministic fallback — there is no non-AI version of a conversation.
  // Everything else in the product keeps working (NFR-2.2).
  if (!process.env['ANTHROPIC_API_KEY']) {
    throw new ApiError(
      ERROR_CODES.AI_UNAVAILABLE,
      'The coach is not configured in this environment. Your plan, next action, and sessions are unaffected.',
    );
  }
}
