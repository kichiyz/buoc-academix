-- Permanently remove one subject from the catalog, all of its class offerings,
-- all enrolled students' course/assessment grades, and linked assessment history.
-- The operation is atomic and administrator-only.

BEGIN;

ALTER TABLE public.admin_audit_log
  DROP CONSTRAINT IF EXISTS admin_audit_log_action_check;

ALTER TABLE public.admin_audit_log
  ADD CONSTRAINT admin_audit_log_action_check CHECK (action IN (
    'role_changed',
    'account_suspended',
    'account_reactivated',
    'account_deleted',
    'verification_changed',
    'teacher_request_approved',
    'teacher_request_rejected',
    'academic_subject_deleted'
  ));

CREATE OR REPLACE FUNCTION public.academix_admin_delete_subject(
  p_course_id uuid,
  p_confirmation text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_course public.academic_courses%ROWTYPE;
  v_offering_count integer := 0;
  v_enrollment_count integer := 0;
  v_exam_count integer := 0;
  v_assessment_grade_count integer := 0;
  v_final_grade_count integer := 0;
BEGIN
  IF NOT public.academix_is_active_admin() THEN
    RAISE EXCEPTION 'Active administrator access required.' USING errcode = '42501';
  END IF;

  IF p_confirmation IS DISTINCT FROM 'DELETE' THEN
    RAISE EXCEPTION 'Explicit DELETE confirmation is required.' USING errcode = '22023';
  END IF;

  SELECT * INTO v_course
  FROM public.academic_courses
  WHERE id = p_course_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected subject no longer exists.' USING errcode = 'P0002';
  END IF;

  SELECT count(*) INTO v_offering_count
  FROM public.course_offerings
  WHERE course_id = p_course_id;

  SELECT count(*) INTO v_enrollment_count
  FROM public.course_enrollments e
  JOIN public.course_offerings o ON o.id = e.offering_id
  WHERE o.course_id = p_course_id;

  SELECT count(*) INTO v_exam_count
  FROM public.exams e
  JOIN public.course_offerings o ON o.id = e.course_offering_id
  WHERE o.course_id = p_course_id;

  SELECT count(*) INTO v_assessment_grade_count
  FROM public.grades g
  JOIN public.exams e ON e.id = g.exam_id
  JOIN public.course_offerings o ON o.id = e.course_offering_id
  WHERE o.course_id = p_course_id;

  SELECT count(*) INTO v_final_grade_count
  FROM public.course_final_grades fg
  JOIN public.course_enrollments ce ON ce.id = fg.enrollment_id
  JOIN public.course_offerings o ON o.id = ce.offering_id
  WHERE o.course_id = p_course_id;

  -- Delete exams first: exams.course_offering_id uses ON DELETE SET NULL,
  -- so relying on offering deletion alone would orphan assessment records.
  -- Exam deletion cascades to questions, assignments, submissions, grades,
  -- retake authorizations, and integrity events through their declared FKs.
  DELETE FROM public.exams e
  USING public.course_offerings o
  WHERE e.course_offering_id = o.id
    AND o.course_id = p_course_id;

  -- Enrollment deletion cascades to course_final_grades and
  -- course_enrollment_statuses. Enrollment rows are scoped to these offerings.
  DELETE FROM public.course_offerings
  WHERE course_id = p_course_id;

  DELETE FROM public.academic_courses
  WHERE id = p_course_id;

  INSERT INTO public.admin_audit_log(
    actor_id, target_user_id, action, outcome, reason, details
  ) VALUES (
    auth.uid(),
    NULL,
    'academic_subject_deleted',
    'success',
    'Administrator permanently deleted an academic subject and its associated records.',
    jsonb_build_object(
      'course_id', p_course_id,
      'course_code', v_course.course_code,
      'course_title', v_course.course_title,
      'offerings_deleted', v_offering_count,
      'enrollments_deleted', v_enrollment_count,
      'exams_deleted', v_exam_count,
      'assessment_grades_deleted', v_assessment_grade_count,
      'final_course_grades_deleted', v_final_grade_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'course_id', p_course_id,
    'course_code', v_course.course_code,
    'course_title', v_course.course_title,
    'offerings_deleted', v_offering_count,
    'enrollments_deleted', v_enrollment_count,
    'exams_deleted', v_exam_count,
    'assessment_grades_deleted', v_assessment_grade_count,
    'final_course_grades_deleted', v_final_grade_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.academix_admin_delete_subject(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.academix_admin_delete_subject(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.academix_admin_delete_subject(uuid, text) IS
  'Administrator-only permanent subject deletion. Removes all class offerings, enrollments, final grades, linked exams and assessment grades, with an audit record.';

COMMIT;
