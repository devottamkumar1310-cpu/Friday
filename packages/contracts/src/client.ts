import { type z } from './zod';
import {
  API_PREFIX,
  ENDPOINTS,
  type EndpointDef,
  type EndpointName,
  type RequestBodyOf,
  type ResponseOf,
} from './registry';
import { ERROR_CODES, type ErrorCode, type ErrorDetail } from './errors';

/**
 * Typed API client, derived from the same endpoint registry that produces
 * openapi.v1.json. There is no code generation step and no JSON-Schema
 * round-trip, so the client's types are the schemas themselves.
 */

export class ApiClientError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly requestId: string | undefined;
  readonly details: ErrorDetail[] | undefined;
  readonly retryable: boolean;

  constructor(init: {
    code: ErrorCode;
    message: string;
    status: number;
    requestId?: string;
    details?: ErrorDetail[];
    retryable?: boolean;
  }) {
    super(init.message);
    this.name = 'ApiClientError';
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId;
    this.details = init.details;
    this.retryable = init.retryable ?? false;
  }
}

export interface ClientOptions {
  /** Defaults to the same-origin version prefix. */
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  /** Extra headers per request, e.g. a bearer token on mobile (v1.1). */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  /**
   * Validate responses against their schema. On by default: contract drift
   * should surface as a loud failure in development, not a silent undefined
   * three components deep.
   */
  validate?: boolean;
}

type BaseArgs = {
  signal?: AbortSignal;
  idempotencyKey?: string;
  /** Values for `{param}` placeholders in the endpoint's path, e.g. `{ goalId: '018f...' }`. */
  params?: Record<string, string>;
  /** Query string values, e.g. `{ availableMinutes: '25' }`. */
  query?: Record<string, string>;
};

export type CallArgs<K extends EndpointName> = (typeof ENDPOINTS)[K] extends {
  body: z.ZodTypeAny;
}
  ? BaseArgs & { body: RequestBodyOf<K> }
  : BaseArgs;

export function createClient(options: ClientOptions = {}) {
  const baseUrl = options.baseUrl ?? API_PREFIX;
  const doFetch = options.fetch ?? globalThis.fetch;
  const validate = options.validate ?? true;

  async function call<K extends EndpointName>(name: K, args: CallArgs<K>): Promise<ResponseOf<K>> {
    const def = ENDPOINTS[name] as EndpointDef;
    const body = 'body' in args ? (args as BaseArgs & { body: unknown }).body : undefined;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(options.headers ? await options.headers() : {}),
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    // AP6: mobile networks retry, so mutating calls must be safe to replay.
    if (args.idempotencyKey) headers['Idempotency-Key'] = args.idempotencyKey;

    let path: string = def.path;
    for (const [key, value] of Object.entries(args.params ?? {})) {
      path = path.replace(`{${key}}`, encodeURIComponent(value));
    }
    const queryEntries = Object.entries(args.query ?? {});
    const search =
      queryEntries.length > 0 ? `?${new URLSearchParams(queryEntries).toString()}` : '';

    const response = await doFetch(`${baseUrl}${path}${search}`, {
      method: def.method,
      headers,
      credentials: 'include',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(args.signal ? { signal: args.signal } : {}),
    });

    const text = await response.text();
    const payload: unknown = text ? JSON.parse(text) : null;

    if (!response.ok) throw toClientError(payload, response.status);

    if (!validate) return payload as ResponseOf<K>;

    const parsed = def.response.safeParse(payload);
    if (!parsed.success) {
      throw new ApiClientError({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: `Response for ${String(name)} did not match its schema. This is a contract drift bug, not a user error.`,
        status: response.status,
        details: parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          issue: i.message,
        })),
      });
    }
    return parsed.data as ResponseOf<K>;
  }

  return { call };
}

export type ApiClient = ReturnType<typeof createClient>;

function toClientError(payload: unknown, status: number): ApiClientError {
  const wire = payload as
    | { error?: { code?: string; message?: string; requestId?: string; retryable?: boolean } }
    | undefined;
  const err = wire?.error;

  return new ApiClientError({
    code: (err?.code as ErrorCode) ?? ERROR_CODES.INTERNAL_ERROR,
    message: err?.message ?? 'The request failed.',
    status,
    ...(err?.requestId ? { requestId: err.requestId } : {}),
    retryable: err?.retryable ?? status >= 500,
  });
}
