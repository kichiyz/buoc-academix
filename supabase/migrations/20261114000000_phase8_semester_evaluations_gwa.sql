-- Phase 8: semester structure, confidential instructor evaluations, configurable BU grading scales, and GWA gate.
-- Additive only. Existing exams, submissions, and assessment grades remain unchanged.

create table if not exists public.academic_terms (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null check (char_length(trim(academic_year)) between 4 and 20),
  semester text not null check (semester in ('1st','2nd','midyear')),
  starts_on date not null,
  ends_on date not null,
  is_active boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (academic_year, semester)
);
create unique index if not exists academic_terms_one_active_idx on public.academic_terms(is_active) where is_active;

create table if not exists public.academic_courses (
  id uuid primary key default gen_random_uuid(),
  course_code text not null unique check (char_length(trim(course_code)) between 1 and 30),
  course_title text not null check (char_length(trim(course_title)) between 2 and 160),
  units numeric(4,2) not null check (units > 0 and units <= 12),
  created_at timestamptz not null default now()
);

create table if not exists public.course_offerings (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.academic_terms(id) on delete restrict,
  course_id uuid not null references public.academic_courses(id) on delete restrict,
  instructor_id uuid not null references public.profiles(id) on delete restrict,
  section text not null check (char_length(trim(section)) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (term_id, course_id, section)
);
create index if not exists course_offerings_instructor_term_idx on public.course_offerings(instructor_id, term_id);

create table if not exists public.course_enrollments (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.course_offerings(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  unique (offering_id, student_id)
);
create index if not exists course_enrollments_student_idx on public.course_enrollments(student_id, offering_id);

create table if not exists public.instructor_evaluations (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.academic_terms(id) on delete restrict,
  student_id uuid not null references public.profiles(id) on delete cascade,
  instructor_id uuid not null references public.profiles(id) on delete restrict,
  ratings jsonb not null check (jsonb_typeof(ratings) = 'object'),
  submitted_at timestamptz not null default now(),
  unique (term_id, student_id, instructor_id)
);
create index if not exists instructor_evaluations_term_idx on public.instructor_evaluations(term_id, instructor_id);

create table if not exists public.term_grade_bands (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.academic_terms(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 60),
  min_percentage numeric(5,2) not null check (min_percentage >= 0 and min_percentage <= 100),
  max_percentage numeric(5,2) not null check (max_percentage >= 0 and max_percentage <= 100),
  gwa_value numeric(3,2) not null check (gwa_value >= 1 and gwa_value <= 5),
  created_at timestamptz not null default now(),
  check (max_percentage >= min_percentage),
  unique (term_id, label),
  unique (term_id, min_percentage, max_percentage)
);
create index if not exists term_grade_bands_term_idx on public.term_grade_bands(term_id, min_percentage desc);

create table if not exists public.course_final_grades (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null unique references public.course_enrollments(id) on delete cascade,
  percentage numeric(5,2) not null check (percentage >= 0 and percentage <= 100),
  remarks text check (remarks is null or char_length(remarks) <= 1000),
  finalized_by uuid not null references public.profiles(id),
  finalized_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Prevent overlapping percentage ranges for the same term. Locking the parent term
-- in the admin RPC serializes concurrent scale edits.
create or replace function public.academix_check_grade_band_overlap()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (
    select 1 from public.term_grade_bands b
    where b.term_id = new.term_id and b.id is distinct from new.id
      and new.min_percentage <= b.max_percentage
      and new.max_percentage >= b.min_percentage
  ) then
    raise exception 'This percentage range overlaps another grading band for the selected term.' using errcode='23514';
  end if;
  return new;
end $$;
drop trigger if exists academix_grade_band_no_overlap on public.term_grade_bands;
create trigger academix_grade_band_no_overlap before insert or update on public.term_grade_bands
for each row execute function public.academix_check_grade_band_overlap();

create or replace function public.academix_is_active_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid()
    and p.role='admin'::public.app_role and p.suspended_at is null)
$$;
revoke all on function public.academix_is_active_admin() from public, anon;
grant execute on function public.academix_is_active_admin() to authenticated;

create or replace function public.academix_can_read_offering(p_offering_id uuid,p_instructor_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $phase8$
  select public.academix_is_active_admin()
    or p_instructor_id=auth.uid()
    or exists(select 1 from public.course_enrollments e where e.offering_id=p_offering_id and e.student_id=auth.uid())
$phase8$;
revoke all on function public.academix_can_read_offering(uuid,uuid) from public,anon;
grant execute on function public.academix_can_read_offering(uuid,uuid) to authenticated;

alter table public.academic_terms enable row level security;
alter table public.academic_courses enable row level security;
alter table public.course_offerings enable row level security;
alter table public.course_enrollments enable row level security;
alter table public.instructor_evaluations enable row level security;
alter table public.term_grade_bands enable row level security;
alter table public.course_final_grades enable row level security;

revoke all on public.academic_terms, public.academic_courses, public.course_offerings,
  public.course_enrollments, public.instructor_evaluations, public.term_grade_bands,
  public.course_final_grades from anon, authenticated;
grant select on public.academic_terms, public.academic_courses, public.course_offerings,
  public.course_enrollments, public.term_grade_bands, public.course_final_grades to authenticated;
-- Evaluation rows are deliberately not directly selectable by instructors or administrators.
grant select on public.instructor_evaluations to authenticated;

drop policy if exists "Verified users read academic terms" on public.academic_terms;
create policy "Verified users read academic terms" on public.academic_terms for select to authenticated using (public.is_verified());
drop policy if exists "Verified users read course catalog" on public.academic_courses;
create policy "Verified users read course catalog" on public.academic_courses for select to authenticated using (public.is_verified());
drop policy if exists "Verified users read course offerings" on public.course_offerings;
create policy "Assigned users read course offerings" on public.course_offerings for select to authenticated using (
  public.is_verified() and public.academix_can_read_offering(id,instructor_id)
);
drop policy if exists "Students instructors and admins read enrollments" on public.course_enrollments;
create policy "Students instructors and admins read enrollments" on public.course_enrollments for select to authenticated using (
  student_id=auth.uid() or public.academix_is_active_admin() or exists (
    select 1 from public.course_offerings o where o.id=offering_id and o.instructor_id=auth.uid()
  )
);
drop policy if exists "Students read their own evaluation completion" on public.instructor_evaluations;
create policy "Students read their own evaluation completion" on public.instructor_evaluations for select to authenticated using (student_id=auth.uid());
drop policy if exists "Verified users read term grading bands" on public.term_grade_bands;
create policy "Verified users read term grading bands" on public.term_grade_bands for select to authenticated using (public.is_verified());
drop policy if exists "Students instructors and admins read final course grades" on public.course_final_grades;
create policy "Students instructors and admins read final course grades" on public.course_final_grades for select to authenticated using (
  public.academix_is_active_admin() or exists (
    select 1 from public.course_enrollments e join public.course_offerings o on o.id=e.offering_id
    where e.id=enrollment_id and (e.student_id=auth.uid() or o.instructor_id=auth.uid())
  )
);

-- Administrator configuration entry points. All mutations are server-authorized.
create or replace function public.academix_admin_save_term(
  p_academic_year text, p_semester text, p_starts_on date, p_ends_on date, p_is_active boolean default false
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if not public.academix_is_active_admin() then raise exception 'Administrator access required.' using errcode='42501'; end if;
  if p_ends_on < p_starts_on then raise exception 'Term end date must not precede its start date.'; end if;
  if p_is_active then update public.academic_terms set is_active=false where is_active=true; end if;
  insert into public.academic_terms(academic_year,semester,starts_on,ends_on,is_active,created_by)
  values(trim(p_academic_year),p_semester,p_starts_on,p_ends_on,p_is_active,auth.uid())
  on conflict (academic_year,semester) do update set starts_on=excluded.starts_on,ends_on=excluded.ends_on,is_active=excluded.is_active
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.academix_admin_save_course(p_course_code text,p_course_title text,p_units numeric)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if not public.academix_is_active_admin() then raise exception 'Administrator access required.' using errcode='42501'; end if;
  insert into public.academic_courses(course_code,course_title,units) values(trim(p_course_code),trim(p_course_title),p_units)
  on conflict(course_code) do update set course_title=excluded.course_title,units=excluded.units returning id into v_id;
  return v_id;
end $$;

create or replace function public.academix_admin_save_offering(p_term_id uuid,p_course_id uuid,p_instructor_id uuid,p_section text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if not public.academix_is_active_admin() then raise exception 'Administrator access required.' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles where id=p_instructor_id and role='teacher'::public.app_role and verified_at is not null and suspended_at is null) then
    raise exception 'The assigned instructor must be an active, institutionally verified Teacher.' using errcode='22023';
  end if;
  insert into public.course_offerings(term_id,course_id,instructor_id,section) values(p_term_id,p_course_id,p_instructor_id,trim(p_section))
  on conflict(term_id,course_id,section) do update set instructor_id=excluded.instructor_id returning id into v_id;
  return v_id;
end $$;

create or replace function public.academix_admin_enroll_student(p_offering_id uuid,p_student_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if not public.academix_is_active_admin() then raise exception 'Administrator access required.' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles where id=p_student_id and role='student'::public.app_role and verified_at is not null and suspended_at is null) then
    raise exception 'The student must be active, institutionally verified, and assigned the Student role.' using errcode='22023';
  end if;
  insert into public.course_enrollments(offering_id,student_id) values(p_offering_id,p_student_id)
  on conflict(offering_id,student_id) do update set student_id=excluded.student_id returning id into v_id;
  return v_id;
end $$;

create or replace function public.academix_admin_save_grade_band(
  p_term_id uuid,p_label text,p_min_percentage numeric,p_max_percentage numeric,p_gwa_value numeric
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if not public.academix_is_active_admin() then raise exception 'Administrator access required.' using errcode='42501'; end if;
  perform 1 from public.academic_terms where id=p_term_id for update;
  insert into public.term_grade_bands(term_id,label,min_percentage,max_percentage,gwa_value)
  values(p_term_id,trim(p_label),p_min_percentage,p_max_percentage,p_gwa_value)
  on conflict(term_id,label) do update set min_percentage=excluded.min_percentage,max_percentage=excluded.max_percentage,gwa_value=excluded.gwa_value
  returning id into v_id;
  return v_id;
end $$;

-- Teacher final grade entry is scoped to offerings assigned to the authenticated instructor.
create or replace function public.academix_teacher_set_final_grade(
  p_enrollment_id uuid,p_percentage numeric,p_remarks text default null
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.is_verified()
    or (select role from public.profiles where id=auth.uid()) is distinct from 'teacher'::public.app_role then
    raise exception 'Verified Teacher account required.' using errcode='42501';
  end if;
  if not exists(select 1 from public.course_enrollments e join public.course_offerings o on o.id=e.offering_id
    where e.id=p_enrollment_id and o.instructor_id=auth.uid()) then
    raise exception 'You may only finalize grades for students in your assigned course offerings.' using errcode='42501';
  end if;
  insert into public.course_final_grades(enrollment_id,percentage,remarks,finalized_by)
  values(p_enrollment_id,p_percentage,left(p_remarks,1000),auth.uid())
  on conflict(enrollment_id) do update set percentage=excluded.percentage,remarks=excluded.remarks,finalized_by=auth.uid(),finalized_at=now(),updated_at=now()
  returning id into v_id;
  return v_id;
end $$;

-- Students may submit one confidential instructor evaluation per instructor per term.
create or replace function public.academix_student_submit_instructor_evaluation(
  p_term_id uuid,p_instructor_id uuid,p_ratings jsonb
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_count integer;
begin
  if auth.uid() is null or not public.is_verified() then raise exception 'Verified student account required.' using errcode='42501'; end if;
  if (select role from public.profiles where id=auth.uid()) is distinct from 'student'::public.app_role then
    raise exception 'Only students may submit instructor evaluations.' using errcode='42501';
  end if;
  if coalesce(jsonb_typeof(p_ratings),'null') <> 'object' then
    raise exception 'Complete all four evaluation criteria using ratings from 1 to 5.' using errcode='22023';
  end if;
  if (select count(*) from jsonb_object_keys(p_ratings)) <> 4
     or exists(select 1 from jsonb_each_text(p_ratings) x where x.key not in ('clarity','preparedness','engagement','feedback') or x.value !~ '^[1-5]
  if not exists(
    select 1 from public.course_enrollments e join public.course_offerings o on o.id=e.offering_id
    join public.academic_terms t on t.id=o.term_id
    where e.student_id=auth.uid() and o.term_id=p_term_id and o.instructor_id=p_instructor_id
  ) then raise exception 'You are not enrolled in a course taught by this instructor for the selected term.' using errcode='42501'; end if;
  insert into public.instructor_evaluations(term_id,student_id,instructor_id,ratings)
  values(p_term_id,auth.uid(),p_instructor_id,p_ratings)
  on conflict(term_id,student_id,instructor_id) do nothing
  returning id into v_id;
  if v_id is null then raise exception 'You have already evaluated this instructor for this semester.' using errcode='23505'; end if;
  return v_id;
end $$;

create or replace function public.academix_student_evaluation_targets()
returns table(term_id uuid,term_label text,instructor_id uuid,instructor_name text,courses text,submitted boolean)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not public.is_verified()
    or (select role from public.profiles where id=auth.uid()) is distinct from 'student'::public.app_role then
    raise exception 'Verified student access required.' using errcode='42501';
  end if;
  return query
  select t.id, t.academic_year || ' / ' || t.semester, o.instructor_id,
    coalesce(p.full_name,'Assigned instructor'),
    string_agg(distinct c.course_code || ' - ' || c.course_title, ', ' order by c.course_code),
    exists(select 1 from public.instructor_evaluations ie where ie.term_id=t.id and ie.student_id=auth.uid() and ie.instructor_id=o.instructor_id)
  from public.course_enrollments e
  join public.course_offerings o on o.id=e.offering_id
  join public.academic_terms t on t.id=o.term_id and t.is_active=true
  join public.academic_courses c on c.id=o.course_id
  join public.profiles p on p.id=o.instructor_id
  where e.student_id=auth.uid()
  group by t.id,t.academic_year,t.semester,o.instructor_id,p.full_name
  order by p.full_name;
end $$;

-- The final GWA is returned only after every assigned instructor has been evaluated
-- and every enrolled course has a finalized grade covered by the configured scale.
create or replace function public.academix_student_semester_gwa(p_term_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_user uuid:=auth.uid(); v_term uuid; v_missing jsonb; v_ungraded integer; v_unmapped integer;
  v_gwa numeric(5,3); v_units numeric; v_courses jsonb;
begin
  if v_user is null or not public.is_verified()
    or (select role from public.profiles where id=v_user) is distinct from 'student'::public.app_role then
    raise exception 'Verified student access required.' using errcode='42501';
  end if;
  select id into v_term from public.academic_terms where (p_term_id is null and is_active) or id=p_term_id limit 1;
  if v_term is null then return jsonb_build_object('locked',true,'reason','No active academic term is configured.'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('instructor_id',x.instructor_id,'instructor_name',x.full_name)), '[]'::jsonb)
  into v_missing
  from (
    select distinct o.instructor_id,p.full_name from public.course_enrollments e
    join public.course_offerings o on o.id=e.offering_id
    join public.profiles p on p.id=o.instructor_id
    where e.student_id=v_user and o.term_id=v_term
      and not exists(select 1 from public.instructor_evaluations ie where ie.term_id=v_term and ie.student_id=v_user and ie.instructor_id=o.instructor_id)
  ) x;
  if jsonb_array_length(v_missing)>0 then
    return jsonb_build_object('locked',true,'reason','Complete every required instructor evaluation to unlock your final GWA.','missing_evaluations',v_missing);
  end if;
  select count(*) into v_ungraded from public.course_enrollments e join public.course_offerings o on o.id=e.offering_id
  left join public.course_final_grades fg on fg.enrollment_id=e.id
  where e.student_id=v_user and o.term_id=v_term and fg.id is null;
  if v_ungraded>0 then return jsonb_build_object('locked',true,'reason','Your final course grades are not yet complete.','ungraded_courses',v_ungraded); end if;
  select count(*) into v_unmapped from public.course_enrollments e join public.course_offerings o on o.id=e.offering_id
  join public.course_final_grades fg on fg.enrollment_id=e.id
  left join public.term_grade_bands b on b.term_id=v_term and fg.percentage between b.min_percentage and b.max_percentage
  where e.student_id=v_user and o.term_id=v_term and b.id is null;
  if v_unmapped>0 then return jsonb_build_object('locked',true,'reason','The administrator has not configured a grading conversion for every final grade.','unmapped_grades',v_unmapped); end if;
  select sum(b.gwa_value*c.units)/nullif(sum(c.units),0),sum(c.units),
    jsonb_agg(jsonb_build_object('course_code',c.course_code,'course_title',c.course_title,'units',c.units,'percentage',fg.percentage,'gwa',b.gwa_value,'band',b.label) order by c.course_code)
  into v_gwa,v_units,v_courses
  from public.course_enrollments e join public.course_offerings o on o.id=e.offering_id
  join public.academic_courses c on c.id=o.course_id
  join public.course_final_grades fg on fg.enrollment_id=e.id
  join public.term_grade_bands b on b.term_id=v_term and fg.percentage between b.min_percentage and b.max_percentage
  where e.student_id=v_user and o.term_id=v_term;
  if v_gwa is null then return jsonb_build_object('locked',true,'reason','No finalized course grades are available for this term.'); end if;
  return jsonb_build_object('locked',false,'term_id',v_term,'gwa',round(v_gwa,2),'total_units',v_units,'courses',v_courses);
end $$;

-- Keep the function surface narrow. Table reads remain governed by RLS.
revoke all on function public.academix_admin_save_term(text,text,date,date,boolean) from public,anon;
revoke all on function public.academix_admin_save_course(text,text,numeric) from public,anon;
revoke all on function public.academix_admin_save_offering(uuid,uuid,uuid,text) from public,anon;
revoke all on function public.academix_admin_enroll_student(uuid,uuid) from public,anon;
revoke all on function public.academix_admin_save_grade_band(uuid,text,numeric,numeric,numeric) from public,anon;
revoke all on function public.academix_teacher_set_final_grade(uuid,numeric,text) from public,anon;
revoke all on function public.academix_student_submit_instructor_evaluation(uuid,uuid,jsonb) from public,anon;
revoke all on function public.academix_student_evaluation_targets() from public,anon;
revoke all on function public.academix_student_semester_gwa(uuid) from public,anon;
grant execute on function public.academix_admin_save_term(text,text,date,date,boolean) to authenticated;
grant execute on function public.academix_admin_save_course(text,text,numeric) to authenticated;
grant execute on function public.academix_admin_save_offering(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.academix_admin_enroll_student(uuid,uuid) to authenticated;
grant execute on function public.academix_admin_save_grade_band(uuid,text,numeric,numeric,numeric) to authenticated;
grant execute on function public.academix_teacher_set_final_grade(uuid,numeric,text) to authenticated;
grant execute on function public.academix_student_submit_instructor_evaluation(uuid,uuid,jsonb) to authenticated;
grant execute on function public.academix_student_evaluation_targets() to authenticated;
grant execute on function public.academix_student_semester_gwa(uuid) to authenticated;

comment on table public.instructor_evaluations is 'Confidential student-to-instructor evaluation submissions. Raw ratings are visible only to the submitting student through RLS; no instructor/admin raw-response policy is provided.';
comment on table public.term_grade_bands is 'Administrator-configured percentage-to-GWA conversion bands for an academic term; no BU conversion values are hard-coded.';
comment on function public.academix_student_semester_gwa(uuid) is 'Returns final GWA only after all instructors are evaluated, all course grades are finalized, and every grade maps to the active term conversion table.';


create or replace function public.academix_teacher_roster(p_offering_id uuid)
returns table(enrollment_id uuid,student_id uuid,student_name text,bu_id text,percentage numeric,remarks text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not public.is_verified()
    or (select role from public.profiles where id=auth.uid()) is distinct from 'teacher'::public.app_role then
    raise exception 'Verified Teacher access required.' using errcode='42501';
  end if;
  if not exists(select 1 from public.course_offerings where id=p_offering_id and instructor_id=auth.uid()) then
    raise exception 'This course offering is not assigned to your account.' using errcode='42501';
  end if;
  return query
  select e.id,e.student_id,coalesce(p.full_name,'Student'),p.bu_id,fg.percentage,fg.remarks
  from public.course_enrollments e join public.profiles p on p.id=e.student_id
  left join public.course_final_grades fg on fg.enrollment_id=e.id
  where e.offering_id=p_offering_id order by p.full_name;
end $$;
revoke all on function public.academix_teacher_roster(uuid) from public,anon;
grant execute on function public.academix_teacher_roster(uuid) to authenticated;


-- Admins can monitor completion totals without seeing individual student ratings or comments.
create or replace function public.academix_admin_evaluation_progress(p_term_id uuid default null)
returns table(instructor_id uuid,instructor_name text,student_count bigint,completed_count bigint,completion_percent numeric)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.academix_is_active_admin() then raise exception 'Administrator access required.' using errcode='42501'; end if;
  return query
  select o.instructor_id,coalesce(p.full_name,'Assigned instructor'),
    count(distinct e.student_id),
    count(distinct e.student_id) filter(where ie.id is not null),
    case when count(distinct e.student_id)=0 then 0
      else round(100.0*count(distinct e.student_id) filter(where ie.id is not null)/count(distinct e.student_id),1) end
  from public.course_offerings o
  join public.course_enrollments e on e.offering_id=o.id
  join public.profiles p on p.id=o.instructor_id
  left join public.instructor_evaluations ie on ie.term_id=o.term_id and ie.instructor_id=o.instructor_id and ie.student_id=e.student_id
  where p_term_id is null or o.term_id=p_term_id
  group by o.instructor_id,p.full_name
  order by p.full_name;
end $$;
revoke all on function public.academix_admin_evaluation_progress(uuid) from public,anon;
grant execute on function public.academix_admin_evaluation_progress(uuid) to authenticated;


create or replace function public.academix_admin_list_people()
returns table(id uuid,full_name text,role public.app_role,bu_id text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.academix_is_active_admin() then raise exception 'Administrator access required.' using errcode='42501'; end if;
  return query select p.id,coalesce(p.full_name,'Unnamed account'),p.role,p.bu_id
    from public.profiles p where p.role in ('student'::public.app_role,'teacher'::public.app_role)
      and p.verified_at is not null and p.suspended_at is null
    order by p.role,p.full_name;
end $$;
revoke all on function public.academix_admin_list_people() from public,anon;
grant execute on function public.academix_admin_list_people() to authenticated;
) then
    raise exception 'Complete all four evaluation criteria using ratings from 1 to 5.' using errcode='22023';
  end if;
  if not exists(
    select 1 from public.course_enrollments e join public.course_offerings o on o.id=e.offering_id
    join public.academic_terms t on t.id=o.term_id
    where e.student_id=auth.uid() and o.term_id=p_term_id and o.instructor_id=p_instructor_id
  ) then raise exception 'You are not enrolled in a course taught by this instructor for the selected term.' using errcode='42501'; end if;
  insert into public.instructor_evaluations(term_id,student_id,instructor_id,ratings)
  values(p_term_id,auth.uid(),p_instructor_id,p_ratings)
  on conflict(term_id,student_id,instructor_id) do nothing
  returning id into v_id;
  if v_id is null then raise exception 'You have already evaluated this instructor for this semester.' using errcode='23505'; end if;
  return v_id;
end $$;

create or replace function public.academix_student_evaluation_targets()
returns table(term_id uuid,term_label text,instructor_id uuid,instructor_name text,courses text,submitted boolean)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not public.is_verified()
    or (select role from public.profiles where id=auth.uid()) is distinct from 'student'::public.app_role then
    raise exception 'Verified student access required.' using errcode='42501';
  end if;
  return query
  select t.id, t.academic_year || ' / ' || t.semester, o.instructor_id,
    coalesce(p.full_name,'Assigned instructor'),
    string_agg(distinct c.course_code || ' - ' || c.course_title, ', ' order by c.course_code),
    exists(select 1 from public.instructor_evaluations ie where ie.term_id=t.id and ie.student_id=auth.uid() and ie.instructor_id=o.instructor_id)
  from public.course_enrollments e
  join public.course_offerings o on o.id=e.offering_id
  join public.academic_terms t on t.id=o.term_id and t.is_active=true
  join public.academic_courses c on c.id=o.course_id
  join public.profiles p on p.id=o.instructor_id
  where e.student_id=auth.uid()
  group by t.id,t.academic_year,t.semester,o.instructor_id,p.full_name
  order by p.full_name;
end $$;

-- The final GWA is returned only after every assigned instructor has been evaluated
-- and every enrolled course has a finalized grade covered by the configured scale.
create or replace function public.academix_student_semester_gwa(p_term_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_user uuid:=auth.uid(); v_term uuid; v_missing jsonb; v_ungraded integer; v_unmapped integer;
  v_gwa numeric(5,3); v_units numeric; v_courses jsonb;
begin
  if v_user is null or not public.is_verified()
    or (select role from public.profiles where id=v_user) is distinct from 'student'::public.app_role then
    raise exception 'Verified student access required.' using errcode='42501';
  end if;
  select id into v_term from public.academic_terms where (p_term_id is null and is_active) or id=p_term_id limit 1;
  if v_term is null then return jsonb_build_object('locked',true,'reason','No active academic term is configured.'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('instructor_id',x.instructor_id,'instructor_name',x.full_name)), '[]'::jsonb)
  into v_missing
  from (
    select distinct o.instructor_id,p.full_name from public.course_enrollments e
    join public.course_offerings o on o.id=e.offering_id
    join public.profiles p on p.id=o.instructor_id
    where e.student_id=v_user and o.term_id=v_term
      and not exists(select 1 from public.instructor_evaluations ie where ie.term_id=v_term and ie.student_id=v_user and ie.instructor_id=o.instructor_id)
  ) x;
  if jsonb_array_length(v_missing)>0 then
    return jsonb_build_object('locked',true,'reason','Complete every required instructor evaluation to unlock your final GWA.','missing_evaluations',v_missing);
  end if;
  select count(*) into v_ungraded from public.course_enrollments e join public.course_offerings o on o.id=e.offering_id
  left join public.course_final_grades fg on fg.enrollment_id=e.id
  where e.student_id=v_user and o.term_id=v_term and fg.id is null;
  if v_ungraded>0 then return jsonb_build_object('locked',true,'reason','Your final course grades are not yet complete.','ungraded_courses',v_ungraded); end if;
  select count(*) into v_unmapped from public.course_enrollments e join public.course_offerings o on o.id=e.offering_id
  join public.course_final_grades fg on fg.enrollment_id=e.id
  left join public.term_grade_bands b on b.term_id=v_term and fg.percentage between b.min_percentage and b.max_percentage
  where e.student_id=v_user and o.term_id=v_term and b.id is null;
  if v_unmapped>0 then return jsonb_build_object('locked',true,'reason','The administrator has not configured a grading conversion for every final grade.','unmapped_grades',v_unmapped); end if;
  select sum(b.gwa_value*c.units)/nullif(sum(c.units),0),sum(c.units),
    jsonb_agg(jsonb_build_object('course_code',c.course_code,'course_title',c.course_title,'units',c.units,'percentage',fg.percentage,'gwa',b.gwa_value,'band',b.label) order by c.course_code)
  into v_gwa,v_units,v_courses
  from public.course_enrollments e join public.course_offerings o on o.id=e.offering_id
  join public.academic_courses c on c.id=o.course_id
  join public.course_final_grades fg on fg.enrollment_id=e.id
  join public.term_grade_bands b on b.term_id=v_term and fg.percentage between b.min_percentage and b.max_percentage
  where e.student_id=v_user and o.term_id=v_term;
  if v_gwa is null then return jsonb_build_object('locked',true,'reason','No finalized course grades are available for this term.'); end if;
  return jsonb_build_object('locked',false,'term_id',v_term,'gwa',round(v_gwa,2),'total_units',v_units,'courses',v_courses);
end $$;

-- Keep the function surface narrow. Table reads remain governed by RLS.
revoke all on function public.academix_admin_save_term(text,text,date,date,boolean) from public,anon;
revoke all on function public.academix_admin_save_course(text,text,numeric) from public,anon;
revoke all on function public.academix_admin_save_offering(uuid,uuid,uuid,text) from public,anon;
revoke all on function public.academix_admin_enroll_student(uuid,uuid) from public,anon;
revoke all on function public.academix_admin_save_grade_band(uuid,text,numeric,numeric,numeric) from public,anon;
revoke all on function public.academix_teacher_set_final_grade(uuid,numeric,text) from public,anon;
revoke all on function public.academix_student_submit_instructor_evaluation(uuid,uuid,jsonb) from public,anon;
revoke all on function public.academix_student_evaluation_targets() from public,anon;
revoke all on function public.academix_student_semester_gwa(uuid) from public,anon;
grant execute on function public.academix_admin_save_term(text,text,date,date,boolean) to authenticated;
grant execute on function public.academix_admin_save_course(text,text,numeric) to authenticated;
grant execute on function public.academix_admin_save_offering(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.academix_admin_enroll_student(uuid,uuid) to authenticated;
grant execute on function public.academix_admin_save_grade_band(uuid,text,numeric,numeric,numeric) to authenticated;
grant execute on function public.academix_teacher_set_final_grade(uuid,numeric,text) to authenticated;
grant execute on function public.academix_student_submit_instructor_evaluation(uuid,uuid,jsonb) to authenticated;
grant execute on function public.academix_student_evaluation_targets() to authenticated;
grant execute on function public.academix_student_semester_gwa(uuid) to authenticated;

comment on table public.instructor_evaluations is 'Confidential student-to-instructor evaluation submissions. Raw ratings are visible only to the submitting student through RLS; no instructor/admin raw-response policy is provided.';
comment on table public.term_grade_bands is 'Administrator-configured percentage-to-GWA conversion bands for an academic term; no BU conversion values are hard-coded.';
comment on function public.academix_student_semester_gwa(uuid) is 'Returns final GWA only after all instructors are evaluated, all course grades are finalized, and every grade maps to the active term conversion table.';


create or replace function public.academix_teacher_roster(p_offering_id uuid)
returns table(enrollment_id uuid,student_id uuid,student_name text,bu_id text,percentage numeric,remarks text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not public.is_verified()
    or (select role from public.profiles where id=auth.uid()) is distinct from 'teacher'::public.app_role then
    raise exception 'Verified Teacher access required.' using errcode='42501';
  end if;
  if not exists(select 1 from public.course_offerings where id=p_offering_id and instructor_id=auth.uid()) then
    raise exception 'This course offering is not assigned to your account.' using errcode='42501';
  end if;
  return query
  select e.id,e.student_id,coalesce(p.full_name,'Student'),p.bu_id,fg.percentage,fg.remarks
  from public.course_enrollments e join public.profiles p on p.id=e.student_id
  left join public.course_final_grades fg on fg.enrollment_id=e.id
  where e.offering_id=p_offering_id order by p.full_name;
end $$;
revoke all on function public.academix_teacher_roster(uuid) from public,anon;
grant execute on function public.academix_teacher_roster(uuid) to authenticated;


-- Admins can monitor completion totals without seeing individual student ratings or comments.
create or replace function public.academix_admin_evaluation_progress(p_term_id uuid default null)
returns table(instructor_id uuid,instructor_name text,student_count bigint,completed_count bigint,completion_percent numeric)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.academix_is_active_admin() then raise exception 'Administrator access required.' using errcode='42501'; end if;
  return query
  select o.instructor_id,coalesce(p.full_name,'Assigned instructor'),
    count(distinct e.student_id),
    count(distinct e.student_id) filter(where ie.id is not null),
    case when count(distinct e.student_id)=0 then 0
      else round(100.0*count(distinct e.student_id) filter(where ie.id is not null)/count(distinct e.student_id),1) end
  from public.course_offerings o
  join public.course_enrollments e on e.offering_id=o.id
  join public.profiles p on p.id=o.instructor_id
  left join public.instructor_evaluations ie on ie.term_id=o.term_id and ie.instructor_id=o.instructor_id and ie.student_id=e.student_id
  where p_term_id is null or o.term_id=p_term_id
  group by o.instructor_id,p.full_name
  order by p.full_name;
end $$;
revoke all on function public.academix_admin_evaluation_progress(uuid) from public,anon;
grant execute on function public.academix_admin_evaluation_progress(uuid) to authenticated;


create or replace function public.academix_admin_list_people()
returns table(id uuid,full_name text,role public.app_role,bu_id text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.academix_is_active_admin() then raise exception 'Administrator access required.' using errcode='42501'; end if;
  return query select p.id,coalesce(p.full_name,'Unnamed account'),p.role,p.bu_id
    from public.profiles p where p.role in ('student'::public.app_role,'teacher'::public.app_role)
      and p.verified_at is not null and p.suspended_at is null
    order by p.role,p.full_name;
end $$;
revoke all on function public.academix_admin_list_people() from public,anon;
grant execute on function public.academix_admin_list_people() to authenticated;
