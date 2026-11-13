-- Phase 7 foundation: assessment authoring metadata and visual question payloads.
-- Additive migration; preserves all existing exams and submissions.
alter table public.exams
  add column if not exists exam_mode text not null default 'freeroam'
    check (exam_mode in ('freeroam','sequential')),
  add column if not exists assessment_category text not null default 'quiz'
    check (assessment_category in ('quiz','long_test','midterm','final','other')),
  add column if not exists grade_weight_percent numeric(5,2)
    check (grade_weight_percent is null or (grade_weight_percent >= 0 and grade_weight_percent <= 100));

alter table public.questions
  add column if not exists visual_data jsonb not null default '{}'::jsonb;

comment on column public.exams.exam_mode is 'freeroam permits revisiting questions; sequential requires an answer before proceeding and disallows revisiting.';
comment on column public.exams.grade_weight_percent is 'Teacher-defined contribution of this assessment to the course final grade, from 0 to 100.';
comment on column public.questions.visual_data is 'Optional structured math/diagram/chart payload; never contains answer keys.';
