BEGIN;

-- Weighted course grading, course-linked assessments, safe deletion, and period replacement.
-- Midterm = 20%, Final = 25%, all other graded coursework = 55%.
-- Coursework assessment weights are relative within the 55% coursework component.

ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS course_offering_id uuid
    REFERENCES public.course_offerings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS exams_offering_category_status_idx
  ON public.exams(course_offering_id, assessment_category, status);

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

  INSERT INTO public.exam_assignments(exam_id, student_id)
  SELECT p_exam_id, e.student_id
  FROM public.course_enrollments e
  WHERE e.offering_id = v_exam.course_offering_id
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

CREATE OR REPLACE FUNCTION public.academix_teacher_delete_exam(p_exam_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_exam public.exams%rowtype;
  v_submission_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_verified()
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

  IF EXISTS (
    SELECT 1 FROM public.submissions
    WHERE exam_id = p_exam_id AND status = 'in_progress'
  ) THEN
    RAISE EXCEPTION 'This assessment has an active student attempt. Wait until all attempts are submitted before deleting it.'
      USING errcode = '55000';
  END IF;

  SELECT count(*) INTO v_submission_count
  FROM public.submissions WHERE exam_id = p_exam_id;

  DELETE FROM public.exams WHERE id = p_exam_id;

  RETURN jsonb_build_object(
    'deleted_exam_id', p_exam_id,
    'deleted_submission_count', v_submission_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.academix_teacher_delete_exam(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.academix_teacher_delete_exam(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.academix_teacher_assessment_grade_summary(p_offering_id uuid)
RETURNS TABLE(
  enrollment_id uuid,
  student_id uuid,
  midterm_percentage numeric,
  midterm_gwa numeric,
  final_percentage numeric,
  final_gwa numeric,
  coursework_percentage numeric,
  computed_final_percentage numeric,
  computed_final_gwa numeric,
  missing_coursework_assessments integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_verified()
     OR (SELECT role FROM public.profiles WHERE id = auth.uid())
        IS DISTINCT FROM 'teacher'::public.app_role THEN
    RAISE EXCEPTION 'Verified Teacher account required.' USING errcode = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.course_offerings o
    WHERE o.id = p_offering_id AND o.instructor_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'This course offering is not assigned to your account.' USING errcode = '42501';
  END IF;

  RETURN QUERY
  WITH offering AS (
    SELECT o.id, o.term_id FROM public.course_offerings o WHERE o.id = p_offering_id
  ),
  active_exams AS (
    SELECT e.id, e.assessment_category, COALESCE(e.grade_weight_percent, 1)::numeric AS weight
    FROM public.exams e
    WHERE e.course_offering_id = p_offering_id
      AND e.status = 'published'
  ),
  latest_attempt AS (
    SELECT DISTINCT ON (s.exam_id, s.student_id)
      s.exam_id, s.student_id,
      CASE WHEN s.max_score > 0 THEN (s.score / s.max_score) * 100 ELSE NULL END AS percentage
    FROM public.submissions s
    JOIN active_exams e ON e.id = s.exam_id
    WHERE s.status = 'graded' AND s.score IS NOT NULL AND s.max_score > 0
    ORDER BY s.exam_id, s.student_id, s.attempt_number DESC, s.submitted_at DESC
  ),
  by_student AS (
    SELECT
      ce.id AS enrollment_id,
      ce.student_id,
      MAX(la.percentage) FILTER (WHERE ae.assessment_category = 'midterm') AS midterm_pct,
      MAX(la.percentage) FILTER (WHERE ae.assessment_category = 'final') AS final_pct,
      CASE
        WHEN COUNT(*) FILTER (
          WHERE ae.assessment_category NOT IN ('midterm','final')
        ) > 0
         AND COUNT(la.percentage) FILTER (
          WHERE ae.assessment_category NOT IN ('midterm','final')
        ) = COUNT(*) FILTER (
          WHERE ae.assessment_category NOT IN ('midterm','final')
        )
         AND SUM(ae.weight) FILTER (
          WHERE ae.assessment_category NOT IN ('midterm','final')
        ) > 0
        THEN SUM(la.percentage * ae.weight) FILTER (
          WHERE ae.assessment_category NOT IN ('midterm','final')
        ) / NULLIF(SUM(ae.weight) FILTER (
          WHERE ae.assessment_category NOT IN ('midterm','final')
        ), 0)
        ELSE NULL
      END AS coursework_pct,
      COUNT(*) FILTER (
        WHERE ae.assessment_category NOT IN ('midterm','final')
          AND la.percentage IS NULL
      )::integer AS missing_coursework
    FROM public.course_enrollments ce
    LEFT JOIN active_exams ae ON true
    LEFT JOIN latest_attempt la
      ON la.exam_id = ae.id AND la.student_id = ce.student_id
    WHERE ce.offering_id = p_offering_id
    GROUP BY ce.id, ce.student_id
  ),
  calculated AS (
    SELECT
      b.*,
      CASE
        WHEN b.midterm_pct IS NOT NULL
         AND b.final_pct IS NOT NULL
         AND b.coursework_pct IS NOT NULL
         AND b.missing_coursework = 0
        THEN ROUND(b.midterm_pct * 0.20 + b.final_pct * 0.25 + b.coursework_pct * 0.55, 2)
        ELSE NULL
      END AS final_pct
    FROM by_student b
  )
  SELECT
    c.enrollment_id,
    c.student_id,
    ROUND(c.midterm_pct,2),
    mb.gwa_value,
    ROUND(c.final_pct,2),
    fb.gwa_value,
    ROUND(c.coursework_pct,2),
    c.final_pct,
    final_band.gwa_value,
    c.missing_coursework
  FROM calculated c
  CROSS JOIN offering o
  LEFT JOIN LATERAL (
    SELECT b.gwa_value FROM public.term_grade_bands b
    WHERE b.term_id = o.term_id AND c.midterm_pct BETWEEN b.min_percentage AND b.max_percentage
    ORDER BY b.min_percentage DESC LIMIT 1
  ) mb ON true
  LEFT JOIN LATERAL (
    SELECT b.gwa_value FROM public.term_grade_bands b
    WHERE b.term_id = o.term_id AND c.final_pct BETWEEN b.min_percentage AND b.max_percentage
    ORDER BY b.min_percentage DESC LIMIT 1
  ) fb ON true
  LEFT JOIN LATERAL (
    SELECT b.gwa_value FROM public.term_grade_bands b
    WHERE b.term_id = o.term_id AND c.final_pct BETWEEN b.min_percentage AND b.max_percentage
    ORDER BY b.min_percentage DESC LIMIT 1
  ) final_band ON true
  ORDER BY c.student_id;
END;
$$;

REVOKE ALL ON FUNCTION public.academix_teacher_assessment_grade_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.academix_teacher_assessment_grade_summary(uuid) TO authenticated;

COMMENT ON COLUMN public.exams.course_offering_id IS
  'Course offering associated with this assessment; required for the weighted course grade workflow.';
COMMENT ON FUNCTION public.academix_teacher_assessment_grade_summary(uuid) IS
  'Returns Midterm (20%), Final (25%), and weighted coursework (55%) scores plus transmuted GWA values for each enrolled student.';

COMMIT;
