BEGIN;

-- get_exam_questions was SECURITY INVOKER. The questions table intentionally has
-- no student SELECT policy and revokes table-level SELECT to protect answer keys.
-- Therefore the RPC returned zero rows under student RLS even when the student
-- had a valid exam_assignment and the exam contained questions.
--
-- Use a narrowly scoped SECURITY DEFINER function. It explicitly checks the
-- caller, verification, published status, and assignment, and returns only
-- student-safe question columns (never correct_answer or explanation).

CREATE OR REPLACE FUNCTION public.get_exam_questions(p_exam_id uuid)
RETURNS TABLE(
  id uuid,
  "position" integer,
  question_type text,
  prompt text,
  options jsonb,
  points numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    q.id,
    q.position,
    q.question_type,
    q.prompt,
    q.options,
    q.points
  FROM public.questions AS q
  INNER JOIN public.exams AS e
    ON e.id = q.exam_id
  WHERE q.exam_id = p_exam_id
    AND e.status = 'published'
    AND auth.uid() IS NOT NULL
    AND public.is_verified()
    AND EXISTS (
      SELECT 1
      FROM public.exam_assignments AS a
      WHERE a.exam_id = e.id
        AND a.student_id = auth.uid()
    )
  ORDER BY q.position;
$$;

REVOKE ALL ON FUNCTION public.get_exam_questions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_exam_questions(uuid) TO authenticated;

COMMIT;
