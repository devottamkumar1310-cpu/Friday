-- Additive migration: add decision_trace_id to insights table.
--
-- Context: migration 0006_insights_evidence_citation.sql contained a
-- CREATE TABLE "insights" statement, but the insights table was already
-- created in 0004_assessment_intelligence_coach_platform.sql. The CREATE
-- TABLE in 0006 failed silently (table already exists) and was recorded
-- as applied, leaving the column missing from the live schema.
--
-- This migration adds the column idempotently with IF NOT EXISTS.

ALTER TABLE "insights"
  ADD COLUMN IF NOT EXISTS "decision_trace_id" uuid
    REFERENCES "decision_traces"("id") ON DELETE SET NULL;
