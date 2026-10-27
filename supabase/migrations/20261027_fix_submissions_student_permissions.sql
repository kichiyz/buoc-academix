-- Allow authenticated users to read submissions only where existing RLS policies permit,
-- and create only their own in-progress submissions through the existing RLS policy.
-- Do not grant direct UPDATE or DELETE; final submission/grading must use trusted RPCs.
grant select, insert on table public.submissions to authenticated;
