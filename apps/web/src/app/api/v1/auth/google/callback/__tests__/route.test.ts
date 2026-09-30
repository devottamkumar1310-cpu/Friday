import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/modules/identity/session';

// --------------------------------------------------------------------------
// Mocks
// --------------------------------------------------------------------------

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    NextResponse: {
      ...actual.NextResponse,
      redirect: vi.fn((url: string) => {
        return {
          url,
          cookies: {
            set: vi.fn(),
            delete: vi.fn(),
          },
        };
      }),
    },
  };
});

const mockCookiesGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => Promise.resolve({
    get: mockCookiesGet,
  })),
}));

vi.mock('@/modules/identity/identity.service', () => ({
  signInWithGoogle: vi.fn(),
}));

import { signInWithGoogle } from '@/modules/identity/identity.service';
const { GET } = await import('../route');

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('GET /api/v1/auth/google/callback', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    
    vi.stubGlobal('fetch', vi.fn());
    mockCookiesGet.mockReset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('rejects missing state, code, or error param', async () => {
    const req = new Request('http://localhost:3000/api/v1/auth/google/callback');
    const res = await GET(req) as any;
    
    expect(NextResponse.redirect).toHaveBeenCalled();
    const url = new URL(res.url);
    expect(url.pathname).toBe('/sign-in');
    expect(url.searchParams.get('error')).toBe('google_auth_failed');
  });

  it('rejects invalid state callback', async () => {
    mockCookiesGet.mockReturnValue({ value: 'real-state' });
    
    const stateObj = JSON.stringify({ state: 'fake-state', next: '/dashboard' });
    const req = new Request(`http://localhost:3000/api/v1/auth/google/callback?code=123&state=${encodeURIComponent(stateObj)}`);
    const res = await GET(req) as any;
    
    expect(NextResponse.redirect).toHaveBeenCalled();
    const url = new URL(res.url);
    expect(url.searchParams.get('error')).toBe('csrf_mismatch');
  });

  it('rejects unparseable state', async () => {
    mockCookiesGet.mockReturnValue({ value: 'real-state' });
    
    const req = new Request('http://localhost:3000/api/v1/auth/google/callback?code=123&state=not-json');
    const res = await GET(req) as any;
    
    expect(NextResponse.redirect).toHaveBeenCalled();
    const url = new URL(res.url);
    expect(url.searchParams.get('error')).toBe('invalid_state');
  });

  it('handles OAuth denial/error', async () => {
    const req = new Request('http://localhost:3000/api/v1/auth/google/callback?error=access_denied');
    const res = await GET(req) as any;
    
    expect(NextResponse.redirect).toHaveBeenCalled();
    const url = new URL(res.url);
    expect(url.searchParams.get('error')).toBe('google_auth_failed');
  });

  it('exchanges code securely and logs in the user (valid state callback)', async () => {
    mockCookiesGet.mockReturnValue({ value: 'valid-state' });
    
    const stateObj = JSON.stringify({ state: 'valid-state', next: '/dashboard' });
    const req = new Request(`http://localhost:3000/api/v1/auth/google/callback?code=my-auth-code&state=${encodeURIComponent(stateObj)}`);
    
    // Mock the fetch calls
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockImplementation(async (url) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        return {
          ok: true,
          json: async () => ({ access_token: 'mock-access-token' }),
        } as any;
      }
      if (url === 'https://www.googleapis.com/oauth2/v3/userinfo') {
        return {
          ok: true,
          json: async () => ({
            sub: 'google-user-123',
            email: 'test@example.com',
            name: 'Test User',
            picture: 'http://example.com/pic.jpg',
          }),
        } as any;
      }
      return { ok: false } as any;
    });

    vi.mocked(signInWithGoogle).mockResolvedValue({
      user: { id: 'u1' } as any,
      token: 'session-token-123',
      expiresAt: new Date(),
    });

    const res = await GET(req) as any;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    
    // 1. Verify Token Exchange Request
    const tokenCall = mockFetch.mock.calls[0]!;
    expect(tokenCall[0]).toBe('https://oauth2.googleapis.com/token');
    expect(tokenCall[1]?.method).toBe('POST');
    const bodyStr = tokenCall[1]?.body?.toString() || '';
    expect(bodyStr).toContain('code=my-auth-code');
    expect(bodyStr).toContain('client_secret=test-client-secret');
    expect(bodyStr).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fv1%2Fauth%2Fgoogle%2Fcallback');

    // 2. Verify UserInfo Request
    const userInfoCall = mockFetch.mock.calls[1]!;
    expect(userInfoCall[0]).toBe('https://www.googleapis.com/oauth2/v3/userinfo');
    expect((userInfoCall[1]?.headers as any)?.Authorization).toBe('Bearer mock-access-token');

    // 3. Verify signInWithGoogle
    expect(signInWithGoogle).toHaveBeenCalledWith(
      {
        providerAccountId: 'google-user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        avatarUrl: 'http://example.com/pic.jpg',
      },
      expect.anything()
    );

    // 4. Verify successful redirect and session creation
    expect(NextResponse.redirect).toHaveBeenCalled();
    const url = new URL(res.url);
    expect(url.pathname).toBe('/dashboard');
    expect(res.cookies.set).toHaveBeenCalledWith(
      SESSION_COOKIE,
      'session-token-123',
      expect.any(Object)
    );
    expect(res.cookies.delete).toHaveBeenCalledWith('google_oauth_state');
  });
});
