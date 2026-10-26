-- BUOC AcademiX: authorized retakes and remedial attempts.
-- Apply after 20261026_secure_exam_submission.sql.
begin;

alter table public.submissions add column if not exists attempt_number integer;
alter table public.submissions add column if not exists attempt_type text;
update public.submissions set attempt_number = 1 where attempt_number is null;
update public.submissions set attempt_type = 'regular' where attempt_type is null;
alter table public.submissions alter column attempt_number set default 1;
alter table public.submissions alter column attempt_number set not null;
alter table public.submissions alter column attempt_type set default 'regular';
alter table public.submissions alter column attempt_type set not null;
alter table public.submissions drop constraint if exists submissions_attempt_number_check;
alter table public.submissions add constraint submissions_attempt_number_check check (attempt_number > 0);
alter table public.submissions drop constraint if exists submissions_attempt_type_check;
alter table public.submissions add constraint submissions_attempt_type_check check (attempt_type in ('regular','retake','remedial'));

-- Replace the old one-submission-per-exam rule with one row per attempt.
alter table public.submissions drop constraint if exists submissions_exam_id_student_id_key;
create unique index if not exists submissions_exam_student_attempt_uq
  on public.submissions(exam_id, student_id, attempt_number);

create table if not exists public.exam_attempt_authorizations (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 1),
  attempt_type text not null check (attempt_type in ('retake','remedial')),
  authorized_by uuid not null references public.profiles(id),
  reason text,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  unique(exam_id, student_id, attempt_number)
);
alter table public.exam_attempt_authorizations enable row level security;
revoke all on public.exam_attempt_authorizations from anon, authenticated;

create or replace function public.authorize_exam_attempt(
  p_exam_id uuid,
  p_student_id uuid,
  p_attempt_type text,
  p_reason text default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
  v_role public.app_role;
  v_attempt integer;
begin
  if v_actor is null then raise exception 'Authentication required.' using errcode='28000'; end if;
  select role into v_role from public.profiles where id=v_actor;
  if v_role not in ('teacher','admin') then raise exception 'Teacher or admin access required.' using errcode='42501'; end if;
  if p_attempt_type not in ('retake','remedial') then raise exception 'Attempt type must be retake or remedial.' using errcode='22023'; end if;
  if not exists(select 1 from public.exams e where e.id=p_exam_id and e.status='published'
      and (v_role='admin' or e.teacher_id=v_actor)) then
    raise exception 'You may only authorize attempts for your own published exams.' using errcode='42501';
  end if;
  if not exists(select 1 from public.profiles p where p.id=p_student_id and p.role='student' and p.verified_at is not null)
     or not exists(select 1 from public.exam_assignments a where a.exam_id=p_exam_id and a.student_id=p_student_id) then
    raise exception 'Student must be verified and assigned to this exam.' using errcode='22023';
  end if;
  if exists(select 1 from public.submissions s where s.exam_id=p_exam_id and s.student_id=p_student_id and s.status='in_progress') then
    raise exception 'Student already has an attempt in progress.' using errcode='55000';
  end if;
  select coalesce(max(s.attempt_number),0)+1 into v_attempt
    from public.submissions s where s.exam_id=p_exam_id and s.student_id=p_student_id;
  if v_attempt <= 1 then raise exception 'A retake/remedial authorization is only needed after the first attempt.' using errcode='22023'; end if;
  insert into public.exam_attempt_authorizations(exam_id,student_id,attempt_number,attempt_type,authorized_by,reason)
  values(p_exam_id,p_student_id,v_attempt,p_attempt_type,v_actor,nullif(trim(p_reason),''));
  return jsonb_build_object('exam_id',p_exam_id,'student_id',p_student_id,'attempt_number',v_attempt,'attempt_type',p_attempt_type);
end;
$function$;

create or replace function public.start_exam_attempt(p_exam_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_exam public.exams%rowtype;
  v_submission public.submissions%rowtype;
  v_attempt integer;
  v_type text := 'regular';
  v_auth public.exam_attempt_authorizations%rowtype;
begin
  if v_user is null then raise exception 'Authentication required.' using errcode='28000'; end if;
  if not public.is_verified() then raise exception 'Institutional verification is required.' using errcode='42501'; end if;
  select * into v_exam from public.exams where id=p_exam_id and status='published';
  if not found then raise exception 'This assessment is not available.' using errcode='55000'; end if;
  if not exists(select 1 from public.exam_assignments a where a.exam_id=p_exam_id and a.student_id=v_user) then
    raise exception 'You are not assigned to this assessment.' using errcode='42501';
  end if;
  if not exists(select 1 from public.questions q where q.exam_id=p_exam_id) then
    raise exception 'This assessment has no questions.' using errcode='55000';
  end if;

  -- Reopen the same in-progress attempt instead of creating a duplicate.
  select * into v_submission from public.submissions
   where exam_id=p_exam_id and student_id=v_user and status='in_progress'
   order by attempt_number desc limit 1 for update;
  if found then
    return jsonb_build_object('submission_id',v_submission.id,'attempt_number',v_submission.attempt_number,'attempt_type',v_submission.attempt_type);
  end if;

  select coalesce(max(s.attempt_number),0)+1 into v_attempt
    from public.submissions s where s.exam_id=p_exam_id and s.student_id=v_user;
  if v_attempt > 1 then
    select * into v_auth from public.exam_attempt_authorizations a
      where a.exam_id=p_exam_id and a.student_id=v_user and a.attempt_number=v_attempt and a.consumed_at is null
      for update;
    if not found then raise exception 'A teacher/admin must authorize your next attempt.' using errcode='42501'; end if;
    v_type := v_auth.attempt_type;
    update public.exam_attempt_authorizations set consumed_at=clock_timestamp() where id=v_auth.id;
  end if;
  insert into public.submissions(exam_id,student_id,status,attempt_number,attempt_type)
    values(p_exam_id,v_user,'in_progress',v_attempt,v_type) returning * into v_submission;
  return jsonb_build_object('submission_id',v_submission.id,'attempt_number',v_submission.attempt_number,'attempt_type',v_submission.attempt_type);
end;
$function$;

revoke all on function public.authorize_exam_attempt(uuid,uuid,text,text) from public, anon;
grant execute on function public.authorize_exam_attempt(uuid,uuid,text,text) to authenticated;
revoke all on function public.start_exam_attempt(uuid) from public, anon;
grant execute on function public.start_exam_attempt(uuid) to authenticated;
commit;
