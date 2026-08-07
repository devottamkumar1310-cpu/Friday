import { describe, expect, it } from 'vitest';
import { inspectEnv } from '../env';

/**
 * Boot-time configuration checks.
 *
 * These decide whether an instance starts at all, so the line between "fatal"
 * and "warn" is the whole design. Fatal means the instance would be unsafe or
 * useless; a warning means it would work but somebody should know.
 */

const VALID = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://friday:secret@db.internal:5432/friday',
  AUTH_SECRET: 'K1jd8s0aKq2mZp4vX7cB9nW3tR6yU5hL0gF2dS8aQ4w=',
  APP_URL: 'https://friday.example',
  SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/2',
} as NodeJS.ProcessEnv;

const fatalVars = (env: NodeJS.ProcessEnv) =>
  inspectEnv(env)
    .filter((p) => p.fatal)
    .map((p) => p.variable);

describe('inspectEnv', () => {
  it('passes a correctly configured production environment', () => {
    expect(inspectEnv(VALID)).toEqual([]);
  });

  it('refuses to start without a database or a signing secret', () => {
    expect(fatalVars({ ...VALID, DATABASE_URL: undefined })).toContain('DATABASE_URL');
    expect(fatalVars({ ...VALID, AUTH_SECRET: undefined })).toContain('AUTH_SECRET');
  });

  it('catches a template placeholder that was never filled in', () => {
    // The likeliest real failure: `.env.example` copied and half-edited.
    expect(
      fatalVars({
        ...VALID,
        DATABASE_URL: 'postgresql://user:password@host/friday?sslmode=require',
      }),
    ).toContain('DATABASE_URL');
  });

  it('refuses a signing secret short enough to be guessable', () => {
    expect(fatalVars({ ...VALID, AUTH_SECRET: 'short' })).toContain('AUTH_SECRET');
  });

  it('refuses the CI placeholder secret in production, but tolerates it elsewhere', () => {
    const placeholder = 'ci-placeholder-secret-at-least-32-chars-long';
    expect(fatalVars({ ...VALID, AUTH_SECRET: placeholder })).toContain('AUTH_SECRET');
    // A build must still be able to run without a real secret.
    expect(
      fatalVars({ ...VALID, NODE_ENV: 'test', AUTH_SECRET: placeholder, APP_URL: 'http://x' }),
    ).toEqual([]);
  });

  it('refuses plaintext http in production, because Secure cookies would never arrive', () => {
    expect(fatalVars({ ...VALID, APP_URL: 'http://friday.example' })).toContain('APP_URL');
  });

  it('allows plaintext http on loopback, which browsers treat as a secure context', () => {
    // `next start` and CI both run a production build over http on 127.0.0.1.
    // Refusing that made the check fail every local production run — which is
    // how this exemption was found.
    for (const url of ['http://localhost:3000', 'http://127.0.0.1:3100']) {
      expect(fatalVars({ ...VALID, APP_URL: url }), url).not.toContain('APP_URL');
    }
  });

  it('warns without failing when APP_URL or error reporting is absent', () => {
    const problems = inspectEnv({ ...VALID, APP_URL: undefined, SENTRY_DSN: undefined });
    expect(problems.map((p) => p.variable).sort()).toEqual(['APP_URL', 'SENTRY_DSN']);
    expect(problems.every((p) => !p.fatal)).toBe(true);
  });

  it('never repeats a configured value back, only its name', () => {
    const secret = 'a-real-looking-but-too-short';
    const reported = JSON.stringify(inspectEnv({ ...VALID, AUTH_SECRET: secret }));
    expect(reported).not.toContain(secret);
    expect(reported).not.toContain('db.internal');
  });
});
