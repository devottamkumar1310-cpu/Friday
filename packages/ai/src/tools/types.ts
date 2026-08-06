import type { z } from 'zod';

/**
 * Tool declaration and executor injection — ADR-017.
 *
 * `packages/ai` may not import `packages/db`. Agents obviously need data, so
 * the resolution is dependency injection: this package declares *what* a tool
 * is (name, description, argument and result schemas) and the service layer
 * supplies *how* to execute it. An agent receives an executor map at
 * construction and never holds a database handle.
 *
 * That is not ceremony. It keeps the context builder the single auditable entry
 * point for everything a model sees — if agents could fetch on their own,
 * "what was in the prompt?" would stop being answerable, and both cost
 * predictability and prompt-injection containment would go with it.
 */

export interface ToolDefinition<
  A extends z.ZodTypeAny = z.ZodTypeAny,
  R extends z.ZodTypeAny = z.ZodTypeAny,
> {
  readonly name: string;
  readonly description: string;
  readonly args: A;
  readonly result: R;
  /**
   * Read tools run immediately. Write tools return a *proposal* that the user
   * must confirm in the UI before the service executes it — which is what stops
   * injected content from silently mutating learner state (NFR-3.6).
   */
  readonly kind: 'read' | 'write';
}

/** Executors are always user-scoped. There is no unscoped data access. */
export type ToolExecutor<T extends ToolDefinition> = (
  userId: string,
  args: z.infer<T['args']>,
) => Promise<z.infer<T['result']>>;

export type ToolRegistry = Record<string, ToolDefinition>;

export type ExecutorMap<R extends ToolRegistry> = {
  [K in keyof R]: ToolExecutor<R[K]>;
};

export function defineTool<A extends z.ZodTypeAny, R extends z.ZodTypeAny>(
  definition: ToolDefinition<A, R>,
): ToolDefinition<A, R> {
  return definition;
}
