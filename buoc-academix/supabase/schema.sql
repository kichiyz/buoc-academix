-- BUOC AcademiX schema. Apply in Supabase SQL Editor.
-- IMPORTANT: Supabase Auth owns identities. public.profiles is the app profile table.
create extension if not exists pgcrypto;

create type public.app_role as enum ('student','teacher','admin');
create type public.exam_status as enum ('draft','published','archived');
create type public.submission_status as enum ('in_progress','submitted','graded');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 120),
  role public.app_role not null default 'student',
  bu_id text,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.exams (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id),
  title text not null check (char_length(title) between 1 and 160),
  duration_minutes int not null default 30 check (duration_minutes between 1 and 300),
  status public.exam_status not null default 'draft',
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  position int not null check (position > 0),
  question_type text not null check (question_type in ('multiple_choice','true_false')),
  prompt text not null check (char_length(prompt) between 1 and 3000),
  options jsonb not null default '[]'::jsonb,
  -- Never expose this column to students. RLS alone cannot hide individual columns;
  -- student-facing reads go through the safe view/RPC below.
  correct_answer jsonb not null,
  explanation text,
  points numeric(7,2) not null default 1 check (points > 0 and points <= 100),
  unique(exam_id, position)
);

create table public.exam_assignments (
  exam_id uuid not null references public.exams(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key(exam_id, student_id)
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status public.submission_status not null default 'in_progress',
  answers jsonb not null default '{}'::jsonb,
  score numeric(9,2),
  max_score numeric(9,2),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  graded_at timestamptz,
  unique(exam_id, student_id),
  check (score is null or score >= 0),
  check (max_score is null or max_score >= 0)
);

-- Compatibility with the requested grades table; one row per graded submission.
create table public.grades (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  score numeric(9,2) not null check (score >= 0),
  max_score numeric(9,2) not null check (max_score >= 0),
  feedback text,
  graded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (score <= max_score)
);

create index exams_teacher_status_idx on public.exams(teacher_id,status);
create index assignments_student_idx on public.exam_assignments(student_id);
create index submissions_student_idx on public.submissions(student_id,submitted_at);
create index grades_student_idx on public.grades(student_id,created_at desc);

alter table public.profiles enable row level security;
alter table public.exams enable row level security;
alter table public.questions enable row level security;
alter table public.exam_assignments enable row level security;
alter table public.submissions enable row level security;
alter table public.grades enable row level security;

-- Role changes and verified_at are deliberately NOT writable by ordinary users.
create or replace function public.current_role()
returns public.app_role language sql stable security definer
set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_verified()
returns boolean language sql stable security definer
set search_path = public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and verified_at is not null) $$;

create policy "profiles read self or teachers see verified student roster"
on public.profiles for select to authenticated
using (id = auth.uid() or (public.current_role() in ('teacher','admin') and role='student'));

create policy "profiles create own student profile"
on public.profiles for insert to authenticated
with check (id = auth.uid() and role = 'student' and verified_at is null);

-- No client-side profile UPDATE policy is created. This prevents users from
-- changing privileged fields (role/verified_at); profile edits can be added later
-- through a narrowly scoped RPC that only accepts approved fields.

create policy "teachers manage their exams"
on public.exams for all to authenticated
using (teacher_id=auth.uid() and public.current_role() in ('teacher','admin'))
with check (teacher_id=auth.uid() and public.current_role() in ('teacher','admin'));

create policy "students see published assigned exams"
on public.exams for select to authenticated
using (status='published' and public.is_verified() and exists(
  select 1 from public.exam_assignments a where a.exam_id=exams.id and a.student_id=auth.uid()
));

create policy "teachers manage questions for own exams"
on public.questions for all to authenticated
using (exists(select 1 from public.exams e where e.id=questions.exam_id and e.teacher_id=auth.uid()
  and public.current_role() in ('teacher','admin')))
with check (exists(select 1 from public.exams e where e.id=questions.exam_id and e.teacher_id=auth.uid()
  and public.current_role() in ('teacher','admin')));

-- Do not create a student SELECT policy on questions: RLS filters rows, not columns,
-- and direct table reads could expose correct_answer. Students use get_exam_questions().

create policy "teachers manage assignments for own exams"
on public.exam_assignments for all to authenticated
using (exists(select 1 from public.exams e where e.id=exam_assignments.exam_id and e.teacher_id=auth.uid()
  and public.current_role() in ('teacher','admin')))
with check (exists(select 1 from public.exams e where e.id=exam_assignments.exam_id and e.teacher_id=auth.uid()
  and public.current_role() in ('teacher','admin')));

create policy "students see own assignments"
on public.exam_assignments for select to authenticated
using (student_id=auth.uid());

create policy "students read own submissions"
on public.submissions for select to authenticated
using (student_id=auth.uid());

create policy "students create own submission"
on public.submissions for insert to authenticated
with check (student_id=auth.uid() and status='in_progress' and score is null and graded_at is null
  and exists(select 1 from public.exam_assignments a join public.exams e on e.id=a.exam_id
    where a.exam_id=submissions.exam_id and a.student_id=auth.uid() and e.status='published' and public.is_verified()));

-- Clients cannot write score/status/submitted_at fields freely. Submission writes should use RPC.
create policy "teachers read submissions for own exams"
on public.submissions for select to authenticated
using (exists(select 1 from public.exams e where e.id=submissions.exam_id and e.teacher_id=auth.uid()
  and public.current_role() in ('teacher','admin')));

create policy "students read own grades"
on public.grades for select to authenticated
using (student_id=auth.uid());

create policy "teachers read grades for own exams"
on public.grades for select to authenticated
using (exists(select 1 from public.exams e where e.id=grades.exam_id and e.teacher_id=auth.uid()
  and public.current_role() in ('teacher','admin')));

-- Do not grant students direct INSERT/UPDATE on grades. Trusted grading is server-side.
revoke insert, update, delete on public.grades from anon, authenticated;
revoke update, delete on public.submissions from anon, authenticated;

-- Safe question RPC deliberately omits correct_answer and explanation.
create or replace function public.get_exam_questions(p_exam_id uuid)
returns table(id uuid, question_position int, question_type text, prompt text, options jsonb, points numeric)
language sql stable security invoker
set search_path = public
as $
  select q.id,q.position,q.question_type,q.prompt,q.options,q.points
  from public.questions q join public.exams e on e.id=q.exam_id
  join public.exam_assignments a on a.exam_id=e.id
  where q.exam_id=p_exam_id and a.student_id=auth.uid() and e.status='published' and public.is_verified()
  order by q.position
$$;
grant execute on function public.get_exam_questions(uuid) to authenticated;
-- Limit direct table reads to non-secret columns. Teacher answer-key retrieval should be
-- added as a separate teacher-only RPC if needed; do not grant table-level SELECT.
revoke select on public.questions from anon, authenticated;
grant select (id, exam_id, position, question_type, prompt, options, explanation, points)
  on public.questions to authenticated;

-- Profile creation trigger ignores user-supplied role metadata: everyone starts as a student.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  insert into public.profiles(id,full_name,role,bu_id)
  values(new.id, coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email,'@',1)),
         'student', nullif(new.raw_user_meta_data->>'bu_id',''))
  on conflict(id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Production follow-up: implement submit_exam() as a SECURITY DEFINER RPC that
-- validates assignment, locks the attempt, grades against correct_answer server-side,
-- writes submissions + grades atomically, and returns only the resulting score.
-- Never expose service_role credentials in browser code. Assign teachers/admins and
-- verified_at through a trusted admin workflow, not client-side metadata.
