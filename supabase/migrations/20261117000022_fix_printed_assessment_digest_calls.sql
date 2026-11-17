-- Fix remaining Phase 9 authorization hash calls.
-- The original batch creation and scan-registration RPCs used unqualified digest(text, unknown).
-- Keep all pgcrypto calls schema-qualified and pass an explicit bytea/text signature.

BEGIN;

CREATE OR REPLACE FUNCTION public.academix_create_printed_assessment_batch(
  p_exam_id uuid,
  p_sheet_format text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_exam public.exams%rowtype;
  v_offering public.course_offerings%rowtype;
  v_profile public.profiles%rowtype;
  v_code text;
  v_batch uuid;
BEGIN
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id=auth.uid()
    AND role='teacher'::public.app_role
    AND verified_at IS NOT NULL
    AND suspended_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verified active instructor account required.' USING errcode='42501';
  END IF;

  IF p_sheet_format NOT IN ('question_paper','omr') THEN
    RAISE EXCEPTION 'Unsupported printed sheet format.' USING errcode='22023';
  END IF;

  SELECT * INTO v_exam
  FROM public.exams
  WHERE id=p_exam_id AND teacher_id=auth.uid()
  FOR UPDATE;

  IF NOT FOUND OR v_exam.status<>'published' OR v_exam.course_offering_id IS NULL THEN
    RAISE EXCEPTION 'Choose a published assessment assigned to one of your course offerings.' USING errcode='42501';
  END IF;

  SELECT * INTO v_offering
  FROM public.course_offerings
  WHERE id=v_exam.course_offering_id AND instructor_id=auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The course offering is not assigned to this instructor.' USING errcode='42501';
  END IF;

  IF v_profile.registered_signature_path IS NULL OR NOT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id='printed-assessments'
      AND name=v_profile.registered_signature_path
      AND owner_id=auth.uid()::text
  ) THEN
    RAISE EXCEPTION 'Register a valid private instructor signature specimen before creating printed assessments.' USING errcode='55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.printed_assessment_batches WHERE exam_id=p_exam_id
  ) THEN
    RAISE EXCEPTION 'A printed assessment batch already exists for this examination.' USING errcode='23505';
  END IF;

  -- Generate 256 bits using two UUIDs; no pgcrypto random-bytes dependency.
  v_code:=upper(
    replace(gen_random_uuid()::text,'-','') ||
    replace(gen_random_uuid()::text,'-','')
  );

  INSERT INTO public.printed_assessment_batches(
    exam_id,course_offering_id,instructor_id,instructor_name_snapshot,
    instructor_signature_path_snapshot,sheet_format,
    authorization_code_hash,authorization_code_hint
  ) VALUES (
    p_exam_id,v_offering.id,auth.uid(),v_profile.full_name,
    v_profile.registered_signature_path,p_sheet_format,
    encode(
      extensions.digest(
        convert_to(v_code,'UTF8'::name),
        'sha256'::text
      ),
      'hex'
    ),
    right(v_code,4)
  )
  RETURNING id INTO v_batch;

  RETURN jsonb_build_object(
    'batch_id',v_batch,
    'authorization_code',v_code,
    'instructor_name',v_profile.full_name,
    'sheet_format',p_sheet_format
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.academix_register_printed_assessment_scan(
  p_batch_id uuid,
  p_student_id uuid,
  p_object_path text,
  p_authorization_code text,
  p_printed_instructor_name text,
  p_signature_visually_confirmed boolean,
  p_detected_answers jsonb DEFAULT '{}'::jsonb,
  p_recognition_report jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_batch public.printed_assessment_batches%rowtype;
  v_scan uuid;
  v_exam public.exams%rowtype;
  v_profile public.profiles%rowtype;
BEGIN
  SELECT * INTO v_batch
  FROM public.printed_assessment_batches
  WHERE id=p_batch_id
    AND instructor_id=auth.uid()
    AND active
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active printed assessment not found for this instructor.' USING errcode='42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id=auth.uid()
      AND role='teacher'::public.app_role
      AND verified_at IS NOT NULL
      AND suspended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Verified active instructor account required.' USING errcode='42501';
  END IF;

  IF p_authorization_code IS NULL OR
     encode(
       extensions.digest(
         convert_to(upper(trim(p_authorization_code)),'UTF8'::name),
         'sha256'::text
       ),
       'hex'
     ) <> v_batch.authorization_code_hash THEN
    RAISE EXCEPTION 'Printed assessment authorization code is invalid.' USING errcode='42501';
  END IF;

  IF lower(regexp_replace(trim(coalesce(p_printed_instructor_name,'')),'\\s+',' ','g'))
     <> lower(regexp_replace(trim(v_batch.instructor_name_snapshot),'\\s+',' ','g')) THEN
    RAISE EXCEPTION 'The instructor name on the scanned paper does not match the authorized instructor.' USING errcode='42501';
  END IF;

  IF p_signature_visually_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Visually confirm the instructor signature against the registered specimen before processing.' USING errcode='42501';
  END IF;

  IF p_object_path IS NULL OR
     p_object_path !~ ('^'||auth.uid()::text||'/'||p_batch_id::text||'/[A-Za-z0-9._-]+$') THEN
    RAISE EXCEPTION 'Scan file path is invalid.' USING errcode='22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id='printed-assessments'
      AND name=p_object_path
      AND owner_id=auth.uid()::text
  ) THEN
    RAISE EXCEPTION 'Uploaded scan was not found in private storage.' USING errcode='P0002';
  END IF;

  SELECT * INTO v_exam FROM public.exams WHERE id=v_batch.exam_id;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id=p_student_id
    AND role='student'::public.app_role
    AND verified_at IS NOT NULL
    AND suspended_at IS NULL;

  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.exam_assignments
    WHERE exam_id=v_batch.exam_id AND student_id=p_student_id
  ) THEN
    RAISE EXCEPTION 'The selected student is not an eligible assignee for this assessment.' USING errcode='42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.course_offerings o
    WHERE o.id=v_batch.course_offering_id
      AND o.instructor_id=auth.uid()
      AND v_profile.campus_id=o.campus_id
      AND v_profile.college_id=o.college_id
      AND v_profile.program_id=o.program_id
      AND v_profile.year_level=o.year_level
      AND upper(v_profile.block_code)=upper(o.block_code)
  ) THEN
    RAISE EXCEPTION 'The student is outside this instructor’s assigned academic class.' USING errcode='42501';
  END IF;

  INSERT INTO public.printed_assessment_scans(
    batch_id,student_id,object_path,detected_answers,recognition_report,status,
    instructor_name_verified,signature_visually_confirmed,uploaded_by
  ) VALUES (
    p_batch_id,p_student_id,p_object_path,
    coalesce(p_detected_answers,'{}'::jsonb),
    coalesce(p_recognition_report,'{}'::jsonb),
    'needs_review',v_batch.instructor_name_snapshot,true,auth.uid()
  )
  RETURNING id INTO v_scan;

  RETURN jsonb_build_object(
    'scan_id',v_scan,
    'status','needs_review',
    'student_id',p_student_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.academix_create_printed_assessment_batch(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.academix_register_printed_assessment_scan(uuid,uuid,text,text,text,boolean,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.academix_create_printed_assessment_batch(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.academix_register_printed_assessment_scan(uuid,uuid,text,text,text,boolean,jsonb,jsonb) TO authenticated;

COMMIT;
