import { NextResponse, type NextRequest } from 'next/server';
import type { z } from 'zod';
import { ApiError, ERROR_CODES, isApiError, type ErrorDetail } from '@friday/contracts';
import type { AuthSessionRow, UserRow } from '@friday/db';
import { captureException, newRequestId, withRequestContext } from '@friday/observability';
import {
  resolveSession,
  touchSession,
  type RequestMeta,
} from '@/modules/identity/identity.service';
import { SESSION_COOKIE } from '@/modules/identity/session';

/**
 * Route-handler plumbing — API_SPECIFICATION §3 and §6.
 *
 * Handlers are an HTTP boundary: parse, validate, authenticate, delegate to a
 * service, serialize. Everything repetitive and easy to get wrong — request-id
 * propagation, the response envelope, error mapping, the CSRF origin check —
 * lives here so a handler cannot forget it.
 */

/** The subset of cookie attributes this app sets. Explicit, so a typo is caught. */
export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  path?: string;
  maxAge?: number;
  domain?: string;
  expires?: Date;
}

export interface RouteResult<T> {
  data: T;
  status?: number;
  /** Applied to the response before it is returned. */
  cookies?: Array<
    | { action: 'set'; name: string; value: string; options: CookieOptions }
    | { action: 'delete'; name: string }
  >;
}

/** Dynamic segment values, e.g. `{ goalId: '018f...' }` for `/goals/[goalId]`. */
export type RouteParams = Record<string, string>;

interface PublicContext<TBody> {
  req: NextRequest;
  body: TBody;
  meta: RequestMeta;
  requestId: string;
  params: RouteParams;
}

interface AuthedContext<TBody> extends PublicContext<TBody> {
  user: UserRow;
  session: AuthSessionRow;
}

/** Next.js 15 app-router segment context — `params` is a Promise. */
export interface RouteSegmentContext {
  params: Promise<RouteParams>;
}

type NextHandler = (req: NextRequest, segment: RouteSegmentContext) => Promise<NextResponse>;

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** An endpoint reachable without a session. */
export function publicRoute<TSchema extends z.ZodTypeAny | undefined = undefined>(config: {
  body?: TSchema;
  handler: (
    ctx: PublicContext<TSchema extends z.ZodTypeAny ? z.infer<TSchema> : undefined>,
  ) => Promise<RouteResult<unknown>>;
}): NextHandler {
  return createHandler(async (req, requestId, params) => {
    assertSameOrigin(req);
    const body = await parseBody(req, config.body);
    return config.handler({
      req,
      body,
      meta: requestMeta(req),
      requestId,
      params,
    } as PublicContext<TSchema extends z.ZodTypeAny ? z.infer<TSchema> : undefined>);
  });
}

/** An endpoint requiring a valid session. */
export function authedRoute<TSchema extends z.ZodTypeAny | undefined = undefined>(config: {
  body?: TSchema;
  handler: (
    ctx: AuthedContext<TSchema extends z.ZodTypeAny ? z.infer<TSchema> : undefined>,
  ) => Promise<RouteResult<unknown>>;
}): NextHandler {
  return createHandler(async (req, requestId, params) => {
    assertSameOrigin(req);

    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (!token) throw new ApiError(ERROR_CODES.SESSION_EXPIRED);

    const resolved = await resolveSession(token);
    if (!resolved) throw new ApiError(ERROR_CODES.SESSION_EXPIRED);

    await touchSession(resolved.session);

    const body = await parseBody(req, config.body);
    return config.handler({
      req,
      body,
      meta: requestMeta(req),
      requestId,
      params,
      user: resolved.user,
      session: resolved.session,
    } as AuthedContext<TSchema extends z.ZodTypeAny ? z.infer<TSchema> : undefined>);
  });
}

/**
 * An authenticated endpoint that responds with an SSE stream rather than JSON
 * (API_SPECIFICATION §5.10).
 *
 * Shares the auth, CSRF, and request-id handling of `authedRoute` — the only
 * difference is the response shape, and that difference is deliberately the
 * *only* thing a caller has to think about. Errors raised before the first byte
 * still return a normal JSON error; once the stream is open, failures are
 * delivered as an `error` event instead, because the status line has already
 * been sent.
 */
