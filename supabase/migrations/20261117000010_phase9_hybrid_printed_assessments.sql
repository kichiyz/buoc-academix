-- Phase 9: printed assessments, OMR-assisted grading, manual review, and instructor authorization.
-- Additive only. This migration does not publish grades or mutate existing assessment records.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS registered_signature_path text,
  ADD COLUMN IF NOT EXISTS registered_signature_updated_at timestamptz;

CREATE TABLE IF NOT EXISTS public.printed_assessment_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE RESTRICT,
  course_offering_id uuid NOT NULL REFERENCES public.course_offerings(id) ON DELETE RESTRICT,
  instructor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  instructor_name_snapshot text NOT NULL,
  instructor_signature_path_snapshot text NOT NULL,
  sheet_format text NOT NULL CHECK (sheet_format IN ('question_paper','omr')),
  authorization_code_hash text NOT NULL,
  authorization_code_hint text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(exam_id)
);

CREATE TABLE IF NOT EXISTS public.printed_assessment_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.printed_assessment_batches(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  object_path text NOT NULL UNIQUE,
  detected_answers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detected_answers)='object'),
  recognition_report jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(recognition_report)='object'),
  item_scores jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(item_scores)='array'),
  score numeric(9,2),
  max_score numeric(9,2),
  feedback text,
  status text NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded','needs_review','graded','published')),
  instructor_name_verified text NOT NULL,
  signature_visually_confirmed boolean NOT NULL DEFAULT false,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  graded_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  uploaded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  graded_at timestamptz,
  approved_at timestamptz,
  submission_id uuid UNIQUE REFERENCES public.submissions(id) ON DELETE RESTRICT,
  UNIQUE(batch_id,student_id),
  CHECK (score IS NULL OR score >= 0),
  CHECK (max_score IS NULL OR max_score >= 0),
  CHECK (score IS NULL OR max_score IS NULL OR score <= max_score)
);

CREATE INDEX IF NOT EXISTS printed_batches_instructor_created_idx
  ON public.printed_assessment_batches(instructor_id,created_at DESC);
CREATE INDEX IF NOT EXISTS printed_scans_batch_status_idx
  ON public.printed_assessment_scans(batch_id,status,uploaded_at DESC);
CREATE INDEX IF NOT EXISTS printed_scans_student_idx
  ON public.printed_assessment_scans(student_id,uploaded_at DESC);

ALTER TABLE public.printed_assessment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.printed_assessment_scans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.printed_assessment_batches,public.printed_assessment_scans FROM anon,authenticated;
GRANT SELECT ON public.printed_assessment_batches,public.printed_assessment_scans TO authenticated;

DROP POLICY IF EXISTS "Teachers read own printed batches" ON public.printed_assessment_batches;
CREATE POLICY "Teachers read own printed batches" ON public.printed_assessment_batches
  FOR SELECT TO authenticated USING (
    instructor_id=auth.uid() AND public.is_verified()
    OR public.academix_is_active_admin()
  );

DROP POLICY IF EXISTS "Teachers read own printed scans" ON public.printed_assessment_scans;
CREATE POLICY "Teachers read own printed scans" ON public.printed_assessment_scans
  FOR SELECT TO authenticated USING (
    uploaded_by=auth.uid() AND public.is_verified()
    OR EXISTS (
      SELECT 1 FROM public.printed_assessment_batches b
      WHERE b.id=batch_id AND b.instructor_id=auth.uid() AND public.is_verified()
    )
    OR public.academix_is_active_admin()
    OR student_id=auth.uid() AND status='published'
  );

-- Private bucket: object paths always begin with the authenticated user's UUID.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('printed-assessments','printed-assessments',false,15728640,
  ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=15728640,
  allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp','application/pdf'];

DROP POLICY IF EXISTS "Printed assessment owners upload" ON storage.objects;
CREATE POLICY "Printed assessment owners upload" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id='printed-assessments'
    AND (storage.foldername(name))[1]=auth.uid()::text
    AND public.is_verified()
  );

DROP POLICY IF EXISTS "Printed assessment owners read" ON storage.objects;
CREATE POLICY "Printed assessment owners read" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id='printed-assessments'
    AND (
      (storage.foldername(name))[1]=auth.uid()::text
      OR public.academix_is_active_admin()
      OR EXISTS (
        SELECT 1 FROM public.printed_assessment_scans s
        JOIN public.printed_assessment_batches b ON b.id=s.batch_id
        WHERE s.object_path=name AND b.instructor_id=auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.printed_assessment_scans s
        WHERE s.object_path=name AND s.student_id=auth.uid() AND s.status='published'
      )
    )
  );

