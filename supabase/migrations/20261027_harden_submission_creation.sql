-- BUOC AcademiX security hardening: all student attempts must be created by the trusted RPC.
-- Direct INSERT on submissions lets a client choose attempt_number, attempt_type, and started_at,
-- which could bypass retake authorization or manipulate the server-enforced deadline.
begin;

revoke insert, update, delete on table public.submissions from anon, authenticated;
grant select on table public.submissions to authenticated;

create or replace function public.start_exam_attempt(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_role public.app_role;
  v_exam public.exams%rowtype;
  v_existing public.submissions%rowtype;
  v_latest integer;
  v_attempt integer;
  v_type text := 'initial';
  v_auth public.exam_attempt_authorizations%rowtype;
  v_submission uuid;
begin
  if v_user is null then
    raise exception 'Authentication required.' using errcode='28000';
  end if;

  select role into v_role from public.profiles where id=v_user;
  if v_role is distinct from 'student'::public.app_role then
    raise exception 'Only student accounts can take exams.' using errcode='42501';
  end if;
  if not public.is_verified() then
    raise exception 'Institutional verification is required.' using errcode='42501';
  end if;

  select * into v_exam from public.exams where id=p_exam_id and status='published';
  if not found then
    raise exception 'Published exam not found.' using errcode='P0002';
  end if;
  if not exists (
    select 1 from public.exam_assignments
    where exam_id=p_exam_id and student_id=v_user
  ) then
    raise exception 'You are not assigned to this assessment.' using errcode='42501';
  end if;
  if not exists (select 1 from public.questions where exam_id=p_exam_id) then
    raise exception 'This assessment has no questions.' using errcode='55000';
  end if;

  select * into v_existing
  from public.submissions
  where exam_id=p_exam_id and student_id=v_user and status='in_progress'
  order by attempt_number desc
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'submission_id',v_existing.id,
      'attempt_number',v_existing.attempt_number,
      'attempt_type',v_existing.attempt_type
    );
  end if;

  select coalesce(max(attempt_number),0) into v_latest
  from public.submissions where exam_id=p_exam_id and student_id=v_user;

  if v_latest=0 then
    v_attempt := 1;
    v_type := 'initial';
  else
    select * into v_auth
    from public.exam_attempt_authorizations
    where exam_id=p_exam_id and student_id=v_user and consumed_at is null
    order by attempt_number asc
    limit 1
    for update;

    if not found or v_auth.attempt_number <> v_latest + 1 then
      raise exception 'No retake or remedial attempt is authorized.' using errcode='42501';
    end if;
    v_attempt := v_auth.attempt_number;
    v_type := v_auth.attempt_type;
    update public.exam_attempt_authorizations
      set consumed_at=clock_timestamp()
      where id=v_auth.id and consumed_at is null;
    if not found then
      raise exception 'Attempt authorization has already been used.' using errcode='55000';
    end if;
  end if;

  insert into public.submissions(exam_id,student_id,status,attempt_number,attempt_type)
  values(p_exam_id,v_user,'in_progress',v_attempt,v_type)
  returning id into v_submission;

  return jsonb_build_object(
    'submission_id',v_submission,
    'attempt_number',v_attempt,
    'attempt_type',v_type
  );
end;
$$;

revoke all on function public.start_exam_attempt(uuid) from public, anon;
grant execute on function public.start_exam_attempt(uuid) to authenticated;

commit;
