import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signInWithGoogle } from '../identity.service';

const mockLinkAccount = vi.fn();
const mockMarkEmailVerified = vi.fn();
const mockCreateUser = vi.fn();
const mockEnsureDefaults = vi.fn();
const mockFindByProvider = vi.fn();
const mockFindByEmail = vi.fn();

vi.mock('@friday/db', () => ({
  getDb: vi.fn(() => ({
    transaction: vi.fn(async (cb) => cb({} as any)),
  })),
  usersRepository: vi.fn(() => ({
    findByProviderAccountForAuth: mockFindByProvider,
    findByEmailForAuth: mockFindByEmail,
    linkAccount: mockLinkAccount,
    markEmailVerified: mockMarkEmailVerified,
    create: mockCreateUser,
  })),
  preferencesRepository: vi.fn(() => ({
    ensureDefaults: mockEnsureDefaults,
  })),
  authSessionsRepository: vi.fn(() => ({
    create: vi.fn(),
  })),
}));

vi.mock('../session', () => ({
  generateSessionToken: vi.fn(() => 'mock-token'),
  hashSessionToken: vi.fn(() => 'hashed-token'),
  sessionExpiry: vi.fn(() => new Date('2030-01-01')),
}));

vi.mock('../../platform/analytics.service', () => ({
  trackEvent: vi.fn(),
  EVENTS: { signedUp: 'signed_up' },
}));

vi.mock('@friday/observability', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
  setContextUser: vi.fn(),
}));

describe('signInWithGoogle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockInput = {
    providerAccountId: 'google-123',
    email: 'new@example.com',
    displayName: 'New User',
    avatarUrl: 'pic.jpg',
  };
  const mockMeta = { ipAddress: '127.0.0.1', userAgent: 'test-agent' };

  it('logs in an existing Google account smoothly', async () => {
    const existingUser = {
      id: 'u1',
      email: 'new@example.com',
      emailVerifiedAt: new Date(),
      createdAt: new Date(),
    };
    mockFindByProvider.mockResolvedValueOnce(existingUser);

    const result = await signInWithGoogle(mockInput, mockMeta);

    expect(mockFindByProvider).toHaveBeenCalledWith('google', 'google-123');
    expect(mockFindByEmail).not.toHaveBeenCalled();
    expect(mockCreateUser).not.toHaveBeenCalled();
    
    expect(result.user.id).toBe('u1');
    expect(result.token).toBe('mock-token');
  });

  it('prevents duplicate accounts by linking to an existing FRIDAY user with the same email', async () => {
    mockFindByProvider.mockResolvedValueOnce(null);
    const existingByEmail = {
      id: 'u2',
      email: 'new@example.com',
      emailVerifiedAt: null, // Test unverified email
      createdAt: new Date(),
    };
    mockFindByEmail.mockResolvedValueOnce(existingByEmail);

    const result = await signInWithGoogle(mockInput, mockMeta);

    expect(mockFindByProvider).toHaveBeenCalledWith('google', 'google-123');
    expect(mockFindByEmail).toHaveBeenCalledWith('new@example.com');
    expect(mockCreateUser).not.toHaveBeenCalled();
    
    expect(mockLinkAccount).toHaveBeenCalledWith({
      userId: 'u2',
      provider: 'google',
      providerAccountId: 'google-123',
    });
    // Should verify email since Google verified it
    expect(mockMarkEmailVerified).toHaveBeenCalledWith('u2');
    
    expect(result.user.id).toBe('u2');
    expect(result.token).toBe('mock-token');
  });

  it('creates a new FRIDAY account if no email matches', async () => {
    mockFindByProvider.mockResolvedValueOnce(null);
    mockFindByEmail.mockResolvedValueOnce(null);
    mockCreateUser.mockResolvedValueOnce({
      id: 'u3',
      email: 'new@example.com',
      createdAt: new Date(),
    });

    const result = await signInWithGoogle(mockInput, mockMeta);

    expect(mockCreateUser).toHaveBeenCalledWith(expect.objectContaining({
      email: 'new@example.com',
      displayName: 'New User',
      avatarUrl: 'pic.jpg',
    }));
    
    expect(mockLinkAccount).toHaveBeenCalledWith({
      userId: 'u3',
      provider: 'google',
      providerAccountId: 'google-123',
    });
    
    expect(mockEnsureDefaults).toHaveBeenCalledWith('u3');
    expect(result.user.id).toBe('u3');
  });
});
