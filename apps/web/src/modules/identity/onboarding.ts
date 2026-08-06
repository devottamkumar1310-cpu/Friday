import type { OnboardingState } from '@friday/contracts';
import type { StoredOnboardingState, UserRow } from '@friday/db';

/**
 * Derives the onboarding state the client sees.
 *
 * `blockedBy` is computed on read rather than stored, because it is a function
 * of two facts that change independently — whether a date of birth exists, and
 * whether a guardian consent record exists. Persisting a derived flag would let
 * it go stale the moment a consent row lands.
 */
export function deriveOnboardingState(
  user: Pick<UserRow, 'dateOfBirth' | 'isMinor' | 'onboardingState'>,
  hasGuardianConsent: boolean,
): OnboardingState {
  const stored: StoredOnboardingState = user.onboardingState;

  if (!user.dateOfBirth) {
    return { step: 'date_of_birth', completed: false, blockedBy: 'date_of_birth' };
  }

  if (user.isMinor && !hasGuardianConsent) {
    return { step: 'guardian_consent', completed: false, blockedBy: 'guardian_consent' };
  }

  return {
    step:
      stored.step === 'date_of_birth' || stored.step === 'guardian_consent' ? 'goal' : stored.step,
    completed: stored.completed,
    blockedBy: null,
  };
}

/** Whether the learner may create a Goal yet (FR-1.6). */
export function canCreateGoal(state: OnboardingState): boolean {
  return state.blockedBy === null;
}
