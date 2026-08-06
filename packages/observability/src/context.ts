import { AsyncLocalStorage } from 'node:async_hooks';
import { v7 as uuidv7 } from 'uuid';

/**
 * Request-scoped context.
 *
 * SYSTEM_ARCHITECTURE §11: every request carries a `request_id`, propagated
 * through services, jobs, AI calls, and logs, so that one id reconstructs an
 * entire causal chain. AsyncLocalStorage carries it without threading a
 * parameter through every function signature.
 */

export interface RequestContext {
  requestId: string;
  userId?: string;
  route?: string;
  startedAt: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function newRequestId(): string {
  return uuidv7();
}

/** Run `fn` with a fresh context. Everything downstream sees the same id. */
export function withRequestContext<T>(
  init: Partial<RequestContext> & { requestId: string },
  fn: () => T,
): T {
  return storage.run({ startedAt: Date.now(), ...init }, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * Attach the authenticated user once identified. Mutating the active store is
 * deliberate — the id is discovered mid-request, after the context is created.
 */
export function setContextUser(userId: string): void {
  const store = storage.getStore();
  if (store) store.userId = userId;
}
