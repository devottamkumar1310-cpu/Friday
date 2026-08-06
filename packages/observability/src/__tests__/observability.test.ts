import { describe, expect, it } from 'vitest';
import { createLogger } from '../logger';
import { getRequestId, newRequestId, setContextUser, withRequestContext } from '../context';
import { maskEmail, redact } from '../redact';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: 'debug',
    sink: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  return { logger, lines };
}

describe('request context', () => {
  it('propagates one id through nested async work', async () => {
    const id = newRequestId();
    const seen = await withRequestContext({ requestId: id }, async () => {
      await Promise.resolve();
      return getRequestId();
    });
    expect(seen).toBe(id);
  });

  it('isolates concurrent requests from each other', async () => {
    const [a, b] = await Promise.all([
      withRequestContext({ requestId: 'aaa' }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getRequestId();
      }),
      withRequestContext({ requestId: 'bbb' }, async () => getRequestId()),
    ]);
    expect(a).toBe('aaa');
    expect(b).toBe('bbb');
  });

  it('returns undefined outside a request', () => {
    expect(getRequestId()).toBeUndefined();
  });
});

describe('logger', () => {
  it('stamps every line with the ambient request and user id', () => {
    const { logger, lines } = capture();
    withRequestContext({ requestId: 'req-1' }, () => {
      setContextUser('user-1');
      logger.info('signed in');
    });
    expect(lines[0]).toMatchObject({ requestId: 'req-1', userId: 'user-1', message: 'signed in' });
  });

  it('honours the level threshold', () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'warn', sink: (l) => lines.push(l) });
    logger.info('ignored');
    logger.warn('kept');
    expect(lines).toHaveLength(1);
  });

  it('merges child fields into every line', () => {
    const { logger, lines } = capture();
    logger.child({ module: 'identity' }).info('hello');
    expect(lines[0]).toMatchObject({ module: 'identity' });
  });

  it('redacts secrets that reach the logger anyway', () => {
    const { logger, lines } = capture();
    logger.info('sign-up', { password: 'hunter2', nested: { token_hash: 'abc' } });
    expect(lines[0]?.['password']).toBe('[redacted]');
    expect((lines[0]?.['nested'] as Record<string, unknown>)['token_hash']).toBe('[redacted]');
  });
});

describe('redaction', () => {
  it('strips sensitive keys at any depth, case-insensitively', () => {
    const out = redact({ a: { accessToken: 'x', keep: 1 } }) as Record<
      string,
      Record<string, unknown>
    >;
    expect(out['a']?.['accessToken']).toBe('[redacted]');
    expect(out['a']?.['keep']).toBe(1);
  });

  it('redacts date of birth — it is regulated personal data (NFR-3.8)', () => {
    const out = redact({ dateOfBirth: '2007-05-14' }) as Record<string, unknown>;
    expect(out['dateOfBirth']).toBe('[redacted]');
  });

  it('serialises errors without losing the stack', () => {
    const out = redact(new Error('boom')) as Record<string, unknown>;
    expect(out['message']).toBe('boom');
    expect(out['stack']).toBeTypeOf('string');
  });

  it('masks emails for support correlation', () => {
    expect(maskEmail('student@example.com')).toBe('st*****@example.com');
  });
});
