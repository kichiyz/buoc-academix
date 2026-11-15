-- Admin-only student unenrollment for a single course offering.
-- Deleting the enrollment cascades to its course_final_grades row by the existing FK.
-- Student accounts, other course enrollments, exams, and submissions are not targeted.
create or replace function public.academix_admin_unenroll_student(p_enrollment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $unenroll$
declare
  v_deleted integer;
begin
  if not public.academix_is_active_admin() then
    raise exception 'Administrator access required.' using errcode='42501';
  end if;

  delete from public.course_enrollments
  where id = p_enrollment_id;

  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'The selected student enrollment no longer exists. Refresh the class roster.' using errcode='P0002';
  end if;

  return true;
end
$unenroll$;

revoke all on function public.academix_admin_unenroll_student(uuid) from public, anon;
grant execute on function public.academix_admin_unenroll_student(uuid) to authenticated;
