import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { newId } from '../ids';
import { authSessions, users } from '../schema/identity';

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');

/** Migration files in application order — the order matters for D11. */
const migrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, sql: readFileSync(resolve(migrationsDir, name), 'utf8') }));

const migrationSql = migrationFiles.map((m) => m.sql).join('\n');

describe('id generation', () => {
  it('produces version-7 uuids', () => {
    const id = newId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('sorts lexicographically in creation order — the reason for v7 over v4', () => {
    const ids = Array.from({ length: 50 }, () => newId());
    expect([...ids].sort()).toEqual(ids);
  });

  it('does not collide across a burst', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newId()));
    expect(ids.size).toBe(5000);
  });
});

describe('migration SQL', () => {
  it('never calls uuidv7() — that is a PostgreSQL 18 builtin (ADR-018)', () => {
    // Depending on it would pin the engine version and break migration 0001 on
    // the PostgreSQL 16 the blueprint targets.
    expect(migrationSql).not.toMatch(/uuidv7\s*\(/i);
  });

  it('emits primary keys with no database-side default', () => {
    const idColumns = migrationSql.match(/"id" uuid PRIMARY KEY[^,\n]*/g) ?? [];
    expect(idColumns.length).toBeGreaterThan(0);
    for (const decl of idColumns) expect(decl).not.toMatch(/DEFAULT/i);
  });

  it('installs citext before the identity schema that depends on it', () => {
    // `vector` is deliberately absent here — see the D11 tests below (CR-002).
    const extensions = readFileSync(resolve(migrationsDir, '0000_extensions.sql'), 'utf8');
    expect(extensions).toMatch(/CREATE EXTENSION IF NOT EXISTS citext/i);
  });

  it('does not require pgvector before the schema that needs it (D11)', () => {
    // CR-002: pgvector is third-party and absent from a stock PostgreSQL.
    // Installing it in the bootstrap would force every environment to carry a
    // Phase 3 dependency in order to create the Phase 0 identity tables.
    const bootstrap = migrationFiles[0];
    expect(bootstrap?.name).toBe('0000_extensions.sql');
    expect(bootstrap?.sql).not.toMatch(/CREATE\s+EXTENSION[^;]*\bvector\b/i);
  });

  it('installs an extension no later than the first object that depends on it (D11)', () => {
    // Holds trivially today and becomes a real guard the moment the Phase 3
    // migration introduces memory_chunks — which is the point of writing it now.
    const dependsOnVector =
      /\bvector\s*\(\s*\d+\s*\)|vector_cosine_ops|vector_l2_ops|USING\s+hnsw|USING\s+ivfflat/i;
    const installsVector = /CREATE\s+EXTENSION[^;]*\bvector\b/i;

    let installedAt: number | null = null;
    for (const [index, file] of migrationFiles.entries()) {
      if (installsVector.test(file.sql)) installedAt = installedAt ?? index;

      if (dependsOnVector.test(file.sql)) {
        expect(
          installedAt,
          `${file.name} uses a vector type or index, but no migration up to and including it runs CREATE EXTENSION vector`,
        ).not.toBeNull();

        // Within the same file the extension must come first.
        if (installedAt === index) {
          expect(
            file.sql.search(installsVector),
            `${file.name} must CREATE EXTENSION vector above the first object that uses it`,
          ).toBeLessThan(file.sql.search(dependsOnVector));
        }
      }
    }
  });

  it('runs on a stock PostgreSQL up to the migration that knowingly adds a dependency', () => {
    // The guarantee: a contributor with a plain PostgreSQL can migrate right up
    // to the point where the project consciously took on a third-party
    // extension. Every migration before that must need only bundled contrib.
    // This stays true when Phase 3 legitimately introduces pgvector.
    const BUNDLED = new Set(['citext', 'pgcrypto', 'uuid-ossp', 'btree_gin', 'btree_gist']);
    const extensionsIn = (sql: string) =>
      [...sql.matchAll(/CREATE\s+EXTENSION(?:\s+IF\s+NOT\s+EXISTS)?\s+"?([a-z_-]+)"?/gi)]
        .map((m) => m[1]?.toLowerCase())
        .filter((n): n is string => Boolean(n));

    const firstThirdParty = migrationFiles.findIndex((f) =>
      extensionsIn(f.sql).some((n) => !BUNDLED.has(n)),
    );
    const stockCompatible =
      firstThirdParty === -1 ? migrationFiles : migrationFiles.slice(0, firstThirdParty);

    for (const file of stockCompatible) {
      for (const name of extensionsIn(file.sql)) {
        expect(BUNDLED.has(name), `${file.name} needs third-party extension "${name}"`).toBe(true);
      }
    }

    // Deliberate tripwire. Today every migration is stock-compatible; the first
    // one that is not is a real infrastructure decision, and this failure is
    // where it gets noticed rather than in someone's broken local setup.
    expect(
      firstThirdParty,
      firstThirdParty === -1
        ? ''
        : `${migrationFiles[firstThirdParty]?.name} takes on a third-party extension. ` +
            'That is expected at Phase 3 — switch the CI Postgres image to ' +
            'pgvector/pgvector:pg16, note the new requirement in .env.example, and update this expectation.',
    ).toBe(-1);
  });

  it('contains no CHECK constraint with a subquery — PostgreSQL rejects those', () => {
    const checks =
      migrationSql.match(/CONSTRAINT\s+"[^"]+"\s+CHECK\s*\([\s\S]*?\)(?=,|\n)/gi) ?? [];
    for (const check of checks) expect(check).not.toMatch(/\bSELECT\b/i);
  });
});

describe('identity schema', () => {
  it('marks id as the primary key', () => {
    const id = getTableConfig(users).columns.find((c) => c.name === 'id');
    expect(id?.primary).toBe(true);
  });

  it('leaves date_of_birth nullable, gating it in the service instead', () => {
    // The row exists from the OAuth callback, before a form can ask (FR-1.6).
    const dob = getTableConfig(users).columns.find((c) => c.name === 'date_of_birth');
    expect(dob?.notNull).toBe(false);
  });

  it('stores only a hash of the session token', () => {
    const columns = getTableConfig(authSessions).columns.map((c) => c.name);
    expect(columns).toContain('token_hash');
    expect(columns).not.toContain('token');
  });

  it('starts onboarding at the date-of-birth step', () => {
    const onboarding = getTableConfig(users).columns.find((c) => c.name === 'onboarding_state');
    expect(onboarding?.default).toMatchObject({ step: 'date_of_birth', completed: false });
  });

  it('cascades session deletion from the user', () => {
    const fks = getTableConfig(authSessions).foreignKeys;
    expect(fks).toHaveLength(1);
    expect(fks[0]?.onDelete).toBe('cascade');
  });
});
