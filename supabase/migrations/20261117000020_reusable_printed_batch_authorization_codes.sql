-- Phase 9: instructor-controlled regeneration of reusable printed-assessment batch codes.
-- A code remains valid for repeated student scan registrations until it is rotated or its batch is deactivated.

BEGIN;

CREATE OR REPLACE FUNCTION public.academix_regenerate_printed_assessment_batch_code(
  p_batch_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_batch public.printed_assessment_batches%rowtype;
  v_profile public.profiles%rowtype;
  v_code text;
  v_hint text;
BEGIN
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id=auth.uid()
    AND role='teacher'::public.app_role
    AND verified_at IS NOT NULL
    AND suspended_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verified active instructor account required.'
      USING errcode='42501';
  END IF;

  SELECT * INTO v_batch
  FROM public.printed_assessment_batches
  WHERE id=p_batch_id
    AND instructor_id=auth.uid()
    AND active=true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active printed assessment batch not found for this instructor.'
      USING errcode='42501';
  END IF;

  v_code:=upper(encode(gen_random_bytes(16),'hex'));
  v_hint:=right(v_code,4);

  UPDATE public.printed_assessment_batches
  SET authorization_code_hash=encode(digest(v_code,'sha256'),'hex'),
      authorization_code_hint=v_hint
  WHERE id=p_batch_id;

  RETURN jsonb_build_object(
    'batch_id',p_batch_id,
    'authorization_code',v_code,
    'authorization_code_hint',v_hint,
    'reusable',true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.academix_regenerate_printed_assessment_batch_code(uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.academix_regenerate_printed_assessment_batch_code(uuid)
  TO authenticated;

COMMIT;
