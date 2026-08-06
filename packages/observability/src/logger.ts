import { getRequestContext } from './context';
import { redact } from './redact';

/**
 * Structured logger.
 *
 * Emits one JSON object per line so Axiom (or any log pipeline) can index
 * fields without parsing rules. Every line automatically carries the ambient
 * `requestId` and `userId`, which is what makes a single id reconstruct a
 * causal chain across services, jobs, and AI calls.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const SEVERITY: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Derive a logger with fields merged into every subsequent line. */
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Static fields on every line, e.g. `{ service: 'web' }`. */
  base?: LogFields;
  /** Defaults to stdout via console. Override in tests. */
  sink?: (line: string) => void;
  /** Human-readable output for local development. */
  pretty?: boolean;
}

function defaultSink(line: string): void {
  // eslint-disable-next-line no-console -- the sink is the logger's output device
  console.log(line);
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const min = SEVERITY[options.level ?? 'info'];
  const sink = options.sink ?? defaultSink;
  const pretty = options.pretty ?? false;

  function emit(level: LogLevel, base: LogFields, message: string, fields?: LogFields): void {
    if (SEVERITY[level] < min) return;

    const ctx = getRequestContext();
    const record = {
      level,
      time: new Date().toISOString(),
      message,
      ...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
      ...(ctx?.userId ? { userId: ctx.userId } : {}),
      ...(ctx?.route ? { route: ctx.route } : {}),
      ...(redact({ ...base, ...fields }) as LogFields),
    };

    sink(pretty ? prettyFormat(record) : JSON.stringify(record));
  }

  function build(base: LogFields): Logger {
    return {
      debug: (m, f) => emit('debug', base, m, f),
      info: (m, f) => emit('info', base, m, f),
      warn: (m, f) => emit('warn', base, m, f),
      error: (m, f) => emit('error', base, m, f),
      child: (f) => build({ ...base, ...f }),
    };
  }

  return build(options.base ?? {});
}

function prettyFormat(record: Record<string, unknown>): string {
  const { level, time, message, requestId, ...rest } = record;
  const head = `${String(time).slice(11, 23)} ${String(level).toUpperCase().padEnd(5)} ${String(message)}`;
  const id = requestId ? ` (${String(requestId).slice(0, 8)})` : '';
  const extras = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
  return `${head}${id}${extras}`;
}

function resolveLevel(value: string | undefined): LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value ?? '') ? (value as LogLevel) : 'info';
}

/** Shared instance. Configured from the environment; safe to import anywhere. */
export const logger: Logger = createLogger({
  level: resolveLevel(process.env['LOG_LEVEL']),
  pretty: process.env['NODE_ENV'] !== 'production',
  base: { service: 'friday' },
});
