-- Fix weighted grade summary: distinguish final-exam percentage from the computed course percentage.
-- The prior function reused the output name final_pct in two CTE columns, making
-- references ambiguous and causing the teacher grade-summary RPC to fail.

BEGIN;

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
    SELECT o.id, o.term_id
    FROM public.course_offerings o
    WHERE o.id = p_offering_id
  ),
  active_exams AS (
    SELECT e.id, e.assessment_category,
           COALESCE(e.grade_weight_percent, 1)::numeric AS weight
    FROM public.exams e
    WHERE e.course_offering_id = p_offering_id
      AND e.status = 'published'
  ),
  latest_attempt AS (
    SELECT DISTINCT ON (s.exam_id, s.student_id)
      s.exam_id,
      s.student_id,
      CASE
        WHEN s.max_score > 0 THEN (s.score / s.max_score) * 100
        ELSE NULL
      END AS percentage
    FROM public.submissions s
    JOIN active_exams e ON e.id = s.exam_id
    WHERE s.status = 'graded'
      AND s.score IS NOT NULL
      AND s.max_score > 0
    ORDER BY s.exam_id, s.student_id, s.attempt_number DESC, s.submitted_at DESC
  ),
  by_student AS (
    SELECT
      ce.id AS enrollment_id,
      ce.student_id,
      MAX(la.percentage) FILTER (
        WHERE ae.assessment_category = 'midterm'
      ) AS midterm_pct,
      MAX(la.percentage) FILTER (
        WHERE ae.assessment_category = 'final'
      ) AS final_exam_pct,
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
        THEN
          SUM(la.percentage * ae.weight) FILTER (
            WHERE ae.assessment_category NOT IN ('midterm','final')
          ) / NULLIF(
            SUM(ae.weight) FILTER (
              WHERE ae.assessment_category NOT IN ('midterm','final')
            ), 0
          )
        ELSE NULL
      END AS coursework_pct,
      COUNT(*) FILTER (
        WHERE ae.assessment_category NOT IN ('midterm','final')
          AND la.percentage IS NULL
      )::integer AS missing_coursework
    FROM public.course_enrollments ce
    LEFT JOIN active_exams ae ON true
    LEFT JOIN latest_attempt la
      ON la.exam_id = ae.id
     AND la.student_id = ce.student_id
    WHERE ce.offering_id = p_offering_id
    GROUP BY ce.id, ce.student_id
  ),
  calculated AS (
    SELECT
      b.*,
      CASE
        WHEN b.midterm_pct IS NOT NULL
         AND b.final_exam_pct IS NOT NULL
         AND b.coursework_pct IS NOT NULL
         AND b.missing_coursework = 0
        THEN ROUND(
          b.midterm_pct * 0.20
          + b.final_exam_pct * 0.25
          + b.coursework_pct * 0.55,
          2
        )
        ELSE NULL
      END AS computed_final_pct
    FROM by_student b
  )
  SELECT
    c.enrollment_id,
    c.student_id,
    ROUND(c.midterm_pct, 2),
    mb.gwa_value,
    ROUND(c.final_exam_pct, 2),
    fb.gwa_value,
    ROUND(c.coursework_pct, 2),
    c.computed_final_pct,
    final_band.gwa_value,
    c.missing_coursework
  FROM calculated c
  CROSS JOIN offering o
  LEFT JOIN LATERAL (
    SELECT b.gwa_value
    FROM public.term_grade_bands b
    WHERE b.term_id = o.term_id
      AND c.midterm_pct BETWEEN b.min_percentage AND b.max_percentage
    ORDER BY b.min_percentage DESC
    LIMIT 1
  ) mb ON true
  LEFT JOIN LATERAL (
    SELECT b.gwa_value
    FROM public.term_grade_bands b
    WHERE b.term_id = o.term_id
      AND c.final_exam_pct BETWEEN b.min_percentage AND b.max_percentage
    ORDER BY b.min_percentage DESC
    LIMIT 1
  ) fb ON true
  LEFT JOIN LATERAL (
    SELECT b.gwa_value
    FROM public.term_grade_bands b
    WHERE b.term_id = o.term_id
      AND c.computed_final_pct BETWEEN b.min_percentage AND b.max_percentage
    ORDER BY b.min_percentage DESC
    LIMIT 1
  ) final_band ON true
  ORDER BY c.student_id;
END;
$$;

REVOKE ALL ON FUNCTION public.academix_teacher_assessment_grade_summary(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.academix_teacher_assessment_grade_summary(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.academix_teacher_assessment_grade_summary(uuid) IS
  'Returns Midterm (20%), Final (25%), and weighted coursework (55%) percentages and configured GWA conversions for each enrolled student.';

COMMIT;
