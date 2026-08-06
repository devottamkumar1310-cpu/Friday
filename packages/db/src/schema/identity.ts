import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { newId } from '../ids';
import { citext } from './types';

/**
 * Identity tables — DATABASE_DESIGN §4.1.
 *
 * Phase 0 scope. Curriculum, planning, execution, and the rest arrive in
 * Phase 1 (roadmap 1.1).
 */

export const userRole = pgEnum('user_role', ['learner', 'admin', 'system']);

/** Stored onboarding state. `blockedBy` is derived on read, never persisted. */
export interface StoredOnboardingState {
  step: 'date_of_birth' | 'guardian_consent' | 'goal' | 'availability' | 'curriculum' | 'complete';
  completed: boolean;
}

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    email: citext('email').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    /** Null for OAuth-only accounts. Argon2id (NFR-3.2). */
    passwordHash: text('password_hash'),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    /** IANA zone. Drives all local scheduling and notification timing. */
    timezone: text('timezone').notNull().default('UTC'),
    locale: text('locale').notNull().default('en'),
    /**
     * Nullable at the column level, required by the service before a Goal may
     * be created (FR-1.6). The row exists from the OAuth callback, before any
     * form can ask — a NOT NULL here would force a placeholder, which is worse
     * than an explicit gate.
     */
    dateOfBirth: date('date_of_birth'),
    /**
     * Derived once, at capture. Storing it rather than recomputing from
     * `date_of_birth` means consent state cannot silently flip mid-session when
     * a learner has a birthday.
     */
    isMinor: boolean('is_minor'),
    role: userRole('role').notNull().default('learner'),
    onboardingState: jsonb('onboarding_state')
      .$type<StoredOnboardingState>()
      .notNull()
      .default({ step: 'date_of_birth', completed: false }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** 30-day grace, then PII purge (FR-12.2). */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    index('users_active_idx')
      .on(t.createdAt)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('accounts_provider_key').on(t.provider, t.providerAccountId),
    index('accounts_user_idx').on(t.userId),
  ],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * Only the hash is stored. A database leak therefore does not yield usable
     * session tokens, and there is no code path that can print a live token.
     */
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('auth_sessions_token_hash_key').on(t.tokenHash),
    index('auth_sessions_user_idx').on(t.userId),
    index('auth_sessions_expiry_idx').on(t.expiresAt),
  ],
);

export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  quietHoursStart: time('quiet_hours_start').notNull().default('22:00'),
  quietHoursEnd: time('quiet_hours_end').notNull().default('07:00'),
  notificationChannels: jsonb('notification_channels')
    .$type<Record<string, boolean>>()
    .notNull()
    .default({ in_app: true, email: true }),
  directiveTypesEnabled: jsonb('directive_types_enabled')
    .$type<Record<string, boolean>>()
    .notNull()
    .default({}),
  maxDirectivesPerDay: integer('max_directives_per_day').notNull().default(3),
  theme: text('theme').notNull().default('system'),
  /** Per-user overrides for α, β, γ, δ, λ, θ, φ (AI_DECISION_ENGINE §17). */
  plannerConfig: jsonb('planner_config').$type<Record<string, number>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const availabilityRules = pgTable(
  'availability_rules',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dayOfWeek: smallint('day_of_week').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    /** 'available' | 'blocked'. */
    kind: text('kind').notNull().default('available'),
    /** Bounded overrides — exams, travel, illness. */
    effectiveFrom: date('effective_from'),
    effectiveUntil: date('effective_until'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('availability_user_idx').on(t.userId, t.dayOfWeek),
    check('availability_day_range', sql`${t.dayOfWeek} between 0 and 6`),
    check('availability_time_order', sql`${t.endTime} > ${t.startTime}`),
    check('availability_kind', sql`${t.kind} in ('available', 'blocked')`),
  ],
);

/** DPDP / GDPR audit trail. Append-only: a withdrawal is a new row. */
export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'terms' | 'privacy' | 'guardian' | 'marketing'. */
    consentType: text('consent_type').notNull(),
    granted: boolean('granted').notNull(),
    version: text('version').notNull(),
    guardianEmail: citext('guardian_email'),
    ipAddress: inet('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('consents_user_type_idx').on(t.userId, t.consentType, t.createdAt)],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type AccountRow = typeof accounts.$inferSelect;
export type AuthSessionRow = typeof authSessions.$inferSelect;
export type ConsentRow = typeof consents.$inferSelect;
export type UserPreferencesRow = typeof userPreferences.$inferSelect;
export type AvailabilityRuleRow = typeof availabilityRules.$inferSelect;
