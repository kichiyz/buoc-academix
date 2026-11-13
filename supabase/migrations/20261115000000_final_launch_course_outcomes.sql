-- Final launch: teacher-controlled course outcomes and student drop requests.
-- Assessment-level pass/fail is calculated from the graded score at 75%.
create table if not exists public.course_enrollment_statuses (
  enrollment_id uuid primary key references public.course_enrollments(id) on delete cascade,
  outcome text not null default 'active' check (outcome in ('active','inc','drp','passed','failed')),
  drop_requested_at timestamptz,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create index if not exists course_enrollment_status_outcome_idx
  on public.course_enrollment_statuses(outcome, updated_at desc);
alter table public.course_enrollment_statuses enable row level security;
revoke all on public.course_enrollment_statuses from anon, authenticated;
grant select on public.course_enrollment_statuses to authenticated;
drop policy if exists "Students and assigned teachers read course outcomes" on public.course_enrollment_statuses;
create policy "Students and assigned teachers read course outcomes"
on public.course_enrollment_statuses for select to authenticated using (
  exists(select 1 from public.course_enrollments e where e.id=enrollment_id and e.student_id=auth.uid())
  or public.academix_is_active_admin()
  or exists(select 1 from public.course_enrollments e join public.course_offerings o on o.id=e.offering_id
    where e.id=enrollment_id and o.instructor_id=auth.uid())
);

create or replace function public.academix_student_request_course_drop(p_enrollment_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not public.is_verified()
    or (select role from public.profiles where id=auth.uid()) is distinct from 'student'::public.app_role then
    raise exception 'Verified student account required.' using errcode='42501';
  end if;
  if not exists(select 1 from public.course_enrollments where id=p_enrollment_id and student_id=auth.uid()) then
    raise exception 'This enrollment does not belong to your account.' using errcode='42501';
  end if;
  if exists(select 1 from public.course_enrollment_statuses where enrollment_id=p_enrollment_id and outcome='drp') then
    raise exception 'This course has already been approved as dropped.' using errcode='55000';
  end if;
  insert into public.course_enrollment_statuses(enrollment_id,outcome,drop_requested_at,updated_by,updated_at)
  values(p_enrollment_id,'active',now(),auth.uid(),now())
  on conflict(enrollment_id) do update set drop_requested_at=coalesce(public.course_enrollment_statuses.drop_requested_at,now()),
    updated_by=auth.uid(),updated_at=now();
end $$;
revoke all on function public.academix_student_request_course_drop(uuid) from public,anon;
grant execute on function public.academix_student_request_course_drop(uuid) to authenticated;

create or replace function public.academix_teacher_set_course_outcome(p_enrollment_id uuid,p_outcome text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_percentage numeric;
begin
  if auth.uid() is null or not public.is_verified()
    or (select role from public.profiles where id=auth.uid()) is distinct from 'teacher'::public.app_role then
    raise exception 'Verified Teacher account required.' using errcode='42501';
  end if;
  if p_outcome not in ('active','inc','drp') then
    raise exception 'Choose In progress, INC, or DRP. Passed and Failed are calculated from the final percentage.' using errcode='22023';
  end if;
  if not exists(select 1 from public.course_enrollments e join public.course_offerings o on o.id=e.offering_id
    where e.id=p_enrollment_id and o.instructor_id=auth.uid()) then
    raise exception 'You may only update outcomes for your assigned course offerings.' using errcode='42501';
  end if;
  if p_outcome='drp' and not exists(select 1 from public.course_enrollment_statuses
    where enrollment_id=p_enrollment_id and drop_requested_at is not null) then
    raise exception 'A student drop request is required before you can approve DRP.' using errcode='23514';
  end if;
  select percentage into v_percentage from public.course_final_grades where enrollment_id=p_enrollment_id;
  if p_outcome='active' and v_percentage is not null then
    raise exception 'A finalized grade exists. Update the final percentage to recalculate Passed or Failed.' using errcode='23514';
  end if;
  insert into public.course_enrollment_statuses(enrollment_id,outcome,updated_by,updated_at)
  values(p_enrollment_id,p_outcome,auth.uid(),now())
  on conflict(enrollment_id) do update set outcome=excluded.outcome,updated_by=auth.uid(),updated_at=now();
end $$;
revoke all on function public.academix_teacher_set_course_outcome(uuid,text) from public,anon;
grant execute on function public.academix_teacher_set_course_outcome(uuid,text) to authenticated;

create or replace function public.academix_student_course_outcomes()
returns table(enrollment_id uuid,course_code text,course_title text,section text,outcome text,drop_requested boolean)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not public.is_verified()
    or (select role from public.profiles where id=auth.uid()) is distinct from 'student'::public.app_role then
    raise exception 'Verified student account required.' using errcode='42501';
  end if;
  return query
  select e.id,c.course_code,c.course_title,o.section,coalesce(s.outcome,'active'),
    (s.drop_requested_at is not null and coalesce(s.outcome,'active')<>'drp')
  from public.course_enrollments e
  join public.course_offerings o on o.id=e.offering_id
  join public.academic_courses c on c.id=o.course_id
  left join public.course_enrollment_statuses s on s.enrollment_id=e.id
  where e.student_id=auth.uid()
    and o.term_id=(select t.id from public.academic_terms t where t.is_active limit 1)
  order by c.course_code;
end $$;
revoke all on function public.academix_student_course_outcomes() from public,anon;
grant execute on function public.academix_student_course_outcomes() to authenticated;

-- A teacher's finalized percentage automatically determines the course result.
create or replace function public.academix_teacher_set_final_grade(
  p_enrollment_id uuid,p_percentage numeric,p_remarks text default null
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_outcome text;
begin
  if auth.uid() is null or not public.is_verified()
    or (select role from public.profiles where id=auth.uid()) is distinct from 'teacher'::public.app_role then
    raise exception 'Verified Teacher account required.' using errcode='42501';
  end if;
  if not exists(select 1 from public.course_enrollments e join public.course_offerings o on o.id=e.offering_id
    where e.id=p_enrollment_id and o.instructor_id=auth.uid()) then
    raise exception 'You may only finalize grades for students in your assigned course offerings.' using errcode='42501';
  end if;
  v_outcome:=case when p_percentage>=75 then 'passed' else 'failed' end;
  insert into public.course_final_grades(enrollment_id,percentage,remarks,finalized_by)
  values(p_enrollment_id,p_percentage,left(p_remarks,1000),auth.uid())
  on conflict(enrollment_id) do update set percentage=excluded.percentage,remarks=excluded.remarks,
    finalized_by=auth.uid(),finalized_at=now(),updated_at=now()
  returning id into v_id;
  insert into public.course_enrollment_statuses(enrollment_id,outcome,updated_by,updated_at)
  values(p_enrollment_id,v_outcome,auth.uid(),now())
  on conflict(enrollment_id) do update set outcome=excluded.outcome,updated_by=auth.uid(),updated_at=now();
  return v_id;
end $$;
revoke all on function public.academix_teacher_set_final_grade(uuid,numeric,text) from public,anon;
grant execute on function public.academix_teacher_set_final_grade(uuid,numeric,text) to authenticated;

-- Dropped subjects are excluded from semester GWA; INC keeps the GWA locked until compliance.
create or replace function public.academix_student_semester_gwa(p_term_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_user uuid:=auth.uid(); v_term uuid; v_missing jsonb; v_ungraded integer; v_unmapped integer;
  v_inc_count integer; v_gwa numeric(5,3); v_units numeric; v_courses jsonb;
begin
  if v_user is null or not public.is_verified()
    or (select role from public.profiles where id=v_user) is distinct from 'student'::public.app_role then
    raise exception 'Verified student access required.' using errcode='42501';
  end if;
  select id into v_term from public.academic_terms where (p_term_id is null and is_active) or id=p_term_id limit 1;
  if v_term is null then return jsonb_build_object('locked',true,'reason','No active academic term is configured.'); end if;
  select count(*) into v_inc_count from public.course_enrollments e join public.course_offerings o on o.id=e.offering_id
    join public.course_enrollment_statuses s on s.enrollment_id=e.id
    where e.student_id=v_user and o.term_id=v_term and s.outcome='inc';
  if v_inc_count>0 then return jsonb_build_object('locked',true,'reason','You have an INC course. Complete the requirements approved by your instructor before your final GWA can be released.','incomplete_courses',v_inc_count); end if;
  select coalesce(jsonb_agg(jsonb_build_object('instructor_id',x.instructor_id,'instructor_name',x.full_name)), '[]'::jsonb)
  into v_missing
  from (
    select distinct o.instructor_id,p.full_name from public.course_enrollments e
    join public.course_offerings o on o.id=e.offering_id join public.profiles p on p.id=o.instructor_id
    left join public.course_enrollment_statuses s on s.enrollment_id=e.id
    where e.student_id=v_user and o.term_id=v_term and coalesce(s.outcome,'active')<>'drp'
      and not exists(select 1 from public.instructor_evaluations ie where ie.term_id=v_term and ie.student_id=v_user and ie.instructor_id=o.instructor_id)
  ) x;
  if jsonb_array_length(v_missing)>0 then return jsonb_build_object('locked',true,'reason','Complete every required instructor evaluation to unlock your final GWA.','missing_evaluations',v_missing); end if;
  select count(*) into v_ungraded from public.course_enrollments e join public.course_offerings o on o.id=e.offering_id
    left join public.course_final_grades fg on fg.enrollment_id=e.id
    left join public.course_enrollment_statuses s on s.enrollment_id=e.id
    where e.student_id=v_user and o.term_id=v_term and coalesce(s.outcome,'active')<>'drp' and fg.id is null;
  if v_ungraded>0 then return jsonb_build_object('locked',true,'reason','Your final course grades are not yet complete.','ungraded_courses',v_ungraded); end if;
  select count(*) into v_unmapped from public.course_enrollments e join public.course_offerings o on o.id=e.offering_id
    join public.course_final_grades fg on fg.enrollment_id=e.id
    left join public.course_enrollment_statuses s on s.enrollment_id=e.id
    left join public.term_grade_bands b on b.term_id=v_term and fg.percentage between b.min_percentage and b.max_percentage
    where e.student_id=v_user and o.term_id=v_term and coalesce(s.outcome,'active')<>'drp' and b.id is null;
  if v_unmapped>0 then return jsonb_build_object('locked',true,'reason','The administrator has not configured a grading conversion for every final grade.','unmapped_grades',v_unmapped); end if;
  select sum(b.gwa_value*c.units)/nullif(sum(c.units),0),sum(c.units),
    jsonb_agg(jsonb_build_object('course_code',c.course_code,'course_title',c.course_title,'units',c.units,'percentage',fg.percentage,'gwa',b.gwa_value,'band',b.label) order by c.course_code)
  into v_gwa,v_units,v_courses
  from public.course_enrollments e join public.course_offerings o on o.id=e.offering_id
    join public.academic_courses c on c.id=o.course_id join public.course_final_grades fg on fg.enrollment_id=e.id
    join public.term_grade_bands b on b.term_id=v_term and fg.percentage between b.min_percentage and b.max_percentage
    left join public.course_enrollment_statuses s on s.enrollment_id=e.id
  where e.student_id=v_user and o.term_id=v_term and coalesce(s.outcome,'active')<>'drp';
  if v_gwa is null then return jsonb_build_object('locked',true,'reason','No finalized, non-dropped course grades are available for this term.'); end if;
  return jsonb_build_object('locked',false,'term_id',v_term,'gwa',round(v_gwa,2),'total_units',v_units,'courses',v_courses);
end $$;
revoke all on function public.academix_student_semester_gwa(uuid) from public,anon;
grant execute on function public.academix_student_semester_gwa(uuid) to authenticated;