CREATE OR REPLACE FUNCTION public.academix_teacher_register_signature(p_object_path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id=auth.uid() AND role='teacher'::public.app_role
      AND verified_at IS NOT NULL AND suspended_at IS NULL
  ) THEN RAISE EXCEPTION 'Verified active instructor account required.' USING errcode='42501'; END IF;
  IF p_object_path IS NULL OR p_object_path !~ ('^'||auth.uid()::text||'/signature/[A-Za-z0-9._-]+$') THEN
    RAISE EXCEPTION 'Signature file path is invalid.' USING errcode='22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id='printed-assessments' AND name=p_object_path AND owner_id=auth.uid()::text
  ) THEN RAISE EXCEPTION 'Uploaded signature specimen was not found.' USING errcode='P0002'; END IF;
  UPDATE public.profiles SET registered_signature_path=p_object_path,
    registered_signature_updated_at=clock_timestamp() WHERE id=auth.uid();
  RETURN jsonb_build_object('registered',true,'updated_at',clock_timestamp());
END $$;

CREATE OR REPLACE FUNCTION public.academix_create_printed_assessment_batch(
  p_exam_id uuid,p_sheet_format text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_exam public.exams%rowtype; v_offering public.course_offerings%rowtype;
  v_profile public.profiles%rowtype; v_code text; v_batch uuid;
BEGIN
  SELECT * INTO v_profile FROM public.profiles
  WHERE id=auth.uid() AND role='teacher'::public.app_role
    AND verified_at IS NOT NULL AND suspended_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Verified active instructor account required.' USING errcode='42501'; END IF;
  IF p_sheet_format NOT IN ('question_paper','omr') THEN RAISE EXCEPTION 'Unsupported printed sheet format.' USING errcode='22023'; END IF;
  SELECT * INTO v_exam FROM public.exams WHERE id=p_exam_id AND teacher_id=auth.uid() FOR UPDATE;
  IF NOT FOUND OR v_exam.status<>'published' OR v_exam.course_offering_id IS NULL THEN
    RAISE EXCEPTION 'Choose a published assessment assigned to one of your course offerings.' USING errcode='42501';
  END IF;
  SELECT * INTO v_offering FROM public.course_offerings
  WHERE id=v_exam.course_offering_id AND instructor_id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'The course offering is not assigned to this instructor.' USING errcode='42501'; END IF;
  IF v_profile.registered_signature_path IS NULL OR NOT EXISTS (
    SELECT 1 FROM storage.objects WHERE bucket_id='printed-assessments'
      AND name=v_profile.registered_signature_path AND owner_id=auth.uid()::text
  ) THEN
    RAISE EXCEPTION 'Register a valid private instructor signature specimen before creating printed assessments.' USING errcode='55000';
  END IF;
  IF EXISTS(SELECT 1 FROM public.printed_assessment_batches WHERE exam_id=p_exam_id) THEN
    RAISE EXCEPTION 'A printed assessment batch already exists for this examination.' USING errcode='23505';
  END IF;
  v_code:=upper(encode(gen_random_bytes(16),'hex'));
  INSERT INTO public.printed_assessment_batches(
    exam_id,course_offering_id,instructor_id,instructor_name_snapshot,
    instructor_signature_path_snapshot,sheet_format,authorization_code_hash,authorization_code_hint
  ) VALUES (
    p_exam_id,v_offering.id,auth.uid(),v_profile.full_name,v_profile.registered_signature_path,
    p_sheet_format,encode(digest(v_code,'sha256'),'hex'),right(v_code,4)
  ) RETURNING id INTO v_batch;
  RETURN jsonb_build_object('batch_id',v_batch,'authorization_code',v_code,
    'instructor_name',v_profile.full_name,'sheet_format',p_sheet_format);
END $$;

CREATE OR REPLACE FUNCTION public.academix_register_printed_assessment_scan(
  p_batch_id uuid,p_student_id uuid,p_object_path text,p_authorization_code text,
  p_printed_instructor_name text,p_signature_visually_confirmed boolean,
  p_detected_answers jsonb DEFAULT '{}'::jsonb,p_recognition_report jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_batch public.printed_assessment_batches%rowtype; v_scan uuid;
  v_exam public.exams%rowtype; v_profile public.profiles%rowtype;
BEGIN
  SELECT * INTO v_batch FROM public.printed_assessment_batches
  WHERE id=p_batch_id AND instructor_id=auth.uid() AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active printed assessment not found for this instructor.' USING errcode='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid()
    AND role='teacher'::public.app_role AND verified_at IS NOT NULL AND suspended_at IS NULL) THEN
    RAISE EXCEPTION 'Verified active instructor account required.' USING errcode='42501';
  END IF;
  IF p_authorization_code IS NULL OR encode(digest(upper(trim(p_authorization_code)),'sha256'),'hex')<>v_batch.authorization_code_hash THEN
    RAISE EXCEPTION 'Printed assessment authorization code is invalid.' USING errcode='42501';
  END IF;
  IF lower(regexp_replace(trim(coalesce(p_printed_instructor_name,'')),'\s+',' ','g'))
     <> lower(regexp_replace(trim(v_batch.instructor_name_snapshot),'\s+',' ','g')) THEN
    RAISE EXCEPTION 'The instructor name on the scanned paper does not match the authorized instructor.' USING errcode='42501';
  END IF;
  IF p_signature_visually_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Visually confirm the instructor signature against the registered specimen before processing.' USING errcode='42501';
  END IF;
  IF p_object_path IS NULL OR p_object_path !~ ('^'||auth.uid()::text||'/'||p_batch_id::text||'/[A-Za-z0-9._-]+$') THEN
    RAISE EXCEPTION 'Scan file path is invalid.' USING errcode='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='printed-assessments'
    AND name=p_object_path AND owner_id=auth.uid()::text) THEN
    RAISE EXCEPTION 'Uploaded scan was not found in private storage.' USING errcode='P0002';
  END IF;
  SELECT * INTO v_exam FROM public.exams WHERE id=v_batch.exam_id;
  SELECT * INTO v_profile FROM public.profiles WHERE id=p_student_id AND role='student'::public.app_role
    AND verified_at IS NOT NULL AND suspended_at IS NULL;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.exam_assignments
    WHERE exam_id=v_batch.exam_id AND student_id=p_student_id) THEN
    RAISE EXCEPTION 'The selected student is not an eligible assignee for this assessment.' USING errcode='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.course_offerings o
    WHERE o.id=v_batch.course_offering_id AND o.instructor_id=auth.uid()
      AND v_profile.campus_id=o.campus_id AND v_profile.college_id=o.college_id
      AND v_profile.program_id=o.program_id AND v_profile.year_level=o.year_level
      AND upper(v_profile.block_code)=upper(o.block_code)) THEN
    RAISE EXCEPTION 'The student is outside this instructor’s assigned academic class.' USING errcode='42501';
  END IF;
  INSERT INTO public.printed_assessment_scans(
    batch_id,student_id,object_path,detected_answers,recognition_report,status,
    instructor_name_verified,signature_visually_confirmed,uploaded_by
  ) VALUES (
    p_batch_id,p_student_id,p_object_path,coalesce(p_detected_answers,'{}'::jsonb),
    coalesce(p_recognition_report,'{}'::jsonb),'needs_review',
    v_batch.instructor_name_snapshot,true,auth.uid()
  ) RETURNING id INTO v_scan;
  RETURN jsonb_build_object('scan_id',v_scan,'status','needs_review','student_id',p_student_id);
