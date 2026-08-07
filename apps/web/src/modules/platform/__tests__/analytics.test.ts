import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVENTS } from '../analytics.service';
import { normalisePath } from '../feedback.service';

/**
 * Product telemetry — CR-007.
 *
 * Two things can rot here, and both look fine in review. An event name that no
 * call site emits reads as coverage that does not exist; a path that keeps its
 * identifiers turns a feedback table into a per-learner activity log.
 */

const MODULES = join(__dirname, '..', '..');

/** Every service file, so "is this emitted anywhere?" can actually be answered. */
function sourceOfAllServices(): string {
  const files = [
    'identity/identity.service.ts',
    'identity/settings.service.ts',
    'curriculum/curriculum.service.ts',
    'execution/execution.service.ts',
    'assessment/assessment.service.ts',
    'coach/coach.service.ts',
    'platform/feedback.service.ts',
  ];
  return files.map((f) => readFileSync(join(MODULES, f), 'utf8')).join('\n');
}

describe('the event vocabulary', () => {
  it('emits every event it declares', () => {
    // A funnel with a step nobody fires is worse than a missing step: it looks
    // measured and reports zero.
    const source = sourceOfAllServices();
    const unemitted = Object.keys(EVENTS).filter((key) => !source.includes(`EVENTS.${key}`));
    expect(unemitted, `declared but never emitted: ${unemitted.join(', ')}`).toEqual([]);
  });

  it('names events consistently, so a funnel can be written by hand', () => {
    for (const name of Object.values(EVENTS)) {
      expect(name, name).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it('covers the four questions a launch has to answer', () => {
    const names = Object.values(EVENTS);
    // Onboarding drop-off, loop closure, and Coach usage.
    expect(names).toContain('user.signed_up');
    expect(names).toContain('onboarding.availability_set');
    expect(names).toContain('goal.created');
    expect(names).toContain('session.completed');
    expect(names).toContain('coach.turn');
  });
});

describe('normalisePath', () => {
  it('replaces uuids with a placeholder', () => {
    expect(normalisePath('/study/019fdb90-35d0-739f-b41c-3e2248117f1b')).toBe('/study/:id');
  });

  it('drops the query string entirely', () => {
    // The likeliest place for something personal to end up.
    expect(normalisePath('/settings?email=someone@example.com')).toBe('/settings');
  });

  it('keeps an ordinary route intact', () => {
    expect(normalisePath('/dashboard')).toBe('/dashboard');
    expect(normalisePath('/onboarding/availability')).toBe('/onboarding/availability');
  });

  it('refuses anything that is not a path', () => {
    // An absolute URL would carry an origin, and a caller-supplied one at that.
    expect(normalisePath('https://evil.example/steal')).toBeNull();
    expect(normalisePath('')).toBeNull();
    expect(normalisePath(undefined)).toBeNull();
  });

  it('caps the length, so the column cannot be used as free storage', () => {
    expect(normalisePath(`/${'a'.repeat(500)}`)!.length).toBeLessThanOrEqual(120);
  });
});
