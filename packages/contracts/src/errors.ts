/**
 * Error taxonomy — API_SPECIFICATION.md §6.
 *
 * Clients branch on `code`. `message` is user-presentable English and may be
 * reworded at any time without a version bump; `code` may not (§7.2).
 */

export const ERROR_CODES = {
  // Auth
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  EMAIL_IN_USE: 'EMAIL_IN_USE',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
  OAUTH_FAILED: 'OAUTH_FAILED',
  MINOR_CONSENT_REQUIRED: 'MINOR_CONSENT_REQUIRED',
  UNDER_MINIMUM_AGE: 'UNDER_MINIMUM_AGE',
  DATE_OF_BIRTH_REQUIRED: 'DATE_OF_BIRTH_REQUIRED',

  // Validation
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',
  INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',

  // Resource
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  CONFLICT: 'CONFLICT',
  FORBIDDEN: 'FORBIDDEN',

  // Goal
  GOAL_LIMIT_REACHED: 'GOAL_LIMIT_REACHED',
  TARGET_DATE_IN_PAST: 'TARGET_DATE_IN_PAST',
  GOAL_NOT_ACTIVE: 'GOAL_NOT_ACTIVE',

  // Curriculum
  CURRICULUM_GENERATION_FAILED: 'CURRICULUM_GENERATION_FAILED',
  PREREQUISITE_CYCLE: 'PREREQUISITE_CYCLE',
  TEMPLATE_NOT_FOUND: 'TEMPLATE_NOT_FOUND',
  CURRICULUM_VALIDATION_FAILED: 'CURRICULUM_VALIDATION_FAILED',

  // Planning
  PLAN_NOT_FEASIBLE: 'PLAN_NOT_FEASIBLE',
  NO_AVAILABILITY_DEFINED: 'NO_AVAILABILITY_DEFINED',
  PLAN_GENERATION_FAILED: 'PLAN_GENERATION_FAILED',
  REPLAN_IN_PROGRESS: 'REPLAN_IN_PROGRESS',

  // Execution
  SESSION_ALREADY_ACTIVE: 'SESSION_ALREADY_ACTIVE',
  SESSION_NOT_ACTIVE: 'SESSION_NOT_ACTIVE',
  TASK_ALREADY_COMPLETED: 'TASK_ALREADY_COMPLETED',

  // Assessment
  NO_QUESTIONS_AVAILABLE: 'NO_QUESTIONS_AVAILABLE',
  ATTEMPT_ALREADY_SUBMITTED: 'ATTEMPT_ALREADY_SUBMITTED',
  GRADING_FAILED: 'GRADING_FAILED',

  // AI
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  AI_BUDGET_EXCEEDED: 'AI_BUDGET_EXCEEDED',
  AI_VALIDATION_FAILED: 'AI_VALIDATION_FAILED',
  AI_TIMEOUT: 'AI_TIMEOUT',
  CONTEXT_TOO_LARGE: 'CONTEXT_TOO_LARGE',

  // Rate / platform
  RATE_LIMITED: 'RATE_LIMITED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** HTTP status per code (§6.2). */
const STATUS: Record<ErrorCode, number> = {
  INVALID_CREDENTIALS: 401,
  EMAIL_NOT_VERIFIED: 403,
  SESSION_EXPIRED: 401,
  EMAIL_IN_USE: 409,
  WEAK_PASSWORD: 422,
  OAUTH_FAILED: 401,
  MINOR_CONSENT_REQUIRED: 403,
  UNDER_MINIMUM_AGE: 403,
  DATE_OF_BIRTH_REQUIRED: 403,

  VALIDATION_FAILED: 400,
  UNKNOWN_FIELD: 400,
  INVALID_DATE_RANGE: 400,

  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  CONFLICT: 409,
  FORBIDDEN: 403,

  GOAL_LIMIT_REACHED: 409,
  TARGET_DATE_IN_PAST: 422,
  GOAL_NOT_ACTIVE: 409,

  CURRICULUM_GENERATION_FAILED: 422,
  PREREQUISITE_CYCLE: 409,
  TEMPLATE_NOT_FOUND: 404,
  CURRICULUM_VALIDATION_FAILED: 422,

  PLAN_NOT_FEASIBLE: 422,
  NO_AVAILABILITY_DEFINED: 422,
  PLAN_GENERATION_FAILED: 422,
  REPLAN_IN_PROGRESS: 409,

  SESSION_ALREADY_ACTIVE: 409,
  SESSION_NOT_ACTIVE: 409,
  TASK_ALREADY_COMPLETED: 409,

  NO_QUESTIONS_AVAILABLE: 422,
  ATTEMPT_ALREADY_SUBMITTED: 409,
  GRADING_FAILED: 422,

  AI_UNAVAILABLE: 503,
  AI_BUDGET_EXCEEDED: 429,
  AI_VALIDATION_FAILED: 422,
  AI_TIMEOUT: 504,
  CONTEXT_TOO_LARGE: 422,

  RATE_LIMITED: 429,
  IDEMPOTENCY_CONFLICT: 409,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

/** Codes where retrying the identical request may succeed. */
const RETRYABLE = new Set<ErrorCode>([
  ERROR_CODES.AI_UNAVAILABLE,
  ERROR_CODES.AI_TIMEOUT,
  ERROR_CODES.RATE_LIMITED,
  ERROR_CODES.SERVICE_UNAVAILABLE,
  ERROR_CODES.REPLAN_IN_PROGRESS,
]);

const DEFAULT_MESSAGE: Partial<Record<ErrorCode, string>> = {
  INVALID_CREDENTIALS: 'That email and password combination is not correct.',
  SESSION_EXPIRED: 'Your session has expired. Please sign in again.',
  EMAIL_IN_USE: 'An account already exists for this email address.',
  WEAK_PASSWORD: 'Choose a password of at least 10 characters.',
  MINOR_CONSENT_REQUIRED: 'A parent or guardian needs to give consent before you can continue.',
  UNDER_MINIMUM_AGE: 'FRIDAY is not available to users under 13.',
  DATE_OF_BIRTH_REQUIRED: 'Please tell us your date of birth before setting up a goal.',
  NOT_FOUND: 'Not found.',
  VALIDATION_FAILED: 'The request could not be processed as sent.',
  INTERNAL_ERROR: 'Something went wrong on our side. The issue has been logged.',
};

export interface ErrorDetail {
  field?: string;
  issue: string;
  [key: string]: unknown;
}

export interface WireError {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
    requestId: string;
    docsUrl: string;
    retryable: boolean;
  };
}

/**
 * The only error type route handlers should throw. Anything else reaching the
 * error boundary is an unexpected fault and becomes INTERNAL_ERROR with the
 * cause logged but not exposed.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetail[] | undefined;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message?: string, details?: ErrorDetail[]) {
    super(message ?? DEFAULT_MESSAGE[code] ?? code);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
    this.retryable = RETRYABLE.has(code);
  }

  toWire(requestId: string): WireError {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
        requestId,
        docsUrl: `https://docs.friday.app/errors/${this.code}`,
        retryable: this.retryable,
      },
    };
  }

  /**
   * A resource owned by another user returns 404, never 403 — distinguishing
   * them leaks existence (API_SPECIFICATION §4.4).
   */
  static notFound(): ApiError {
    return new ApiError(ERROR_CODES.NOT_FOUND);
  }
}

export function statusForCode(code: ErrorCode): number {
  return STATUS[code];
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
