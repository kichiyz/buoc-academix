-- Cumulative GWA and preliminary BU Latin-honors outlook.
-- Reads all finalized, mapped course grades across recorded academic terms.
-- Does not certify honors: regular load, curriculum compliance, and residence
-- must be checked against the Registrar's official records.

CREATE OR REPLACE FUNCTION public.academix_student_cumulative_gwa()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_gwa numeric;
  v_units numeric;
  v_course_count integer;
  v_term_count integer;
  v_pending integer;
  v_inc integer;
  v_unmapped integer;
  v_disqualifying integer;
  v_courses jsonb;
BEGIN
  IF v_user IS NULL OR NOT public.is_verified()
     OR (SELECT role FROM public.profiles WHERE id = v_user)
        IS DISTINCT FROM 'student'::public.app_role THEN
    RAISE EXCEPTION 'Verified student access required.' USING errcode = '42501';
  END IF;

  WITH enrolled AS (
    SELECT e.id AS enrollment_id, o.term_id, t.academic_year, t.semester,
           c.course_code, c.course_title, c.units,
           COALESCE(s.outcome, 'active') AS outcome,
           fg.percentage,
           band.gwa_value,
           band.label AS band_label
    FROM public.course_enrollments e
    JOIN public.course_offerings o ON o.id = e.offering_id
    JOIN public.academic_terms t ON t.id = o.term_id
    JOIN public.academic_courses c ON c.id = o.course_id
    LEFT JOIN public.course_enrollment_statuses s ON s.enrollment_id = e.id
    LEFT JOIN public.course_final_grades fg ON fg.enrollment_id = e.id
    LEFT JOIN LATERAL (
      SELECT b.gwa_value, b.label
      FROM public.term_grade_bands b
      WHERE b.term_id = o.term_id
        AND fg.percentage BETWEEN b.min_percentage AND b.max_percentage
      ORDER BY b.min_percentage DESC
      LIMIT 1
    ) band ON true
    WHERE e.student_id = v_user
  ),
  counted AS (
    SELECT * FROM enrolled WHERE outcome NOT IN ('drp','inc') AND percentage IS NOT NULL
  )
  SELECT
    SUM(gwa_value * units) / NULLIF(SUM(units), 0),
    SUM(units),
    COUNT(*),
    COUNT(DISTINCT term_id),
    COUNT(*) FILTER (WHERE gwa_value > 3.00),
    jsonb_agg(jsonb_build_object(
      'academic_year', academic_year,
      'semester', semester,
      'course_code', course_code,
      'course_title', course_title,
      'units', units,
      'percentage', percentage,
      'gwa', gwa_value,
      'band', band_label
    ) ORDER BY academic_year, semester, course_code)
  INTO v_gwa, v_units, v_course_count, v_term_count, v_disqualifying, v_courses
  FROM counted;

  WITH enrolled AS (
    SELECT COALESCE(s.outcome, 'active') AS outcome,
           fg.percentage,
           band.gwa_value
    FROM public.course_enrollments e
    JOIN public.course_offerings o ON o.id = e.offering_id
    LEFT JOIN public.course_enrollment_statuses s ON s.enrollment_id = e.id
    LEFT JOIN public.course_final_grades fg ON fg.enrollment_id = e.id
    LEFT JOIN LATERAL (
      SELECT b.gwa_value
      FROM public.term_grade_bands b
      WHERE b.term_id = o.term_id
        AND fg.percentage BETWEEN b.min_percentage AND b.max_percentage
      ORDER BY b.min_percentage DESC
      LIMIT 1
    ) band ON true
    WHERE e.student_id = v_user
  )
  SELECT
    COUNT(*) FILTER (WHERE outcome NOT IN ('drp','inc') AND percentage IS NULL),
    COUNT(*) FILTER (WHERE outcome = 'inc'),
    COUNT(*) FILTER (WHERE outcome NOT IN ('drp','inc') AND percentage IS NOT NULL AND gwa_value IS NULL)
  INTO v_pending, v_inc, v_unmapped
  FROM enrolled;

  IF v_course_count IS NULL OR v_course_count = 0 THEN
    RETURN jsonb_build_object(
      'available', false,
      'reason', 'No finalized course grades are recorded yet. Your cumulative GWA will appear after instructors finalize course grades and administrators configure the grading conversion bands.'
    );
  END IF;

  IF COALESCE(v_unmapped, 0) > 0 THEN
    RETURN jsonb_build_object(
      'available', false,
      'reason', 'Some finalized course grades do not have a grading conversion in their academic term. Ask the administrator to configure the missing grade bands.',
      'unmapped_grades', v_unmapped
    );
  END IF;

  RETURN jsonb_build_object(
    'available', true,
    'gwa', ROUND(v_gwa, 4),
    'total_units', v_units,
    'graded_courses', v_course_count,
    'term_count', v_term_count,
    'pending_courses', COALESCE(v_pending, 0),
    'incomplete_courses', COALESCE(v_inc, 0),
    'disqualifying_grade_count', COALESCE(v_disqualifying, 0),
    'courses', COALESCE(v_courses, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.academix_student_cumulative_gwa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.academix_student_cumulative_gwa() TO authenticated;

COMMENT ON FUNCTION public.academix_student_cumulative_gwa() IS
  'Returns the unit-weighted cumulative GWA to four decimals across all finalized, mapped course grades for the authenticated student, plus provisional BU Latin-honors indicators. Formal honors eligibility remains subject to Registrar verification.';
