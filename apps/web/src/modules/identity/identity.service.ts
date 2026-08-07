import {
  ApiError,
  ERROR_CODES,
  type RecordConsentRequest,
  type SignInRequest,
  type SignUpRequest,
  type UpdateMeRequest,
  type User,
} from '@friday/contracts';
import {
  authSessionsRepository,
  consentsRepository,
  getDb,
  preferencesRepository,
  usersRepository,
  type AuthSessionRow,
  type UserRow,
} from '@friday/db';
import { logger, setContextUser } from '@friday/observability';
import { classifyAge } from './age-policy';
import { deriveOnboardingState } from './onboarding';
import { hashPassword, verifyPassword } from './password';
import { generateSessionToken, hashSessionToken, sessionExpiry } from './session';
import { EVENTS, trackEvent } from '../platform/analytics.service';

/**
 * Identity service — the use-case layer for accounts, sessions, and consent.
 *
 * Owns transactions, authorization, and event emission; route handlers call
 * into here and never touch a repository (SYSTEM_ARCHITECTURE §6.1).
 */

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuthResult {
  user: User;
  /** Raw token — returned once, set as a cookie, never stored or logged. */
  token: string;
  expiresAt: Date;
}

const GUARDIAN_CONSENT = 'guardian';

export function toPublicUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerifiedAt !== null,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    timezone: row.timezone,
    locale: row.locale,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function signUp(input: SignUpRequest, meta: RequestMeta): Promise<AuthResult> {
  const db = getDb();
  const users = usersRepository(db);

  if (await users.emailExists(input.email)) {
    throw new ApiError(ERROR_CODES.EMAIL_IN_USE);
  }

  // FR-1.6. Refuse before any row is written, so an under-13 account never
  // exists in the first place rather than being created and then cleaned up.
  const classification = classifyAge(input.dateOfBirth, new Date());
  if (!classification.permitted) {
    throw new ApiError(ERROR_CODES.UNDER_MINIMUM_AGE);
  }

  const passwordHash = await hashPassword(input.password);

  const user = await db.transaction(async (tx) => {
    const created = await usersRepository(tx).create({
      email: input.email,
      passwordHash,
      displayName: input.displayName,
      timezone: input.timezone,
      dateOfBirth: input.dateOfBirth,
      isMinor: classification.isMinor,
      onboardingState: {
        step: classification.isMinor ? 'guardian_consent' : 'goal',
        completed: false,
      },
    });
    await preferencesRepository(tx).ensureDefaults(created.id);
    return created;
  });

  setContextUser(user.id);
  logger.info('account created', { isMinor: classification.isMinor });
  trackEvent(user.id, EVENTS.signedUp, { isMinor: classification.isMinor });

  return issueSession(user, meta);
}

export async function signIn(input: SignInRequest, meta: RequestMeta): Promise<AuthResult> {
  const users = usersRepository(getDb());
  const user = await users.findByEmailForAuth(input.email);

  // Same error and roughly the same work whether the account is missing or the
  // password is wrong — otherwise timing and messaging enumerate accounts.
  if (!user?.passwordHash) {
    await verifyPassword(input.password, DUMMY_HASH);
    throw new ApiError(ERROR_CODES.INVALID_CREDENTIALS);
  }

  if (!(await verifyPassword(input.password, user.passwordHash))) {
    throw new ApiError(ERROR_CODES.INVALID_CREDENTIALS);
  }

  setContextUser(user.id);
  return issueSession(user, meta);
}

export async function signOut(token: string): Promise<void> {
  await authSessionsRepository(getDb()).deleteByTokenHash(hashSessionToken(token));
}

/** Resolves a raw cookie token to its session and user, or nothing. */
export async function resolveSession(
  token: string,
): Promise<{ user: UserRow; session: AuthSessionRow } | undefined> {
  const found = await authSessionsRepository(getDb()).findActiveByTokenHash(
    hashSessionToken(token),
  );
  if (!found || found.user.deletedAt) return undefined;

  setContextUser(found.user.id);
  return found;
}

/** Sliding expiry, throttled so a burst of requests is not a write storm. */
export async function touchSession(session: AuthSessionRow): Promise<void> {
  const sinceTouch = Date.now() - session.lastActiveAt.getTime();
  if (sinceTouch < 5 * 60 * 1000) return;
  await authSessionsRepository(getDb()).touch(session.id, sessionExpiry());
}

export async function getMePayload(user: UserRow) {
  const hasGuardianConsent = user.isMinor
    ? await consentsRepository(getDb()).isGranted(user.id, GUARDIAN_CONSENT)
    : true;

  return {
    user: toPublicUser(user),
    onboarding: deriveOnboardingState(user, hasGuardianConsent),
    activeGoal: null,
  };
}

export async function updateProfile(user: UserRow, patch: UpdateMeRequest): Promise<UserRow> {
  const db = getDb();
  const users = usersRepository(db);

  if (patch.dateOfBirth !== undefined) {
    if (user.dateOfBirth) {
      // Write-once: changing it would silently change minor status, and with it
      // the consent obligations already recorded against this account.
      throw new ApiError(
        ERROR_CODES.CONFLICT,
        'Date of birth has already been set and cannot be changed here. Contact support if it is wrong.',
      );
    }

    const classification = classifyAge(patch.dateOfBirth, new Date());
    if (!classification.permitted) throw new ApiError(ERROR_CODES.UNDER_MINIMUM_AGE);

    const updated = await users.setDateOfBirthIfUnset(
      user.id,
      patch.dateOfBirth,
      classification.isMinor,
      { step: classification.isMinor ? 'guardian_consent' : 'goal', completed: false },
    );
    if (!updated) throw new ApiError(ERROR_CODES.CONFLICT, 'Date of birth was already set.');
    user = updated;
  }

  const profilePatch = {
    ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
    ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
    ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
    ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
  };

  if (Object.keys(profilePatch).length === 0) return user;

  const updated = await users.updateProfile(user.id, profilePatch);
  if (!updated) throw ApiError.notFound();
  return updated;
}

export async function recordConsent(user: UserRow, input: RecordConsentRequest, meta: RequestMeta) {
  if (input.consentType === GUARDIAN_CONSENT && !input.guardianEmail) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'A guardian email address is required.', [
      { field: 'guardianEmail', issue: 'required_for_guardian_consent' },
    ]);
  }

  const row = await consentsRepository(getDb()).record({
    userId: user.id,
    consentType: input.consentType,
    granted: input.granted,
    version: input.version,
    guardianEmail: input.guardianEmail ?? null,
    ipAddress: meta.ipAddress ?? null,
  });

  logger.info('consent recorded', { consentType: input.consentType, granted: input.granted });

  return {
    id: row.id,
    consentType: input.consentType,
    granted: row.granted,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

async function issueSession(user: UserRow, meta: RequestMeta): Promise<AuthResult> {
  const token = generateSessionToken();
  const expiresAt = sessionExpiry();

  await authSessionsRepository(getDb()).create({
    userId: user.id,
    tokenHash: hashSessionToken(token),
    expiresAt,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return { user: toPublicUser(user), token, expiresAt };
}

/**
 * A real Argon2id hash of a value nobody knows, verified against when an
 * account is not found so that the failure path costs the same as a genuine
 * wrong password.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$8Qm2vB8Qm2vB8Qm2vB8Qm2vB8Qm2vB8Qm2vB8Qm2vB8';
