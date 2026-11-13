-- Fix teacher class-grade directory ordering after UNION ALL.
-- The UNION result is sorted by its exposed output columns in an outer query.

CREATE OR REPLACE FUNCTION public.academix_teacher_grade_directory(p_offering_id uuid)
RETURNS TABLE(
  grade_id uuid,
  student_id uuid,
  full_name text,
  bu_id text,
  year_level smallint,
  block_code text,
  course_code text,
  course_title text,
  exam_title text,
  score numeric,
  max_score numeric,
  percentage numeric,
  record_type text,
  gwa_value numeric,
  graded_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'teacher'::public.app_role
      AND verified_at IS NOT NULL
      AND suspended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Verified Teacher access required.' USING errcode = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.course_offerings
    WHERE id = p_offering_id
      AND instructor_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'You can only view grades for your assigned course offering.' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT
    combined.grade_id,
    combined.student_id,
    combined.full_name,
    combined.bu_id,
    combined.year_level,
    combined.block_code,
    combined.course_code,
    combined.course_title,
    combined.exam_title,
    combined.score,
    combined.max_score,
    combined.percentage,
    combined.record_type,
    combined.gwa_value,
    combined.graded_at
  FROM (
    SELECT
      g.id AS grade_id,
      p.id AS student_id,
      p.full_name AS full_name,
      p.bu_id AS bu_id,
      p.year_level AS year_level,
      p.block_code AS block_code,
      ac.course_code AS course_code,
      ac.course_title AS course_title,
      e.title AS exam_title,
      g.score AS score,
      g.max_score AS max_score,
      CASE
        WHEN g.max_score > 0 THEN round(g.score / g.max_score * 100, 2)
        ELSE NULL
      END AS percentage,
      'assessment'::text AS record_type,
      band.gwa_value AS gwa_value,
      g.created_at AS graded_at
    FROM public.grades g
    JOIN public.profiles p ON p.id = g.student_id
    JOIN public.exams e ON e.id = g.exam_id
    JOIN public.course_offerings o ON o.id = e.course_offering_id
    JOIN public.academic_courses ac ON ac.id = o.course_id
    LEFT JOIN LATERAL (
      SELECT b.gwa_value
      FROM public.term_grade_bands b
      WHERE b.term_id = o.term_id
        AND g.max_score > 0
        AND (g.score / g.max_score * 100) BETWEEN b.min_percentage AND b.max_percentage
      ORDER BY b.min_percentage DESC
      LIMIT 1
    ) band ON true
    WHERE o.id = p_offering_id
      AND p.campus_id = o.campus_id
      AND p.college_id = o.college_id
      AND p.program_id = o.program_id
      AND p.year_level = o.year_level
      AND upper(p.block_code) = upper(o.block_code)

    UNION ALL

    SELECT
      fg.id AS grade_id,
      p.id AS student_id,
      p.full_name AS full_name,
      p.bu_id AS bu_id,
      p.year_level AS year_level,
      p.block_code AS block_code,
      ac.course_code AS course_code,
      ac.course_title AS course_title,
      'Final course grade'::text AS exam_title,
      fg.percentage AS score,
      100::numeric AS max_score,
      fg.percentage AS percentage,
      'course_final'::text AS record_type,
      band.gwa_value AS gwa_value,
      fg.finalized_at AS graded_at
    FROM public.course_final_grades fg
    JOIN public.course_enrollments ce ON ce.id = fg.enrollment_id
    JOIN public.profiles p ON p.id = ce.student_id
    JOIN public.course_offerings o ON o.id = ce.offering_id
    JOIN public.academic_courses ac ON ac.id = o.course_id
    LEFT JOIN LATERAL (
      SELECT b.gwa_value
      FROM public.term_grade_bands b
      WHERE b.term_id = o.term_id
        AND fg.percentage BETWEEN b.min_percentage AND b.max_percentage
      ORDER BY b.min_percentage DESC
      LIMIT 1
    ) band ON true
    WHERE o.id = p_offering_id
      AND p.campus_id = o.campus_id
      AND p.college_id = o.college_id
      AND p.program_id = o.program_id
      AND p.year_level = o.year_level
      AND upper(p.block_code) = upper(o.block_code)
  ) AS combined
  ORDER BY combined.full_name, combined.graded_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.academix_teacher_grade_directory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.academix_teacher_grade_directory(uuid) TO authenticated;

COMMENT ON FUNCTION public.academix_teacher_grade_directory(uuid) IS
  'Returns grade records only for the authenticated teacher assigned to the requested course offering; assessment and final-grade rows are combined and sorted outside the UNION.';