export function sseRoute<TSchema extends z.ZodTypeAny | undefined = undefined>(config: {
  body?: TSchema;
  /**
   * Returns the stream rather than being a generator itself.
   *
   * The distinction is load-bearing: a generator function's body does not run
   * until its first `next()`, which is after the 200 and the headers have
   * already gone out — so a pre-flight failure would arrive as a mid-stream
   * error instead of an honest status code. An async function that throws
   * before returning its iterable fails while a real error response is still
   * possible.
   */
  handler: (
    ctx: AuthedContext<TSchema extends z.ZodTypeAny ? z.infer<TSchema> : undefined>,
  ) => Promise<AsyncIterable<{ event: string; data: unknown }>>;
}): NextHandler {
  return async (req, segment) => {
    const requestId = req.headers.get('x-request-id') ?? newRequestId();

    return withRequestContext(
      { requestId, route: `${req.method} ${new URL(req.url).pathname}` },
      async () => {
        try {
          assertSameOrigin(req);

          const token = req.cookies.get(SESSION_COOKIE)?.value;
          if (!token) throw new ApiError(ERROR_CODES.SESSION_EXPIRED);

          const resolved = await resolveSession(token);
          if (!resolved) throw new ApiError(ERROR_CODES.SESSION_EXPIRED);
          await touchSession(resolved.session);

          const params = (await segment?.params) ?? {};
          const body = await parseBody(req, config.body);

          // Awaited here, so anything that fails before the first chunk — an
          // unconfigured provider, a missing thread — still becomes a normal
          // JSON error rather than a 200 carrying an error event.
          const iterator = await config.handler({
            req,
            body,
            meta: requestMeta(req),
            requestId,
            params,
            user: resolved.user,
            session: resolved.session,
          } as AuthedContext<TSchema extends z.ZodTypeAny ? z.infer<TSchema> : undefined>);

          const encoder = new TextEncoder();
          const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
              try {
                for await (const { event, data } of iterator) {
                  controller.enqueue(
                    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
                  );
                }
              } catch (error) {
                // Once the stream is open the status line is spent, so a
                // failure is delivered as an event. Preserve the real code
                // where we have one — "AI_UNAVAILABLE" is actionable,
                // "INTERNAL_ERROR" is not.
                if (!isApiError(error)) captureException({ error, context: { requestId } });
                const apiError = isApiError(error)
                  ? error
                  : new ApiError(ERROR_CODES.INTERNAL_ERROR, 'The stream ended unexpectedly.');
                controller.enqueue(
                  encoder.encode(
                    `event: error\ndata: ${JSON.stringify({
                      code: apiError.code,
                      message: apiError.message,
                    })}\n\n`,
                  ),
                );
              } finally {
                controller.close();
              }
            },
          });

          return new NextResponse(stream, {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'private, no-store, no-transform',
              Connection: 'keep-alive',
              'X-Request-Id': requestId,
              // Proxies that buffer defeat streaming entirely; this is the
              // conventional opt-out and costs nothing where it is ignored.
              'X-Accel-Buffering': 'no',
            },
          });
        } catch (error) {
          return errorResponse(error, requestId);
        }
      },
    );
  };
}

function createHandler(
  run: (req: NextRequest, requestId: string, params: RouteParams) => Promise<RouteResult<unknown>>,
): NextHandler {
  return async (req, segment) => {
    // Honour an inbound id so a trace spans the client and the server; mint one
    // otherwise. Either way every log line and error carries it (§11).
    const requestId = req.headers.get('x-request-id') ?? newRequestId();

    return withRequestContext(
      { requestId, route: `${req.method} ${new URL(req.url).pathname}` },
      async () => {
        try {
          const params = (await segment?.params) ?? {};
          const result = await run(req, requestId, params);
          return respond(result, requestId);
        } catch (error) {
          return errorResponse(error, requestId);
        }
      },
    );
  };
}

function respond(result: RouteResult<unknown>, requestId: string): NextResponse {
  const response = NextResponse.json(
    {
      data: result.data,
      meta: { requestId, timestamp: new Date().toISOString() },
    },
    { status: result.status ?? 200 },
  );

  response.headers.set('X-Request-Id', requestId);
  response.headers.set('Cache-Control', 'private, no-store');

  for (const op of result.cookies ?? []) {
    if (op.action === 'set') response.cookies.set(op.name, op.value, op.options);
    else response.cookies.delete(op.name);
  }

  return response;
}

function errorResponse(error: unknown, requestId: string): NextResponse {
  const apiError = isApiError(error) ? error : new ApiError(ERROR_CODES.INTERNAL_ERROR);

  // Expected, handled failures are not incidents; unexpected ones are.
  if (!isApiError(error)) {
    captureException({ error, context: { requestId } });
  }

  const response = NextResponse.json(apiError.toWire(requestId), { status: apiError.status });
  response.headers.set('X-Request-Id', requestId);
  if (apiError.retryable) response.headers.set('Retry-After', '30');
  return response;
}

async function parseBody<TSchema extends z.ZodTypeAny | undefined>(
  req: NextRequest,
  schema: TSchema,
): Promise<unknown> {
  if (!schema) return undefined;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'Request body must be valid JSON.');
  }

  const parsed = (schema as z.ZodTypeAny).safeParse(raw);
  if (!parsed.success) {
    const details: ErrorDetail[] = parsed.error.issues.map((issue) => ({
      field: issue.path.join('.') || undefined,
      issue: issue.message,
    }));
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, undefined, details);
  }
  return parsed.data;
}

/**
 * CSRF defence, paired with SameSite=Lax on the session cookie (§4.1).
 * A cross-site form post carries the cookie under Lax for top-level navigation,
 * so the origin check is what actually stops it.
 */
function assertSameOrigin(req: NextRequest): void {
  if (!MUTATING.has(req.method)) return;

  const origin = req.headers.get('origin');
  if (!origin) return; // Same-origin fetches from some clients omit it entirely.

  const allowed = process.env['APP_URL'] ?? new URL(req.url).origin;
  if (new URL(origin).origin !== new URL(allowed).origin) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, 'Cross-origin request rejected.');
  }
}

/** Reads a required dynamic-segment value, e.g. `requireParam(params, 'goalId')`. */
export function requireParam(params: RouteParams, name: string): string {
  const value = params[name];
  if (!value)
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `Missing path parameter "${name}".`);
  return value;
}

function requestMeta(req: NextRequest): RequestMeta {
  const forwarded = req.headers.get('x-forwarded-for');
  return {
    ipAddress: forwarded?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent'),
  };
}
