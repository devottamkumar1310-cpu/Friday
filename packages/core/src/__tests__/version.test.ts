import { describe, expect, it } from 'vitest';
import { CONFIG_VERSION, ENGINE_VERSION } from '../version';

describe('engine versioning', () => {
  it('exposes a semantic engine version for decision traces', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exposes a named config version, so weight sets are identifiable', () => {
    expect(CONFIG_VERSION).toMatch(/^[a-z0-9_-]+@\d+\.\d+\.\d+$/);
  });
});
