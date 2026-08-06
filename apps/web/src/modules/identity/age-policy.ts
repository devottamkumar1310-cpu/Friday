/**
 * Age policy — FR-1.6.
 *
 * India's DPDP Act 2023 requires verifiable parental consent below 18, and the
 * launch segment (JEE/NEET aspirants) is predominantly 16–18. Minors are
 * therefore the common case here, not an edge case, which is why this gate sits
 * in front of goal creation from M0 rather than being deferred.
 *
 * Pure functions over plain data: no I/O, no clock reads. `now` is always
 * passed in, so the behaviour on a birthday boundary is testable.
 */

/** Below this, the service refuses the account outright. */
export const MINIMUM_AGE = 13;

/** Below this, a guardian consent record is required before a Goal is created. */
export const ADULT_AGE = 18;

export interface AgeClassification {
  age: number;
  isMinor: boolean;
  /** False when the user is under MINIMUM_AGE and may not hold an account. */
  permitted: boolean;
}

/**
 * Completed years between `dateOfBirth` (YYYY-MM-DD) and `now`.
 *
 * Compared as calendar components rather than by dividing a millisecond
 * difference: the latter drifts across leap years and DST, and being one day
 * wrong at the 18th birthday is exactly the case that matters.
 */
export function ageInYears(dateOfBirth: string, now: Date): number {
  const [y, m, d] = dateOfBirth.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Malformed date of birth: ${dateOfBirth}`);

  let age = now.getUTCFullYear() - y;
  const monthDelta = now.getUTCMonth() + 1 - m;
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < d)) age -= 1;
  return age;
}

export function classifyAge(dateOfBirth: string, now: Date): AgeClassification {
  const age = ageInYears(dateOfBirth, now);
  return {
    age,
    isMinor: age < ADULT_AGE,
    permitted: age >= MINIMUM_AGE,
  };
}
