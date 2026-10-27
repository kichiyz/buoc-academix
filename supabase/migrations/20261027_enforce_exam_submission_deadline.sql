-- BUOC AcademiX security hardening: enforce the exam deadline in the grading RPC.
-- Apply this migration in Supabase SQL Editor only after reviewing and testing it.
-- A short 15-second submission grace accommodates normal browser/network scheduling
-- when the client timer reaches zero. The browser timer is not the security boundary.
-- NOTE: answers are currently sent only at final submission; this migration rejects
-- late requests rather than silently grading answers submitted after the deadline.

CREATE OR REPLACE FUNCTION public.submit_exam(p_submission_id uuid, p_answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_submission public.submissions%ROWTYPE;
  v_exam public.exams%ROWTYPE;
  v_question record;
  v_score numeric(9,2) := 0;
  v_max_score numeric(9,2) := 0;
  v_answer jsonb;
  v_now timestamptz := clock_timestamp();
  v_deadline timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
  END IF;

  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'object' THEN
    RAISE EXCEPTION 'Answers must be a JSON object.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_submission
  FROM public.submissions
  WHERE id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submission not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_submission.student_id <> v_user_id THEN
    RAISE EXCEPTION 'You cannot submit another student’s attempt.' USING ERRCODE = '42501';
  END IF;

  IF v_submission.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This attempt has already been submitted.' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_exam
  FROM public.exams
  WHERE id = v_submission.exam_id;

  IF NOT FOUND OR v_exam.status <> 'published' THEN
    RAISE EXCEPTION 'This assessment is not available.' USING ERRCODE = '55000';
  END IF;

  -- Deadline is computed from the server-recorded attempt start and exam duration.
  v_deadline := v_submission.started_at
                + make_interval(mins => v_exam.duration_minutes);

  IF v_now > v_deadline + interval '15 seconds' THEN
    RAISE EXCEPTION 'The exam time limit has elapsed. This attempt can no longer be submitted.' USING ERRCODE = '55000';
  END IF;

  IF NOT public.is_verified() THEN
    RAISE EXCEPTION 'Institutional verification is required.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.exam_assignments a
    WHERE a.exam_id = v_submission.exam_id
      AND a.student_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'You are not assigned to this assessment.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.questions q
    WHERE q.exam_id = v_submission.exam_id
  ) THEN
    RAISE EXCEPTION 'This assessment has no questions.' USING ERRCODE = '55000';
  END IF;

  FOR v_question IN
    SELECT q.id, q.correct_answer, q.points
    FROM public.questions q
    WHERE q.exam_id = v_submission.exam_id
    ORDER BY q.position
  LOOP
    v_max_score := v_max_score + v_question.points;
    v_answer := p_answers -> v_question.id::text;
    IF v_answer IS NOT NULL AND v_answer = v_question.correct_answer THEN
      v_score := v_score + v_question.points;
    END IF;
  END LOOP;

  UPDATE public.submissions
  SET answers = p_answers,
      score = v_score,
      max_score = v_max_score,
      status = 'graded',
      submitted_at = v_now,
      graded_at = v_now
  WHERE id = p_submission_id;

  INSERT INTO public.grades (
    submission_id, student_id, exam_id, score, max_score,
    feedback, graded_by, created_at
  ) VALUES (
    p_submission_id, v_user_id, v_submission.exam_id, v_score, v_max_score,
    'Automatically graded', NULL, v_now
  )
  ON CONFLICT (submission_id) DO UPDATE
    SET score = EXCLUDED.score,
        max_score = EXCLUDED.max_score,
        feedback = EXCLUDED.feedback,
        graded_by = NULL,
        created_at = EXCLUDED.created_at;

  RETURN jsonb_build_object(
    'submission_id', p_submission_id,
    'status', 'graded',
    'score', v_score,
    'max_score', v_max_score,
    'submitted_at', v_now
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_exam(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_exam(uuid, jsonb) TO authenticated;
