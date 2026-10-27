-- BUOC AcademiX: allow verified platform admins to inspect exam/submission metadata.
-- This is a narrow, read-only RLS fix for the Developer Control Center's
-- Exam Registry and Results Inspector. It does not grant write access or expose
-- question answer keys.
begin;

drop policy if exists "admins read exam registry" on public.exams;
create policy "admins read exam registry"
on public.exams
for select
to authenticated
using (public.current_role() = 'admin');

drop policy if exists "admins read submissions inspector" on public.submissions;
create policy "admins read submissions inspector"
on public.submissions
for select
to authenticated
using (public.current_role() = 'admin');

commit;
