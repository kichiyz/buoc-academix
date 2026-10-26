-- BUOC AcademiX: authorized retake/remedial attempt workflow.
-- Apply this migration in Supabase SQL Editor after reviewing it.
begin;

alter table public.submissions
  add column if not exists attempt_number integer not null default 1,
  add column if not exists attempt_type text not null default 'initial';

alter table public.submissions
  drop constraint if exists submissions_exam_id_student_id_key;

alter table public.submissions
  add constraint submissions_attempt_type_check
  check (attempt_type in ('initial','retake','remedial'));

create unique index if not exists submissions_exam_student_attempt_uidx
  on public.submissions(exam_id, student_id, attempt_number);

create table if not exists public.exam_attempt_authorizations (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 1),
  attempt_type text not null check (attempt_type in ('retake','remedial')),
  reason text,
  authorized_by uuid not null references public.profiles(id),
  authorized_at timestamptz not null default now(),
  consumed_at timestamptz,
  unique(exam_id, student_id, attempt_number)
);

create index if not exists attempt_auth_pending_idx
  on public.exam_attempt_authorizations(exam_id, student_id, authorized_at desc)
  where consumed_at is null;

alter table public.exam_attempt_authorizations enable row level security;
revoke all on public.exam_attempt_authorizations from anon, authenticated;

create or replace function public.authorize_exam_attempt(
  p_exam_id uuid,
  p_student_id uuid,
  p_attempt_type text,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.app_role;
  v_exam public.exams%rowtype;
  v_latest integer;
  v_attempt integer;
begin
  if v_actor is null then raise exception 'Authentication required.' using errcode='28000'; end if;
  select role into v_role from public.profiles where id=v_actor;
  if v_role not in ('teacher','admin') then raise exception 'Teacher access required.' using errcode='42501'; end if;

  select * into v_exam from public.exams where id=p_exam_id;
  if not found or v_exam.status <> 'published' then
    raise exception 'Published exam not found.' using errcode='P0002';
  end if;
  if v_role <> 'admin' and v_exam.teacher_id <> v_actor then
    raise exception 'You can only authorize attempts for your own exams.' using errcode='42501';
  end if;
  if p_attempt_type not in ('retake','remedial') then
    raise exception 'Attempt type must be retake or remedial.' using errcode='22023';
  end if;
  if not exists(select 1 from public.exam_assignments where exam_id=p_exam_id and student_id=p_student_id) then
    raise exception 'Student must be assigned to this exam.' using errcode='42501';
  end if;
  if not exists(select 1 from public.profiles where id=p_student_id and role='student') then
    raise exception 'Student account not found.' using errcode='P0002';
  end if;
  if exists(select 1 from public.submissions where exam_id=p_exam_id and student_id=p_student_id and status='in_progress') then
    raise exception 'Student already has an attempt in progress.' using errcode='55000';
  end if;
  if exists(select 1 from public.exam_attempt_authorizations where exam_id=p_exam_id and student_id=p_student_id and consumed_at is null) then
    raise exception 'An unused attempt authorization already exists.' using errcode='55000';
  end if;

  select coalesce(max(attempt_number),0) into v_latest
  from public.submissions where exam_id=p_exam_id and student_id=p_student_id;
  if v_latest=0 then raise exception 'The student has not completed an initial attempt yet.' using errcode='55000'; end if;
  v_attempt := v_latest + 1;

  insert into public.exam_attempt_authorizations(exam_id,student_id,attempt_number,attempt_type,reason,authorized_by)
  values(p_exam_id,p_student_id,v_attempt,p_attempt_type,left(coalesce(p_reason,''),1000),v_actor);

  return jsonb_build_object('exam_id',p_exam_id,'student_id',p_student_id,'attempt_number',v_attempt,'attempt_type',p_attempt_type);
end;
$$;

create or replace function public.start_exam_attempt(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_exam public.exams%rowtype;
  v_existing public.submissions%rowtype;
  v_latest integer;
  v_attempt integer;
  v_type text := 'initial';
  v_auth public.exam_attempt_authorizations%rowtype;
  v_submission uuid;
begin
  if v_user is null then raise exception 'Authentication required.' using errcode='28000'; end if;
  if not public.is_verified() then raise exception 'Institutional verification is required.' using errcode='42501'; end if;

  select * into v_exam from public.exams where id=p_exam_id and status='published';
  if not found then raise exception 'Published exam not found.' using errcode='P0002'; end if;
  if not exists(select 1 from public.exam_assignments where exam_id=p_exam_id and student_id=v_user) then
    raise exception 'You are not assigned to this assessment.' using errcode='42501';
  end if;
  if not exists(select 1 from public.questions where exam_id=p_exam_id) then
    raise exception 'This assessment has no questions.' using errcode='55000';
  end if;

  select * into v_existing from public.submissions
  where exam_id=p_exam_id and student_id=v_user and status='in_progress'
  order by attempt_number desc limit 1;
  if found then
    return jsonb_build_object('submission_id',v_existing.id,'attempt_number',v_existing.attempt_number,'attempt_type',v_existing.attempt_type);
  end if;

  select coalesce(max(attempt_number),0) into v_latest
  from public.submissions where exam_id=p_exam_id and student_id=v_user;

  if v_latest=0 then
    v_attempt := 1;
    v_type := 'initial';
  else
    select * into v_auth from public.exam_attempt_authorizations
    where exam_id=p_exam_id and student_id=v_user and consumed_at is null
    order by attempt_number asc limit 1 for update;
    if not found then raise exception 'No retake or remedial attempt is authorized.' using errcode='42501'; end if;
    v_attempt := v_auth.attempt_number;
    v_type := v_auth.attempt_type;
    update public.exam_attempt_authorizations set consumed_at=now() where id=v_auth.id;
  end if;

  insert into public.submissions(exam_id,student_id,status,attempt_number,attempt_type)
  values(p_exam_id,v_user,'in_progress',v_attempt,v_type)
  returning id into v_submission;

  return jsonb_build_object('submission_id',v_submission,'attempt_number',v_attempt,'attempt_type',v_type);
end;
$$;

revoke all on function public.authorize_exam_attempt(uuid,uuid,text,text) from public, anon;
revoke all on function public.start_exam_attempt(uuid) from public, anon;
grant execute on function public.authorize_exam_attempt(uuid,uuid,text,text) to authenticated;
grant execute on function public.start_exam_attempt(uuid) to authenticated;

commit;
