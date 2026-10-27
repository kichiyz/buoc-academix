-- Allow authenticated users to perform question writes only where the existing
-- teacher-owned-exam RLS policy permits them. Do not grant anonymous access.
grant insert, update, delete on table public.questions to authenticated;
