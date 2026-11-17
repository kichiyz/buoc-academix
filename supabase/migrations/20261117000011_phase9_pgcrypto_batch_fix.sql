-- Phase 9 hotfix: make pgcrypto functions visible to the batch-creation RPC.
-- Supabase commonly installs pgcrypto in the extensions schema, while the original
-- SECURITY DEFINER function restricted its search_path to public and pg_temp.

BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER FUNCTION public.academix_create_printed_assessment_batch(uuid, text)
  SET search_path = public, extensions, pg_temp;

COMMIT;
