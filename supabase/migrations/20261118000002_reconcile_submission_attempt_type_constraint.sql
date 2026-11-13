-- Reconcile legacy and current attempt-type values for exam submissions.
-- Older attempt migrations used 'regular'; the later Phase 9 workflow uses 'initial'.
-- Keep both labels valid for compatibility while retake/remedial remain authorization-gated.

BEGIN;

ALTER TABLE public.submissions
  DROP CONSTRAINT IF EXISTS submissions_attempt_type_check;

ALTER TABLE public.submissions
  ADD CONSTRAINT submissions_attempt_type_check
  CHECK (attempt_type IN ('initial', 'regular', 'retake', 'remedial'));

COMMIT;
