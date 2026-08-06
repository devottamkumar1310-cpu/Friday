import { describe, expect, it } from 'vitest';
import { ENDPOINTS } from '../registry';
import {
  AvailabilityRuleSchema,
  SetAvailabilityRequestSchema,
  UpdatePreferencesRequestSchema,
} from '../schemas/me-settings';
import { UpdateTaskRequestSchema } from '../schemas/sessions';

/** Contracts introduced in Phase 3 to connect the UI to existing capability. */

describe('availability contract', () => {
  it('accepts a well-formed rule', () => {
    expect(
      AvailabilityRuleSchema.safeParse({
        dayOfWeek: 1,
        startTime: '18:00',
        endTime: '20:30',
        kind: 'available',
      }).success,
    ).toBe(true);
  });

  it('rejects an end time at or before the start', () => {
    const base = { dayOfWeek: 1, startTime: '20:00', kind: 'available' };
    expect(AvailabilityRuleSchema.safeParse({ ...base, endTime: '18:00' }).success).toBe(false);
    expect(AvailabilityRuleSchema.safeParse({ ...base, endTime: '20:00' }).success).toBe(false);
  });

  it('rejects malformed or out-of-range times', () => {
    const base = { dayOfWeek: 1, endTime: '20:00', kind: 'available' };
    for (const startTime of ['6pm', '24:00', '18:60', '8:00', '']) {
      expect(AvailabilityRuleSchema.safeParse({ ...base, startTime }).success).toBe(false);
    }
  });

  it('rejects a day outside 0-6', () => {
    const base = { startTime: '18:00', endTime: '20:00', kind: 'available' };
    expect(AvailabilityRuleSchema.safeParse({ ...base, dayOfWeek: 7 }).success).toBe(false);
    expect(AvailabilityRuleSchema.safeParse({ ...base, dayOfWeek: -1 }).success).toBe(false);
    expect(AvailabilityRuleSchema.safeParse({ ...base, dayOfWeek: 0 }).success).toBe(true);
  });

  it('allows an empty set — clearing availability is legitimate', () => {
    // The *consequence* (no plan can be generated, E-6) is enforced by the
    // scheduler, not by forbidding the input.
    expect(SetAvailabilityRequestSchema.safeParse({ rules: [] }).success).toBe(true);
  });

  it('caps the number of rules so one request cannot describe an absurd week', () => {
    const many = Array.from({ length: 51 }, () => ({
      dayOfWeek: 1,
      startTime: '06:00',
      endTime: '07:00',
      kind: 'available' as const,
    }));
    expect(SetAvailabilityRequestSchema.safeParse({ rules: many }).success).toBe(false);
  });
});

describe('preferences contract', () => {
  it('requires at least one field', () => {
    expect(UpdatePreferencesRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdatePreferencesRequestSchema.safeParse({ theme: 'dark' }).success).toBe(true);
  });

  it('rejects unknown fields rather than ignoring them', () => {
    expect(UpdatePreferencesRequestSchema.safeParse({ theme: 'dark', admin: true }).success).toBe(
      false,
    );
  });

  it('allows zero nudges per day', () => {
    expect(UpdatePreferencesRequestSchema.safeParse({ maxDirectivesPerDay: 0 }).success).toBe(true);
  });
});

describe('task update contract', () => {
  it('requires at least one field', () => {
    expect(UpdateTaskRequestSchema.safeParse({}).success).toBe(false);
  });

  it('accepts the statuses the UI can set', () => {
    for (const status of ['completed', 'skipped', 'pending']) {
      expect(UpdateTaskRequestSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('rejects a status outside the enum', () => {
    expect(UpdateTaskRequestSchema.safeParse({ status: 'cancelled_by_user' }).success).toBe(false);
  });
});

describe('endpoint registry', () => {
  it('exposes every surface the UI depends on', () => {
    const required = [
      'getAvailability',
      'setAvailability',
      'getPreferences',
      'updatePreferences',
      'listSessions',
      'getSession',
      'abandonSession',
      'listTasks',
      'getStudyTask',
      'updateTask',
    ] as const;
    for (const name of required) expect(ENDPOINTS[name]).toBeDefined();
  });

  it('requires authentication on every learner-facing endpoint', () => {
    // The only unauthenticated endpoints are the sign-up/sign-in pair.
    const anonymous = Object.entries(ENDPOINTS)
      .filter(([, def]) => !def.auth)
      .map(([name]) => name);
    expect(anonymous.sort()).toEqual(['signIn', 'signUp']);
  });

  it('uses PUT for availability, because it replaces the whole set', () => {
    expect(ENDPOINTS.setAvailability.method).toBe('PUT');
  });
});
