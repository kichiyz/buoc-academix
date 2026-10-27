-- Phase 5 database regression checks.
-- Run after applying the Phase 5 migrations to a disposable local/test Supabase database:
--   supabase test db
-- These assertions verify the audit outcome constraint without creating or modifying audit records.
BEGIN;

CREATE TEMP TABLE phase5_assertions (check_name text PRIMARY KEY, ok boolean NOT NULL);

INSERT INTO phase5_assertions(check_name, ok)
SELECT 'audit_outcomes', EXISTS (
  SELECT 1
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'admin_audit_log'
    AND c.conname = 'admin_audit_log_outcome_check'
    AND pg_get_constraintdef(c.oid) LIKE '%success%'
    AND pg_get_constraintdef(c.oid) LIKE '%failure%'
    AND pg_get_constraintdef(c.oid) LIKE '%denied%'
);

DO $$
BEGIN
  IF NOT (SELECT ok FROM phase5_assertions LIMIT 1) THEN
    RAISE EXCEPTION 'Phase 5 audit outcome constraint is missing or does not allow success/failure/denied';
  END IF;
END $$;

INSERT INTO phase5_assertions(check_name, ok)
SELECT 'rls_enabled', EXISTS (
  SELECT 1 FROM pg_class t
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public' AND t.relname = 'admin_audit_log' AND t.relrowsecurity
);

DO $$
BEGIN
  IF NOT (SELECT ok FROM phase5_assertions WHERE check_name = 'rls_enabled') THEN
    RAISE EXCEPTION 'Phase 5 admin_audit_log must have row-level security enabled';
  END IF;
END $$;

ROLLBACK;
