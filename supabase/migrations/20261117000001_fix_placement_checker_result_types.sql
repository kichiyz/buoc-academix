-- Fix the placement-checker RPC return types.
-- auth.users.email is varchar, while the RPC contract declares email as text.
-- Explicit casts keep every RETURN QUERY column exactly aligned with RETURNS TABLE.

CREATE OR REPLACE FUNCTION public.academix_admin_list_unassigned_students()
RETURNS TABLE(
  student_id uuid,
  full_name text,
  bu_id text,
  email text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.academix_is_active_admin() THEN
    RAISE EXCEPTION 'Administrator access required.'
      USING errcode = '42501';
  END IF;

  RETURN QUERY
    SELECT
      p.id::uuid,
      p.full_name::text,
      p.bu_id::text,
      u.email::text,
      p.created_at::timestamptz
    FROM public.profiles AS p
    JOIN auth.users AS u ON u.id = p.id
    WHERE p.role = 'student'::public.app_role
      AND p.suspended_at IS NULL
      AND (
        p.campus_id IS NULL
        OR p.college_id IS NULL
        OR p.program_id IS NULL
        OR p.year_level IS NULL
        OR p.block_code IS NULL
      )
    ORDER BY p.full_name;
END;
$$;

REVOKE ALL ON FUNCTION public.academix_admin_list_unassigned_students()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.academix_admin_list_unassigned_students()
  TO authenticated;
