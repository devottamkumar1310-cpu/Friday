-- Migration 0000 — bootstrap extensions and shared helpers.
--
-- DATABASE_DESIGN §1.1. Contains only what the *identity* schema in migration
-- 0001 actually needs.
--
-- RULE (CR-002): an extension is installed by the migration that first requires
-- it, never by an earlier bootstrap migration. `vector` therefore does not
-- appear here — pgvector is a third-party extension absent from a stock
-- PostgreSQL, and requiring it now would make every environment carry a
-- Phase 3 dependency to create Phase 0 tables. It is installed alongside
-- `memory_chunks`, the first object that needs it (DATABASE_DESIGN §4.6).
--
-- No extension is needed for primary keys: UUIDv7 is generated in the
-- application layer (D1 / ADR-018), which keeps the schema portable across
-- PostgreSQL 16, 17, and 18 and lets id generation be unit-tested without a
-- live database.

-- citext: case-insensitive email uniqueness. Ships with PostgreSQL as contrib.
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
-- `updated_at` is maintained by trigger rather than by application code
-- (DATABASE_DESIGN §8), so it cannot be forgotten at a call site.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
