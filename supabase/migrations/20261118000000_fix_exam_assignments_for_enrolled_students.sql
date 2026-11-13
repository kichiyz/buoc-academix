BEGIN;

-- Course enrollments are the authoritative class-membership records.
-- The previous publisher also compared profile campus/college/program/year/block
-- fields, but academix_admin_enroll_student() does not populate those profile
-- fields. That extra comparison silently left properly enrolled students
-- without exam_assignments, causing get_exam_questions() to return zero rows.

CREATE OR REPLACE FUNCTION public.academix_teacher_publish_course_assessment(p_exam_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_exam public.exams%rowtype;
  v_archived integer := 0;
  v_assigned integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_verified()
     OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND suspended_at IS NOT NULL)
     OR (SELECT role FROM public.profiles WHERE id = auth.uid())
        IS DISTINCT FROM 'teacher'::public.app_role THEN
    RAISE EXCEPTION 'Verified Teacher account required.' USING errcode = '42501';
  END IF;

  SELECT * INTO v_exam
  FROM public.exams
  WHERE id = p_exam_id AND teacher_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assessment not found or not owned by this teacher.' USING errcode = '42501';
  END IF;

  IF v_exam.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft assessment can be published.' USING errcode = '55000';
  END IF;

  IF v_exam.course_offering_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.course_offerings o
    WHERE o.id = v_exam.course_offering_id AND o.instructor_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Select one of your assigned course offerings before publishing.' USING errcode = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.questions WHERE exam_id = p_exam_id) THEN
    RAISE EXCEPTION 'Add at least one question before publishing.' USING errcode = '23514';
  END IF;

  IF v_exam.assessment_category = 'midterm' THEN
    UPDATE public.exams SET grade_weight_percent = 20 WHERE id = p_exam_id;
  ELSIF v_exam.assessment_category = 'final' THEN
    UPDATE public.exams SET grade_weight_percent = 25 WHERE id = p_exam_id;
  ELSIF COALESCE(v_exam.grade_weight_percent, 0) <= 0 THEN
    RAISE EXCEPTION 'Coursework assessments need a relative weight greater than zero.' USING errcode = '23514';
  END IF;

  IF v_exam.assessment_category IN ('midterm','final') THEN
    UPDATE public.exams
    SET status = 'archived'
    WHERE course_offering_id = v_exam.course_offering_id
      AND assessment_category = v_exam.assessment_category
      AND status = 'published'
      AND id <> p_exam_id
      AND teacher_id = auth.uid();
    GET DIAGNOSTICS v_archived = ROW_COUNT;
  END IF;

  -- The enrollment row already represents an administrator-approved
  -- assignment to this exact offering. Do not require duplicated profile
  -- placement fields to match the offering a second time.
  INSERT INTO public.exam_assignments(exam_id, student_id)
  SELECT p_exam_id, e.student_id
  FROM public.course_enrollments e
  JOIN public.profiles student ON student.id = e.student_id
  WHERE e.offering_id = v_exam.course_offering_id
    AND student.role = 'student'::public.app_role
    AND student.verified_at IS NOT NULL
    AND student.suspended_at IS NULL
  ON CONFLICT (exam_id, student_id) DO NOTHING;
  GET DIAGNOSTICS v_assigned = ROW_COUNT;

  UPDATE public.exams
  SET status = 'published', published_at = now()
  WHERE id = p_exam_id;

  RETURN jsonb_build_object(
    'exam_id', p_exam_id,
    'archived_replacements', v_archived,
    'assigned_students', v_assigned
  );
END;
$$;

REVOKE ALL ON FUNCTION public.academix_teacher_publish_course_assessment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.academix_teacher_publish_course_assessment(uuid) TO authenticated;

-- Repair exams already published before this migration. This backfills only
-- active, verified student enrollments for each exam's exact course offering.
INSERT INTO public.exam_assignments(exam_id, student_id)
SELECT exam.id, enrollment.student_id
FROM public.exams exam
JOIN public.course_enrollments enrollment
  ON enrollment.offering_id = exam.course_offering_id
JOIN public.profiles student
  ON student.id = enrollment.student_id
WHERE exam.status = 'published'
  AND exam.course_offering_id IS NOT NULL
  AND student.role = 'student'::public.app_role
  AND student.verified_at IS NOT NULL
  AND student.suspended_at IS NULL
ON CONFLICT (exam_id, student_id) DO NOTHING;

COMMIT;
