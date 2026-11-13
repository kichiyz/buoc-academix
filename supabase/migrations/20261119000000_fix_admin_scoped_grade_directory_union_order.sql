-- Fix Admin Scoped Records grade directory ordering after UNION ALL.
-- PostgreSQL requires the final ORDER BY for a UNION result to reference
-- output columns. Wrap both grade sources and sort the projected result.

BEGIN;

DROP FUNCTION IF EXISTS public.academix_admin_grade_directory(uuid,uuid,uuid,smallint,text,uuid);

CREATE FUNCTION public.academix_admin_grade_directory(
  p_campus_id uuid DEFAULT NULL,
  p_college_id uuid DEFAULT NULL,
  p_program_id uuid DEFAULT NULL,
  p_year_level smallint DEFAULT NULL,
  p_block_code text DEFAULT NULL,
  p_term_id uuid DEFAULT NULL
)
RETURNS TABLE(
  grade_id uuid,
  student_id uuid,
  full_name text,
  bu_id text,
  campus_name text,
  college_name text,
  program_name text,
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
  IF NOT public.academix_is_active_admin() THEN
    RAISE EXCEPTION 'Administrator access required.' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT
    combined.grade_id,
    combined.student_id,
    combined.full_name,
    combined.bu_id,
    combined.campus_name,
    combined.college_name,
    combined.program_name,
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
      ca.campus_name AS campus_name,
      co.college_name AS college_name,
      pr.program_name AS program_name,
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
    LEFT JOIN public.academic_campuses ca ON ca.id = p.campus_id
    LEFT JOIN public.academic_colleges co ON co.id = p.college_id
    LEFT JOIN public.academic_programs pr ON pr.id = p.program_id
    LEFT JOIN LATERAL (
      SELECT b.gwa_value
      FROM public.term_grade_bands b
      WHERE b.term_id = o.term_id
        AND g.max_score > 0
        AND (g.score / g.max_score * 100) BETWEEN b.min_percentage AND b.max_percentage
      ORDER BY b.min_percentage DESC
      LIMIT 1
    ) band ON true
    WHERE (p_campus_id IS NULL OR p.campus_id = p_campus_id)
      AND (p_college_id IS NULL OR p.college_id = p_college_id)
      AND (p_program_id IS NULL OR p.program_id = p_program_id)
      AND (p_year_level IS NULL OR p.year_level = p_year_level)
      AND (p_block_code IS NULL OR upper(p.block_code) = upper(trim(p_block_code)))
      AND (p_term_id IS NULL OR o.term_id = p_term_id)
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
      ca.campus_name AS campus_name,
      co.college_name AS college_name,
      pr.program_name AS program_name,
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
    LEFT JOIN public.academic_campuses ca ON ca.id = p.campus_id
    LEFT JOIN public.academic_colleges co ON co.id = p.college_id
    LEFT JOIN public.academic_programs pr ON pr.id = p.program_id
    LEFT JOIN LATERAL (
      SELECT b.gwa_value
      FROM public.term_grade_bands b
      WHERE b.term_id = o.term_id
        AND fg.percentage BETWEEN b.min_percentage AND b.max_percentage
      ORDER BY b.min_percentage DESC
      LIMIT 1
    ) band ON true
    WHERE (p_campus_id IS NULL OR p.campus_id = p_campus_id)
      AND (p_college_id IS NULL OR p.college_id = p_college_id)
      AND (p_program_id IS NULL OR p.program_id = p_program_id)
      AND (p_year_level IS NULL OR p.year_level = p_year_level)
      AND (p_block_code IS NULL OR upper(p.block_code) = upper(trim(p_block_code)))
      AND (p_term_id IS NULL OR o.term_id = p_term_id)
      AND p.campus_id = o.campus_id
      AND p.college_id = o.college_id
      AND p.program_id = o.program_id
      AND p.year_level = o.year_level
      AND upper(p.block_code) = upper(o.block_code)
  ) AS combined
  ORDER BY
    combined.campus_name,
    combined.college_name,
    combined.program_name,
    combined.year_level,
    combined.block_code,
    combined.full_name,
    combined.graded_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.academix_admin_grade_directory(uuid,uuid,uuid,smallint,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.academix_admin_grade_directory(uuid,uuid,uuid,smallint,text,uuid) TO authenticated;

COMMENT ON FUNCTION public.academix_admin_grade_directory(uuid,uuid,uuid,smallint,text,uuid) IS
  'Returns assessment and finalized course grade records for administrators, optionally filtered by campus, college, program, year, block, and term; sorts only the projected UNION result.';

COMMIT;
