-- Secure teacher-only answer-key retrieval for printing published assessments.
-- Students continue using get_exam_questions(), which never returns answer keys.
create or replace function public.get_teacher_exam_answer_key(p_exam_id uuid)
returns table(
  position int,
  question_type text,
  prompt text,
  options jsonb,
  correct_answer jsonb,
  explanation text,
  points numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.current_role() not in ('teacher','admin') then
    raise exception 'Only teachers and administrators can retrieve answer keys.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.exams e
    where e.id = p_exam_id
      and e.teacher_id = auth.uid()
      and e.status in ('published','archived')
  ) then
    raise exception 'You are not authorized to access this assessment answer key.'
      using errcode = '42501';
  end if;

  return query
    select q.position,q.question_type,q.prompt,q.options,q.correct_answer,q.explanation,q.points
    from public.questions q
    where q.exam_id = p_exam_id
    order by q.position;
end;
$$;

revoke all on function public.get_teacher_exam_answer_key(uuid) from public, anon;
grant execute on function public.get_teacher_exam_answer_key(uuid) to authenticated;
