/**
 * Unit tests for the /api/v1/cron/replan endpoint.
 *
 * Verifies:
 * - No dev-secret fallback: missing CRON_SECRET → 500 (misconfiguration)
 * - Wrong bearer token  → 401 Unauthorized
 * - Missing auth header → 401 Unauthorized
 * - Correct bearer token reaches the handler (200 when DB is mocked)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --------------------------------------------------------------------------
// Mocks — must be declared BEFORE the module is imported so vitest hoists them
// --------------------------------------------------------------------------

vi.mock('@friday/db', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  })),
  goals: {},
  users: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}));

vi.mock('@/modules/planning/planning.service', () => ({
  replanQuietly: vi.fn().mockResolvedValue(undefined),
}));

// Import AFTER mocks
const { POST } = await import('../route');

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeRequest(authHeader?: string): Request {
  return {
    headers: {
      get: (key: string) => (key === 'authorization' ? (authHeader ?? null) : null),
    },
  } as unknown as Request;
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('POST /api/v1/cron/replan – security', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns 500 when CRON_SECRET is not configured (no dev fallback)', async () => {
    delete process.env.CRON_SECRET;

    const res = await POST(makeRequest('Bearer cron-secret-dev'));
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body).toMatchObject({ error: 'Server misconfiguration' });
  });

  it('returns 401 when authorization header is absent', async () => {
    process.env.CRON_SECRET = 'super-secret-token';

    const res = await POST(makeRequest(undefined));
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when authorization header has wrong token', async () => {
    process.env.CRON_SECRET = 'super-secret-token';

    const res = await POST(makeRequest('Bearer wrong-token'));
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when the old dev fallback token is supplied but env var is set differently', async () => {
    process.env.CRON_SECRET = 'production-secret';

    const res = await POST(makeRequest('Bearer cron-secret-dev'));
    expect(res.status).toBe(401);
  });

  it('reaches the handler with correct bearer token and returns 200', async () => {
    process.env.CRON_SECRET = 'super-secret-token';

    const res = await POST(makeRequest('Bearer super-secret-token'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok' });
  });
});
