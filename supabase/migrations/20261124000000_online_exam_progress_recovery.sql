-- BUOC AcademiX: durable online exam progress, safe resume, and timeout finalization.
-- Additive RPC-only change. Does not alter connection strings, credentials, existing
-- grants on unrelated tables, RLS policies, or Supabase project configuration.

BEGIN;

CREATE OR REPLACE FUNCTION public.save_exam_progress(
  p_submission_id uuid,
  p_answers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_user uuid:=auth.uid();
  v_submission public.submissions%rowtype;
  v_exam public.exams%rowtype;
  v_saved_at timestamptz:=clock_timestamp();
  v_deadline timestamptz;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING errcode='28000'; END IF;
  IF p_answers IS NULL OR jsonb_typeof(p_answers)<>'object' THEN
    RAISE EXCEPTION 'Answers must be a JSON object.' USING errcode='22023';
  END IF;

  SELECT * INTO v_submission FROM public.submissions
  WHERE id=p_submission_id FOR UPDATE;
  IF NOT FOUND OR v_submission.student_id<>v_user THEN
    RAISE EXCEPTION 'Active exam attempt not found.' USING errcode='42501';
  END IF;
  IF v_submission.status<>'in_progress' THEN
    RAISE EXCEPTION 'This attempt is no longer accepting answers.' USING errcode='55000';
  END IF;

  SELECT * INTO v_exam FROM public.exams
  WHERE id=v_submission.exam_id AND status='published';
  IF NOT FOUND THEN RAISE EXCEPTION 'This assessment is not available.' USING errcode='55000'; END IF;
  v_deadline:=v_submission.started_at+make_interval(mins=>v_exam.duration_minutes);
  -- Small transit allowance only; the finalizer never accepts client answers after deadline.
  IF v_saved_at>v_deadline+interval '3 seconds' THEN
    RAISE EXCEPTION 'The exam time limit has elapsed; saved answers will be submitted.' USING errcode='55000';
  END IF;
  IF NOT public.is_verified() OR NOT EXISTS(
    SELECT 1 FROM public.profiles p
    WHERE p.id=v_user AND p.role='student'::public.app_role
      AND p.verified_at IS NOT NULL AND p.suspended_at IS NULL
  ) THEN RAISE EXCEPTION 'Verified student access is required.' USING errcode='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.exam_assignments a WHERE a.exam_id=v_submission.exam_id AND a.student_id=v_user) THEN
    RAISE EXCEPTION 'You are not assigned to this assessment.' USING errcode='42501';
  END IF;
  IF v_exam.course_offering_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.course_offerings o JOIN public.profiles p ON p.id=v_user
    WHERE o.id=v_exam.course_offering_id
      AND p.campus_id=o.campus_id AND p.college_id=o.college_id
      AND p.program_id=o.program_id AND p.year_level=o.year_level
      AND upper(p.block_code)=upper(o.block_code)
  ) THEN RAISE EXCEPTION 'Your student account is not assigned to this academic class.' USING errcode='42501'; END IF;

  UPDATE public.submissions
  SET answers=p_answers
  WHERE id=p_submission_id;

  RETURN jsonb_build_object('submission_id',p_submission_id,'saved_at',v_saved_at,'status','saved');
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_exam(p_submission_id uuid,p_answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_user uuid:=auth.uid();
  v_submission public.submissions%rowtype;
  v_exam public.exams%rowtype;
  v_question record;
  v_score numeric(9,2):=0;
  v_max_score numeric(9,2):=0;
  v_answer jsonb;
  v_answers jsonb;
  v_now timestamptz:=clock_timestamp();
  v_deadline timestamptz;
  v_manual boolean:=false;
  v_status public.submission_status;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING errcode='28000'; END IF;
  IF p_answers IS NULL OR jsonb_typeof(p_answers)<>'object' THEN
    RAISE EXCEPTION 'Answers must be a JSON object.' USING errcode='22023';
  END IF;
  SELECT * INTO v_submission FROM public.submissions WHERE id=p_submission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Submission not found.' USING errcode='P0002'; END IF;
  IF v_submission.student_id<>v_user THEN RAISE EXCEPTION 'You cannot submit another student’s attempt.' USING errcode='42501'; END IF;
  IF v_submission.status<>'in_progress' THEN RAISE EXCEPTION 'This attempt has already been submitted.' USING errcode='55000'; END IF;
  SELECT * INTO v_exam FROM public.exams WHERE id=v_submission.exam_id AND status='published';
  IF NOT FOUND THEN RAISE EXCEPTION 'This assessment is not available.' USING errcode='55000'; END IF;
  IF NOT public.is_verified() THEN RAISE EXCEPTION 'Institutional verification is required.' USING errcode='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.exam_assignments a WHERE a.exam_id=v_submission.exam_id AND a.student_id=v_user) THEN
    RAISE EXCEPTION 'You are not assigned to this assessment.' USING errcode='42501';
  END IF;
  IF v_exam.course_offering_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.course_offerings o JOIN public.profiles p ON p.id=v_user
    WHERE o.id=v_exam.course_offering_id AND p.role='student'::public.app_role
      AND p.verified_at IS NOT NULL AND p.suspended_at IS NULL
      AND p.campus_id=o.campus_id AND p.college_id=o.college_id
      AND p.program_id=o.program_id AND p.year_level=o.year_level
      AND upper(p.block_code)=upper(o.block_code)
  ) THEN RAISE EXCEPTION 'Your student account is not assigned to this academic class.' USING errcode='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.questions q WHERE q.exam_id=v_submission.exam_id) THEN
    RAISE EXCEPTION 'This assessment has no questions.' USING errcode='55000';
  END IF;

  v_deadline:=v_submission.started_at+make_interval(mins=>v_exam.duration_minutes);
  -- Before the deadline, combine the final client payload with the durable autosave.
  -- After the deadline, ignore client payload completely and grade only server-saved answers.
  IF v_now<=v_deadline THEN
    v_answers:=coalesce(v_submission.answers,'{}'::jsonb)||p_answers;
  ELSE
    v_answers:=coalesce(v_submission.answers,'{}'::jsonb);
  END IF;

  FOR v_question IN
    SELECT q.id,q.correct_answer,q.points,q.question_type
    FROM public.questions q WHERE q.exam_id=v_submission.exam_id ORDER BY q.position
  LOOP
    v_max_score:=v_max_score+v_question.points;
    v_answer:=v_answers->v_question.id::text;
    IF v_question.question_type='essay' THEN
      IF v_answer IS NOT NULL AND nullif(btrim(v_answer #>> '{}'),'') IS NOT NULL THEN v_manual:=true; END IF;
    ELSIF public.academix_answer_matches(v_question.correct_answer,v_answer,v_question.question_type) THEN
      v_score:=v_score+v_question.points;
    END IF;
  END LOOP;

  v_status:=CASE WHEN v_manual THEN 'submitted'::public.submission_status ELSE 'graded'::public.submission_status END;
  UPDATE public.submissions
  SET answers=v_answers,score=v_score,max_score=v_max_score,status=v_status,
      submitted_at=v_now,graded_at=CASE WHEN v_manual THEN NULL ELSE v_now END
  WHERE id=p_submission_id;

  IF NOT v_manual THEN
    INSERT INTO public.grades(submission_id,student_id,exam_id,score,max_score,feedback,graded_by,created_at)
    VALUES(p_submission_id,v_user,v_submission.exam_id,v_score,v_max_score,'Automatically graded',NULL,v_now)
    ON CONFLICT(submission_id) DO UPDATE SET score=excluded.score,max_score=excluded.max_score,
      feedback=excluded.feedback,graded_by=NULL,created_at=excluded.created_at;
  END IF;

  RETURN jsonb_build_object(
    'submission_id',p_submission_id,'status',v_status,'score',v_score,
    'max_score',v_max_score,'submitted_at',v_now,'requires_manual_grading',v_manual,
    'timed_out',v_now>v_deadline
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_exam_progress(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_exam_progress(uuid,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.submit_exam(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_exam(uuid,jsonb) TO authenticated;

COMMIT;
