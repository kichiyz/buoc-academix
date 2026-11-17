-- Phase 9: an instructor-approved authorized paper result supersedes an online attempt.
-- Keep the existing submission identity so assessment history remains a single attempt.
BEGIN;

CREATE OR REPLACE FUNCTION public.academix_teacher_publish_printed_grade(p_scan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_scan public.printed_assessment_scans%rowtype;
  v_batch public.printed_assessment_batches%rowtype;
  v_existing public.submissions%rowtype;
  v_submission uuid;
  v_grade_rows integer:=0;
BEGIN
  SELECT * INTO v_scan
  FROM public.printed_assessment_scans
  WHERE id=p_scan_id
  FOR UPDATE;

  IF NOT FOUND OR v_scan.status<>'graded'
     OR v_scan.score IS NULL OR v_scan.max_score IS NULL THEN
    RAISE EXCEPTION 'Complete and save the per-question grading before approval.'
      USING errcode='55000';
  END IF;

  SELECT * INTO v_batch
  FROM public.printed_assessment_batches
  WHERE id=v_scan.batch_id
    AND instructor_id=auth.uid()
    AND active;

  IF NOT FOUND OR v_scan.graded_by<>auth.uid() OR NOT public.is_verified() THEN
    RAISE EXCEPTION 'Only the assigned instructor who graded this paper may approve it.'
      USING errcode='42501';
  END IF;

  -- Lock and reuse the student's online submission when one exists. The approved
  -- paper score is authoritative for this assessment, regardless of the online score.
  SELECT * INTO v_existing
  FROM public.submissions
  WHERE exam_id=v_batch.exam_id
    AND student_id=v_scan.student_id
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.submissions
    SET status='graded',
        answers=coalesce(v_scan.detected_answers,'{}'::jsonb),
        score=v_scan.score,
        max_score=v_scan.max_score,
        submitted_at=clock_timestamp(),
        graded_at=clock_timestamp()
    WHERE id=v_existing.id
    RETURNING id INTO v_submission;
  ELSE
    INSERT INTO public.submissions(
      exam_id,student_id,status,answers,score,max_score,submitted_at,graded_at
    )
    VALUES(
      v_batch.exam_id,v_scan.student_id,'graded',
      coalesce(v_scan.detected_answers,'{}'::jsonb),
      v_scan.score,v_scan.max_score,clock_timestamp(),clock_timestamp()
    )
    RETURNING id INTO v_submission;
  END IF;

  -- Update the gradebook row attached to the submission; create it only if absent.
  UPDATE public.grades
  SET student_id=v_scan.student_id,
      exam_id=v_batch.exam_id,
      score=v_scan.score,
      max_score=v_scan.max_score,
      feedback=v_scan.feedback,
      graded_by=auth.uid()
  WHERE submission_id=v_submission;

  GET DIAGNOSTICS v_grade_rows=ROW_COUNT;

  IF v_grade_rows=0 THEN
    INSERT INTO public.grades(
      submission_id,student_id,exam_id,score,max_score,feedback,graded_by
    )
    VALUES(
      v_submission,v_scan.student_id,v_batch.exam_id,
      v_scan.score,v_scan.max_score,v_scan.feedback,auth.uid()
    );
  END IF;

  UPDATE public.printed_assessment_scans
  SET status='published',
      approved_by=auth.uid(),
      approved_at=clock_timestamp(),
      submission_id=v_submission
  WHERE id=p_scan_id;

  RETURN jsonb_build_object(
    'scan_id',p_scan_id,
    'submission_id',v_submission,
    'score',v_scan.score,
    'max_score',v_scan.max_score,
    'status','published',
    'replaced_existing_online_attempt',v_existing.id IS NOT NULL
  );
END;
$$;

COMMIT;
