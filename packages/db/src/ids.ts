import { v7 as uuidv7 } from 'uuid';

/**
 * Primary keys — DATABASE_DESIGN D1 / ADR-018.
 *
 * UUIDv7 is time-sortable, so it keeps the index locality of a serial without
 * leaking row counts or allowing enumeration, and it is safe to expose in URLs.
 *
 * Generated here rather than by a database default: `uuidv7()` is a PostgreSQL
 * 18 builtin, and depending on it would pin the engine version and make id
 * generation impossible to unit-test without a live database.
 */
export function newId(): string {
  return uuidv7();
}

/** Deterministic ids for fixtures, so seeded data is stable across runs. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
