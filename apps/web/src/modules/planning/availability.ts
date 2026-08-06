import type { AvailabilityWindow } from '@friday/core';
import type { AvailabilityRuleRow } from '@friday/db';

/**
 * Converts weekly `availability_rules` (+ temporary overrides) into a
 * concrete per-day capacity series — the input `core/scheduling` and
 * `core/feasibility` need (AI_DECISION_ENGINE §9). E-6: if a user has
 * declared no availability at all, every day is 0 and the caller must not
 * invent capacity.
 */
export function buildCapacityWindows(
  rules: AvailabilityRuleRow[],
  startDate: Date,
  days: number,
): AvailabilityWindow[] {
  const windows: AvailabilityWindow[] = [];

  for (let i = 0; i < days; i++) {
    const date = new Date(startDate.getTime() + i * 86_400_000);
    const dateKey = date.toISOString().slice(0, 10);
    const dayOfWeek = date.getUTCDay();

    let minutes = 0;
    for (const rule of rules) {
      if (rule.dayOfWeek !== dayOfWeek) continue;
      if (rule.effectiveFrom && dateKey < rule.effectiveFrom) continue;
      if (rule.effectiveUntil && dateKey > rule.effectiveUntil) continue;

      const ruleMinutes = timeToMinutes(rule.endTime) - timeToMinutes(rule.startTime);
      if (rule.kind === 'blocked') minutes -= ruleMinutes;
      else minutes += ruleMinutes;
    }

    windows.push({ date: dateKey, capacityMinutes: Math.max(0, minutes) });
  }

  return windows;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function hasAnyAvailability(rules: AvailabilityRuleRow[]): boolean {
  return rules.some((r) => r.kind === 'available');
}
