import {
  ApiError,
  ERROR_CODES,
  type SetAvailabilityRequest,
  type UpdatePreferencesRequest,
} from '@friday/contracts';
import {
  availabilityRepository,
  getDb,
  goalsRepository,
  preferencesRepository,
  type AvailabilityRuleRow,
  type UserRow,
} from '@friday/db';
import { logger } from '@friday/observability';
import { EVENTS, trackEvent } from '../platform/analytics.service';
import { replanQuietly } from '../planning/planning.service';

/**
 * Availability and preferences — API_SPECIFICATION §5.1.
 *
 * Availability is the one setting that is not cosmetic: the scheduler cannot
 * produce a plan without it (E-6, `NO_AVAILABILITY_DEFINED`), and feasibility
 * measures every forecast against it. Changing it is a material event.
 */

function minutesBetween(start: string, end: string): number {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  return Math.max(0, toMinutes(end) - toMinutes(start));
}

export function weeklyMinutes(
  rules: Pick<AvailabilityRuleRow, 'startTime' | 'endTime' | 'kind'>[],
): number {
  return rules.reduce((total, rule) => {
    const minutes = minutesBetween(rule.startTime, rule.endTime);
    return rule.kind === 'blocked' ? total - minutes : total + minutes;
  }, 0);
}

export function toWireRule(row: AvailabilityRuleRow) {
  return {
    id: row.id,
    dayOfWeek: row.dayOfWeek,
    // Postgres returns `time` as HH:MM:SS; the wire contract is HH:MM.
    startTime: row.startTime.slice(0, 5),
    endTime: row.endTime.slice(0, 5),
    kind: row.kind as 'available' | 'blocked',
    effectiveFrom: row.effectiveFrom,
    effectiveUntil: row.effectiveUntil,
  };
}

export async function getAvailability(user: UserRow) {
  const rules = await availabilityRepository(getDb()).listForUser(user.id);
  return { rules: rules.map(toWireRule), weeklyMinutes: Math.max(0, weeklyMinutes(rules)) };
}

export async function setAvailability(user: UserRow, input: SetAvailabilityRequest) {
  const db = getDb();

  // Overlap within the same day would double-count capacity, and the scheduler
  // would plan against hours that do not exist. Rejected here rather than
  // silently merged, because the learner should see what they actually entered.
  const byDay = new Map<number, { start: string; end: string }[]>();
  for (const rule of input.rules) {
    if (rule.kind === 'blocked') continue;
    const existing = byDay.get(rule.dayOfWeek) ?? [];
    for (const other of existing) {
      if (rule.startTime < other.end && other.start < rule.endTime) {
        throw new ApiError(
          ERROR_CODES.VALIDATION_FAILED,
          `Overlapping availability on day ${rule.dayOfWeek}: ${other.start}–${other.end} and ${rule.startTime}–${rule.endTime}.`,
        );
      }
    }
    existing.push({ start: rule.startTime, end: rule.endTime });
    byDay.set(rule.dayOfWeek, existing);
  }

  await availabilityRepository(db).replaceAll(
    user.id,
    input.rules.map((r) => ({
      dayOfWeek: r.dayOfWeek,
      startTime: r.startTime,
      endTime: r.endTime,
      kind: r.kind,
      effectiveFrom: r.effectiveFrom ?? null,
      effectiveUntil: r.effectiveUntil ?? null,
    })),
  );

  logger.info('availability updated', { ruleCount: input.rules.length });
  trackEvent(user.id, EVENTS.availabilitySet, {
    ruleCount: input.rules.length,
    weeklyMinutes: weeklyMinutes(input.rules),
  });

  /**
   * §10.1 classes this as a Constraint trigger, and it now actually fires one.
   *
   * It used to say "the caller regenerates explicitly; the UI does that
   * immediately after saving" — which was not true of any caller. An audit
   * collapsed availability from 48,510 minutes a fortnight to 1,560 and the plan
   * stayed on version 1, still slotting 145 minutes into a Thursday the learner
   * had just given away. `'constraint'` was declared in `ReplanTriggerClass` and
   * fired from nowhere in the codebase.
   *
   * Server-side rather than in the form, so it holds for the API too.
   *
   * `replanQuietly` swallows its own failures: a scheduler problem must not make
   * saving your availability fail, because the learner would have no idea which
   * half succeeded. The materiality gate and the churn budget still apply, so a
   * trivial edit does not churn the plan.
   */
  const goals = await goalsRepository(db).listForUser(user.id);
  for (const goal of goals.filter((g) => g.status === 'active')) {
    await replanQuietly(user, goal.id, 'availability_changed', 'constraint');
  }

  return getAvailability(user);
}

const DEFAULT_PREFERENCES = {
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  maxDirectivesPerDay: 3,
  theme: 'system' as const,
  notificationChannels: { in_app: true, email: true },
};

export async function getPreferences(user: UserRow) {
  const row = await preferencesRepository(getDb()).get(user.id);
  if (!row) return DEFAULT_PREFERENCES;
  return {
    quietHoursStart: row.quietHoursStart.slice(0, 5),
    quietHoursEnd: row.quietHoursEnd.slice(0, 5),
    maxDirectivesPerDay: row.maxDirectivesPerDay,
    theme: (row.theme as 'light' | 'dark' | 'system') ?? 'system',
    notificationChannels: row.notificationChannels,
  };
}

export async function updatePreferences(user: UserRow, input: UpdatePreferencesRequest) {
  await preferencesRepository(getDb()).update(user.id, {
    ...(input.quietHoursStart !== undefined ? { quietHoursStart: input.quietHoursStart } : {}),
    ...(input.quietHoursEnd !== undefined ? { quietHoursEnd: input.quietHoursEnd } : {}),
    ...(input.maxDirectivesPerDay !== undefined
      ? { maxDirectivesPerDay: input.maxDirectivesPerDay }
      : {}),
    ...(input.theme !== undefined ? { theme: input.theme } : {}),
  });
  return getPreferences(user);
}
