-- Phase 5 database regression checks (pgTAP).
-- Run with: supabase test db
-- These checks are read-only and do not create or modify application records.
BEGIN;

SET LOCAL search_path = extensions, public;

SELECT plan(2);

SELECT ok(
  EXISTS (
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
  ),
  'admin audit outcome constraint permits success, failure, and denied'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_class t
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'admin_audit_log'
      AND t.relrowsecurity
  ),
  'admin audit log has row-level security enabled'
);

SELECT * FROM finish();

ROLLBACK;
