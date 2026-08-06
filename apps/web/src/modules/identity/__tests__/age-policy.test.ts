import { describe, expect, it } from 'vitest';
import { ADULT_AGE, MINIMUM_AGE, ageInYears, classifyAge } from '../age-policy';

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe('ageInYears', () => {
  it('counts completed years', () => {
    expect(ageInYears('2000-01-01', at('2026-01-01'))).toBe(26);
  });

  it('does not count a birthday that has not happened yet this year', () => {
    expect(ageInYears('2008-12-31', at('2026-07-28'))).toBe(17);
  });

  it('counts the birthday itself', () => {
    // The boundary that decides whether guardian consent is required, so it is
    // worth pinning rather than assuming.
    expect(ageInYears('2008-07-28', at('2026-07-28'))).toBe(18);
  });

  it('is not off by one the day before a birthday', () => {
    expect(ageInYears('2008-07-29', at('2026-07-28'))).toBe(17);
  });

  it('handles a 29 February birth date in a non-leap year', () => {
    expect(ageInYears('2008-02-29', at('2026-02-28'))).toBe(17);
    expect(ageInYears('2008-02-29', at('2026-03-01'))).toBe(18);
  });

  it('rejects a malformed date rather than silently producing NaN', () => {
    expect(() => ageInYears('not-a-date', at('2026-07-28'))).toThrow();
  });
});

describe('classifyAge', () => {
  it('permits and flags a 17-year-old as a minor', () => {
    const result = classifyAge('2009-01-01', at('2026-07-28'));
    expect(result).toMatchObject({ age: 17, isMinor: true, permitted: true });
  });

  it('treats exactly 18 as an adult', () => {
    expect(classifyAge('2008-07-28', at('2026-07-28'))).toMatchObject({
      isMinor: false,
      permitted: true,
    });
  });

  it('refuses an account below the minimum age', () => {
    // FR-1.6: under-13 is blocked outright, not merely gated on consent.
    expect(classifyAge('2015-01-01', at('2026-07-28'))).toMatchObject({
      permitted: false,
    });
  });

  it('permits exactly the minimum age', () => {
    expect(classifyAge('2013-07-28', at('2026-07-28'))).toMatchObject({
      age: 13,
      permitted: true,
      isMinor: true,
    });
  });

  it('uses the thresholds the regulation sets', () => {
    expect(MINIMUM_AGE).toBe(13);
    expect(ADULT_AGE).toBe(18);
  });
});
