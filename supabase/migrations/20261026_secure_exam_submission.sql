-- BUOC AcademiX: secure server-side exam submission and grading.
-- Apply this migration in the Supabase SQL Editor before relying on exam submission.
-- It intentionally does not create retake/remedial rules; those need explicit authorization rules.

create or replace function public.submit_exam(
  p_submission_id uuid,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_submission public.submissions%rowtype;
  v_exam public.exams%rowtype;
  v_question record;
  v_score numeric(9,2) := 0;
  v_max_score numeric(9,2) := 0;
  v_answer jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Answers must be a JSON object.' using errcode = '22023';
  end if;

  select * into v_submission
  from public.submissions
  where id = p_submission_id
  for update;

  if not found then
    raise exception 'Submission not found.' using errcode = 'P0002';
  end if;

  if v_submission.student_id <> v_user_id then
    raise exception 'You cannot submit another student’s attempt.' using errcode = '42501';
  end if;

  if v_submission.status <> 'in_progress' then
    raise exception 'This attempt has already been submitted.' using errcode = '55000';
  end if;

  select * into v_exam
  from public.exams
  where id = v_submission.exam_id;

  if not found or v_exam.status <> 'published' then
    raise exception 'This assessment is not available.' using errcode = '55000';
  end if;

  if not public.is_verified() then
    raise exception 'Institutional verification is required.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.exam_assignments a
    where a.exam_id = v_submission.exam_id and a.student_id = v_user_id
  ) then
    raise exception 'You are not assigned to this assessment.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.questions q where q.exam_id = v_submission.exam_id) then
    raise exception 'This assessment has no questions.' using errcode = '55000';
  end if;

  for v_question in
    select q.id, q.correct_answer, q.points
    from public.questions q
    where q.exam_id = v_submission.exam_id
    order by q.position
  loop
    v_max_score := v_max_score + v_question.points;
    v_answer := p_answers -> v_question.id::text;

    -- The client sends answer text; the correct answer stays in the database.
    if v_answer is not null and v_answer = v_question.correct_answer then
      v_score := v_score + v_question.points;
    end if;
  end loop;

  update public.submissions
  set answers = p_answers,
      score = v_score,
      max_score = v_max_score,
      status = 'graded',
      submitted_at = v_now,
      graded_at = v_now
  where id = p_submission_id;

  insert into public.grades (
    submission_id, student_id, exam_id, score, max_score, feedback, graded_by, created_at
  ) values (
    p_submission_id, v_user_id, v_submission.exam_id, v_score, v_max_score,
    'Automatically graded', null, v_now
  )
  on conflict (submission_id) do update
    set score = excluded.score,
        max_score = excluded.max_score,
        feedback = excluded.feedback,
        graded_by = null,
        created_at = excluded.created_at;

  return jsonb_build_object(
    'submission_id', p_submission_id,
    'status', 'graded',
    'score', v_score,
    'max_score', v_max_score,
    'submitted_at', v_now
  );
end;
$$;

revoke all on function public.submit_exam(uuid, jsonb) from public;
revoke all on function public.submit_exam(uuid, jsonb) from anon;
grant execute on function public.submit_exam(uuid, jsonb) to authenticated;
