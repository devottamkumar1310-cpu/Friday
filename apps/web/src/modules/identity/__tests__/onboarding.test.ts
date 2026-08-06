import { describe, expect, it } from 'vitest';
import type { StoredOnboardingState } from '@friday/db';
import { canCreateGoal, deriveOnboardingState } from '../onboarding';

type UserShape = {
  dateOfBirth: string | null;
  isMinor: boolean | null;
  onboardingState: StoredOnboardingState;
};

const user = (over: Partial<UserShape> = {}): UserShape => ({
  dateOfBirth: '2000-01-01',
  isMinor: false,
  onboardingState: { step: 'goal', completed: false },
  ...over,
});

describe('onboarding gate (FR-1.6)', () => {
  it('blocks on date of birth when it is missing', () => {
    // The OAuth case: the row exists from the callback, before any form asked.
    const state = deriveOnboardingState(user({ dateOfBirth: null, isMinor: null }), false);
    expect(state).toMatchObject({ step: 'date_of_birth', blockedBy: 'date_of_birth' });
    expect(canCreateGoal(state)).toBe(false);
  });

  it('blocks a minor until guardian consent is recorded', () => {
    const state = deriveOnboardingState(user({ isMinor: true }), false);
    expect(state).toMatchObject({ step: 'guardian_consent', blockedBy: 'guardian_consent' });
    expect(canCreateGoal(state)).toBe(false);
  });

  it('releases a minor once consent exists', () => {
    const state = deriveOnboardingState(user({ isMinor: true }), true);
    expect(state.blockedBy).toBeNull();
    expect(canCreateGoal(state)).toBe(true);
  });

  it('never blocks an adult', () => {
    expect(deriveOnboardingState(user(), false).blockedBy).toBeNull();
  });

  it('checks date of birth before consent, so the earlier gap is reported first', () => {
    const state = deriveOnboardingState(user({ dateOfBirth: null, isMinor: true }), false);
    expect(state.blockedBy).toBe('date_of_birth');
  });

  it('advances a stale stored step once the gates are cleared', () => {
    // The stored step lags behind reality: consent has now been granted, so the
    // learner should be looking at goal setup, not the consent screen again.
    const state = deriveOnboardingState(
      user({ isMinor: true, onboardingState: { step: 'guardian_consent', completed: false } }),
      true,
    );
    expect(state.step).toBe('goal');
  });

  it('preserves a later stored step', () => {
    const state = deriveOnboardingState(
      user({ onboardingState: { step: 'curriculum', completed: false } }),
      true,
    );
    expect(state.step).toBe('curriculum');
  });
});
