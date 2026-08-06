import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../openapi';
import { ENDPOINTS } from '../registry';
import { ApiError, ERROR_CODES, statusForCode } from '../errors';
import { SignUpRequestSchema } from '../schemas/auth';
import { UpdateMeRequestSchema } from '../schemas/me';
import { MetaSchema } from '../envelope';

describe('OpenAPI generation', () => {
  const doc = buildOpenApiDocument();

  it('emits an OpenAPI 3.1 document', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.version).toBe('v1');
  });

  it('includes every registered endpoint', () => {
    for (const def of Object.values(ENDPOINTS)) {
      const path = doc.paths?.[def.path];
      expect(path, `missing path ${def.path}`).toBeDefined();
      expect(path?.[def.method.toLowerCase() as 'get']).toBeDefined();
    }
  });

  it('marks authenticated endpoints with the session security scheme', () => {
    const me = doc.paths?.['/me']?.get;
    expect(me?.security).toEqual([{ sessionCookie: [] }]);
  });

  it('leaves sign-up unauthenticated', () => {
    expect(doc.paths?.['/auth/sign-up']?.post?.security).toBeUndefined();
  });
});

describe('error taxonomy', () => {
  it('returns 404 rather than 403 for resources owned by someone else', () => {
    // Distinguishing them would leak existence (API_SPECIFICATION §4.4).
    expect(ApiError.notFound().status).toBe(404);
  });

  it('maps codes to the statuses the spec declares', () => {
    expect(statusForCode(ERROR_CODES.INVALID_CREDENTIALS)).toBe(401);
    expect(statusForCode(ERROR_CODES.MINOR_CONSENT_REQUIRED)).toBe(403);
    expect(statusForCode(ERROR_CODES.EMAIL_IN_USE)).toBe(409);
    expect(statusForCode(ERROR_CODES.PLAN_NOT_FEASIBLE)).toBe(422);
    expect(statusForCode(ERROR_CODES.RATE_LIMITED)).toBe(429);
    expect(statusForCode(ERROR_CODES.AI_UNAVAILABLE)).toBe(503);
  });

  it('flags provider outages as retryable and validation failures as not', () => {
    expect(new ApiError(ERROR_CODES.AI_UNAVAILABLE).retryable).toBe(true);
    expect(new ApiError(ERROR_CODES.VALIDATION_FAILED).retryable).toBe(false);
  });

  it('serialises to the wire shape with a request id', () => {
    const wire = new ApiError(ERROR_CODES.NOT_FOUND).toWire('018f3a2b-0000-7000-8000-000000000000');
    expect(wire.error.code).toBe('NOT_FOUND');
    expect(wire.error.requestId).toBe('018f3a2b-0000-7000-8000-000000000000');
    expect(wire.error.docsUrl).toContain('NOT_FOUND');
  });
});

describe('sign-up validation', () => {
  const valid = {
    email: 'Student@Example.com',
    password: 'a-long-enough-password',
    displayName: 'Aarav',
    timezone: 'Asia/Kolkata',
    dateOfBirth: '2007-05-14',
  };

  it('accepts a well-formed request and normalises the email', () => {
    const parsed = SignUpRequestSchema.parse(valid);
    expect(parsed.email).toBe('student@example.com');
  });

  it('rejects a short password', () => {
    expect(SignUpRequestSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false);
  });

  it('rejects an unknown field rather than ignoring it', () => {
    // Silent typo acceptance is a debugging tax (API_SPECIFICATION §3.1).
    expect(SignUpRequestSchema.safeParse({ ...valid, isAdmin: true }).success).toBe(false);
  });

  it('rejects a future date of birth', () => {
    expect(SignUpRequestSchema.safeParse({ ...valid, dateOfBirth: '2099-01-01' }).success).toBe(
      false,
    );
  });

  it('rejects an invalid timezone', () => {
    expect(SignUpRequestSchema.safeParse({ ...valid, timezone: 'Mars/Olympus' }).success).toBe(
      false,
    );
  });

  it('requires date of birth — it is not optional at signup (FR-1.6)', () => {
    const { dateOfBirth: _omitted, ...withoutDob } = valid;
    expect(SignUpRequestSchema.safeParse(withoutDob).success).toBe(false);
  });
});

describe('profile update', () => {
  it('rejects an empty patch', () => {
    expect(UpdateMeRequestSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a single field', () => {
    expect(UpdateMeRequestSchema.safeParse({ displayName: 'Aarav K' }).success).toBe(true);
  });
});

describe('response envelope', () => {
  it('requires a request id and timestamp on every response', () => {
    expect(
      MetaSchema.safeParse({
        requestId: '018f3a2b-0000-7000-8000-000000000000',
        timestamp: '2026-07-24T09:30:00Z',
      }).success,
    ).toBe(true);
    expect(MetaSchema.safeParse({ timestamp: '2026-07-24T09:30:00Z' }).success).toBe(false);
  });
});
