import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';

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
          },
        };
      }),
    },
  };
});

const { GET } = await import('../route');

describe('GET /api/v1/auth/google', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it('redirects to error if GOOGLE_CLIENT_ID is missing', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    
    const req = new Request('http://localhost:3000/api/v1/auth/google');
    const res = await GET(req) as any;
    
    expect(NextResponse.redirect).toHaveBeenCalled();
    const url = new URL(res.url);
    expect(url.pathname).toBe('/sign-in');
    expect(url.searchParams.get('error')).toBe('google_auth_not_configured');
  });

  it('starts OAuth authorization-code flow correctly', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    
    const req = new Request('http://localhost:3000/api/v1/auth/google?next=/progress');
    const res = await GET(req) as any;
    
    expect(NextResponse.redirect).toHaveBeenCalled();
    const url = new URL(res.url);
    
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.pathname).toBe('/o/oauth2/v2/auth');
    
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/v1/auth/google/callback');
    expect(url.searchParams.get('response_type')).toBe('code'); // Verify response_type=code
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    
    // State should be generated
    const state = url.searchParams.get('state');
    expect(state).toBeTruthy();
    const parsedState = JSON.parse(state!);
    expect(parsedState.next).toBe('/progress');
    expect(typeof parsedState.state).toBe('string');
    
    // Cookie should be set securely
    expect(res.cookies.set).toHaveBeenCalledWith(
      'google_oauth_state',
      parsedState.state,
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
      })
    );
  });
});
