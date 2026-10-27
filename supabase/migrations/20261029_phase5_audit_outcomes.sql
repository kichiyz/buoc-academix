-- BUOC AcademiX Phase 5 follow-up: represent denied/failed admin actions in audit outcomes.
-- Apply only to the isolated local/test Supabase project first.
ALTER TABLE public.admin_audit_log
  DROP CONSTRAINT IF EXISTS admin_audit_log_outcome_check;

ALTER TABLE public.admin_audit_log
  ADD CONSTRAINT admin_audit_log_outcome_check
  CHECK (outcome IN ('success', 'failure', 'denied'));

COMMENT ON COLUMN public.admin_audit_log.outcome IS
  'Administrative action outcome: success, failure, or denied. Existing successful records remain unchanged.';