END $$;

CREATE OR REPLACE FUNCTION public.academix_teacher_auto_grade_printed_scan(p_scan_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_scan public.printed_assessment_scans%rowtype; v_batch public.printed_assessment_batches%rowtype;
  v_q record; v_answer jsonb; v_score numeric(9,2):=0; v_max numeric(9,2):=0;
  v_manual_count integer:=0; v_items jsonb:='[]'::jsonb;
BEGIN
  SELECT * INTO v_scan FROM public.printed_assessment_scans WHERE id=p_scan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scanned assessment not found.' USING errcode='P0002'; END IF;
  SELECT * INTO v_batch FROM public.printed_assessment_batches
    WHERE id=v_scan.batch_id AND instructor_id=auth.uid();
  IF NOT FOUND OR NOT public.is_verified() THEN RAISE EXCEPTION 'Assigned instructor authorization required.' USING errcode='42501'; END IF;
  FOR v_q IN SELECT id,question_type,correct_answer,points,position FROM public.questions
    WHERE exam_id=v_batch.exam_id ORDER BY position LOOP
    v_max:=v_max+v_q.points;
    v_answer:=v_scan.detected_answers->v_q.id::text;
    IF v_q.question_type IN ('multiple_choice','true_false')
       AND v_answer IS NOT NULL AND public.academix_answer_matches(v_q.correct_answer,v_answer,v_q.question_type) THEN
      v_score:=v_score+v_q.points;
      v_items:=v_items||jsonb_build_array(jsonb_build_object('question_id',v_q.id,'score',v_q.points,'max_points',v_q.points,'method','omr_auto','status','correct'));
    ELSIF v_q.question_type IN ('multiple_choice','true_false') AND v_answer IS NOT NULL THEN
      v_items:=v_items||jsonb_build_array(jsonb_build_object('question_id',v_q.id,'score',0,'max_points',v_q.points,'method','omr_auto','status','incorrect'));
    ELSE
      v_manual_count:=v_manual_count+1;
      v_items:=v_items||jsonb_build_array(jsonb_build_object('question_id',v_q.id,'score',0,'max_points',v_q.points,'method','manual_review','status','needs_review'));
    END IF;
  END LOOP;
  UPDATE public.printed_assessment_scans SET item_scores=v_items,score=v_score,max_score=v_max,
    status='needs_review',graded_by=auth.uid(),graded_at=clock_timestamp()
  WHERE id=p_scan_id;
  RETURN jsonb_build_object('scan_id',p_scan_id,'auto_score',v_score,'max_score',v_max,
    'manual_review_questions',v_manual_count,'status','needs_review');
END $$;

CREATE OR REPLACE FUNCTION public.academix_teacher_save_printed_grading(
  p_scan_id uuid,p_item_scores jsonb,p_feedback text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_scan public.printed_assessment_scans%rowtype; v_batch public.printed_assessment_batches%rowtype;
  v_q record; v_entry jsonb; v_score numeric(9,2):=0; v_max numeric(9,2):=0; v_seen uuid[]:='{}';
BEGIN
  IF jsonb_typeof(p_item_scores)<>'array' THEN RAISE EXCEPTION 'Per-question grading must be a JSON array.' USING errcode='22023'; END IF;
  SELECT * INTO v_scan FROM public.printed_assessment_scans WHERE id=p_scan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scanned assessment not found.' USING errcode='P0002'; END IF;
  SELECT * INTO v_batch FROM public.printed_assessment_batches WHERE id=v_scan.batch_id AND instructor_id=auth.uid();
  IF NOT FOUND OR NOT public.is_verified() THEN RAISE EXCEPTION 'Assigned instructor authorization required.' USING errcode='42501'; END IF;
  FOR v_q IN SELECT id,points FROM public.questions WHERE exam_id=v_batch.exam_id LOOP
    v_max:=v_max+v_q.points;
    SELECT value INTO v_entry FROM jsonb_array_elements(p_item_scores) WHERE value->>'question_id'=v_q.id::text LIMIT 1;
    IF v_entry IS NULL THEN RAISE EXCEPTION 'A score is required for every question.' USING errcode='22023'; END IF;
    IF coalesce((v_entry->>'score')::numeric,-1)<0 OR (v_entry->>'score')::numeric>v_q.points THEN
      RAISE EXCEPTION 'Each question score must be between zero and its point value.' USING errcode='22023';
    END IF;
    v_score:=v_score+(v_entry->>'score')::numeric;
    v_seen:=array_append(v_seen,v_q.id);
  END LOOP;
  IF jsonb_array_length(p_item_scores)<>cardinality(v_seen) THEN
    RAISE EXCEPTION 'Unknown or duplicate question score entries were supplied.' USING errcode='22023';
  END IF;
  UPDATE public.printed_assessment_scans SET item_scores=p_item_scores,score=v_score,max_score=v_max,
    feedback=left(coalesce(p_feedback,''),2000),status='graded',graded_by=auth.uid(),
    graded_at=clock_timestamp() WHERE id=p_scan_id;
  RETURN jsonb_build_object('scan_id',p_scan_id,'score',v_score,'max_score',v_max,'status','graded');
END $$;

CREATE OR REPLACE FUNCTION public.academix_teacher_publish_printed_grade(p_scan_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_scan public.printed_assessment_scans%rowtype; v_batch public.printed_assessment_batches%rowtype;
  v_submission uuid; v_existing public.submissions%rowtype;
BEGIN
  SELECT * INTO v_scan FROM public.printed_assessment_scans WHERE id=p_scan_id FOR UPDATE;
  IF NOT FOUND OR v_scan.status<>'graded' OR v_scan.score IS NULL OR v_scan.max_score IS NULL THEN
    RAISE EXCEPTION 'Complete and save the per-question grading before approval.' USING errcode='55000';
  END IF;
  SELECT * INTO v_batch FROM public.printed_assessment_batches
    WHERE id=v_scan.batch_id AND instructor_id=auth.uid() AND active;
  IF NOT FOUND OR v_scan.graded_by<>auth.uid() OR NOT public.is_verified() THEN
    RAISE EXCEPTION 'Only the assigned instructor who graded this paper may approve it.' USING errcode='42501';
  END IF;
  SELECT * INTO v_existing FROM public.submissions
    WHERE exam_id=v_batch.exam_id AND student_id=v_scan.student_id FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'This student already has an online or printed attempt for this assessment. Resolve the existing attempt before publishing another grade.' USING errcode='23505';
  END IF;
  INSERT INTO public.submissions(exam_id,student_id,status,answers,score,max_score,submitted_at,graded_at)
  VALUES(v_batch.exam_id,v_scan.student_id,'graded',v_scan.detected_answers,v_scan.score,v_scan.max_score,
    clock_timestamp(),clock_timestamp()) RETURNING id INTO v_submission;
  INSERT INTO public.grades(submission_id,student_id,exam_id,score,max_score,feedback,graded_by)
  VALUES(v_submission,v_scan.student_id,v_batch.exam_id,v_scan.score,v_scan.max_score,v_scan.feedback,auth.uid());
  UPDATE public.printed_assessment_scans SET status='published',approved_by=auth.uid(),
    approved_at=clock_timestamp(),submission_id=v_submission WHERE id=p_scan_id;
  RETURN jsonb_build_object('scan_id',p_scan_id,'submission_id',v_submission,
    'score',v_scan.score,'max_score',v_scan.max_score,'status','published');
END $$;

CREATE OR REPLACE FUNCTION public.academix_student_printed_assessment_results()
RETURNS TABLE(scan_id uuid,exam_title text,score numeric,max_score numeric,feedback text,published_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT s.id,e.title,s.score,s.max_score,s.feedback,s.approved_at
  FROM public.printed_assessment_scans s
  JOIN public.printed_assessment_batches b ON b.id=s.batch_id
  JOIN public.exams e ON e.id=b.exam_id
  WHERE s.student_id=auth.uid() AND s.status='published'
    AND public.is_verified()
  ORDER BY s.approved_at DESC
$$;

CREATE OR REPLACE FUNCTION public.academix_admin_printed_assessment_overview()
RETURNS TABLE(batch_count bigint,scan_count bigint,awaiting_review bigint,graded_pending_approval bigint,published_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $
BEGIN
  IF NOT public.academix_is_active_admin() THEN
    RAISE EXCEPTION 'Administrator access required.' USING errcode='42501';
  END IF;
  RETURN QUERY
  SELECT
    (SELECT count(*) FROM public.printed_assessment_batches),
    (SELECT count(*) FROM public.printed_assessment_scans),
    (SELECT count(*) FROM public.printed_assessment_scans WHERE status IN ('uploaded','needs_review')),
    (SELECT count(*) FROM public.printed_assessment_scans WHERE status='graded'),
    (SELECT count(*) FROM public.printed_assessment_scans WHERE status='published');
END $;

REVOKE ALL ON FUNCTION public.academix_teacher_register_signature(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.academix_create_printed_assessment_batch(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.academix_register_printed_assessment_scan(uuid,uuid,text,text,text,boolean,jsonb,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.academix_teacher_auto_grade_printed_scan(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.academix_teacher_save_printed_grading(uuid,jsonb,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.academix_teacher_publish_printed_grade(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.academix_student_printed_assessment_results() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.academix_admin_printed_assessment_overview() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.academix_teacher_register_signature(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.academix_create_printed_assessment_batch(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.academix_register_printed_assessment_scan(uuid,uuid,text,text,text,boolean,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.academix_teacher_auto_grade_printed_scan(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.academix_teacher_save_printed_grading(uuid,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.academix_teacher_publish_printed_grade(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.academix_student_printed_assessment_results() TO authenticated;
GRANT EXECUTE ON FUNCTION public.academix_admin_printed_assessment_overview() TO authenticated;

COMMIT;
