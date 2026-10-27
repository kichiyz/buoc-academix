-- BUOC AcademiX Phase 5: Identity & Access controls.
-- Apply only after reviewing in the isolated local/test Supabase project first.
-- This migration does not delete accounts or alter Auth credentials.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspension_reason text
    CHECK (suspension_reason IS NULL OR char_length(suspension_reason) <= 500);

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_user_id uuid,
  action text NOT NULL CHECK (action IN (
    'role_changed', 'account_suspended', 'account_reactivated'
  )),
  outcome text NOT NULL DEFAULT 'success' CHECK (outcome IN ('success')),
  reason text NOT NULL CHECK (char_length(trim(reason)) BETWEEN 3 AND 500),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_target_created_idx
  ON public.admin_audit_log(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_actor_created_idx
  ON public.admin_audit_log(actor_id, created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_audit_log FROM anon, authenticated;
GRANT SELECT ON public.admin_audit_log TO authenticated;

DROP POLICY IF EXISTS "Admins read identity audit log" ON public.admin_audit_log;
CREATE POLICY "Admins read identity audit log"
ON public.admin_audit_log
FOR SELECT TO authenticated
USING (public.current_role() = 'admin'::public.app_role);

-- Keep existing verification semantics, but deny exam access to suspended accounts.
CREATE OR REPLACE FUNCTION public.is_verified()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND verified_at IS NOT NULL
      AND suspended_at IS NULL
  )
$$;

-- Search is performed server-side so the browser never needs direct access to auth.users.
CREATE OR REPLACE FUNCTION public.admin_search_accounts(p_query text DEFAULT NULL, p_limit integer DEFAULT 25)
RETURNS TABLE (
  id uuid,
  email text,
  full_name text,
  role public.app_role,
  bu_id text,
  verified_at timestamptz,
  suspended_at timestamptz,
  suspension_reason text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_query text := lower(trim(coalesce(p_query, '')));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'::public.app_role
  ) THEN
    RAISE EXCEPTION 'Administrator access required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT p.id, u.email::text, p.full_name, p.role, p.bu_id,
         p.verified_at, p.suspended_at, p.suspension_reason, p.created_at
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE v_query = ''
     OR lower(coalesce(u.email, '')) LIKE '%' || replace(replace(replace(v_query, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'
     OR lower(p.full_name) LIKE '%' || replace(replace(replace(v_query, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'
     OR lower(coalesce(p.bu_id, '')) LIKE '%' || replace(replace(replace(v_query, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'
  ORDER BY p.created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 25), 50));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_search_accounts(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_accounts(text, integer) TO authenticated;

-- One audited, server-authorized entry point for role changes and suspension state.
CREATE OR REPLACE FUNCTION public.admin_manage_account(
  p_target_user_id uuid,
  p_action text,
  p_new_role public.app_role DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_role public.app_role;
  v_target public.profiles%rowtype;
  v_reason text := trim(coalesce(p_reason, ''));
  v_old_role public.app_role;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.profiles
  WHERE id = v_actor;

  IF v_actor_role IS DISTINCT FROM 'admin'::public.app_role THEN
    RAISE EXCEPTION 'Administrator access required.' USING ERRCODE = '42501';
  END IF;

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Target account is required.' USING ERRCODE = '22023';
  END IF;

  IF p_target_user_id = v_actor THEN
    RAISE EXCEPTION 'You cannot change your own role or suspend your own account.' USING ERRCODE = '42501';
  END IF;

  IF char_length(v_reason) < 3 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Provide a reason between 3 and 500 characters.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_target
  FROM public.profiles
  WHERE id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target account not found.' USING ERRCODE = 'P0002';
  END IF;

  v_old_role := v_target.role;

  IF p_action = 'change_role' THEN
    IF p_new_role IS NULL THEN
      RAISE EXCEPTION 'A new role is required.' USING ERRCODE = '22023';
    END IF;

    IF v_target.role = 'admin'::public.app_role
       AND p_new_role <> 'admin'::public.app_role
       AND (SELECT count(*) FROM public.profiles WHERE role = 'admin'::public.app_role) <= 1 THEN
      RAISE EXCEPTION 'Cannot demote the last administrator.' USING ERRCODE = '42501';
    END IF;

    IF v_target.role = p_new_role THEN
      RAISE EXCEPTION 'The account already has that role.' USING ERRCODE = '22023';
    END IF;

    UPDATE public.profiles SET role = p_new_role WHERE id = p_target_user_id;

    INSERT INTO public.admin_audit_log(actor_id, target_user_id, action, reason, details)
    VALUES (v_actor, p_target_user_id, 'role_changed', v_reason,
      jsonb_build_object('old_role', v_old_role, 'new_role', p_new_role));

  ELSIF p_action = 'suspend' THEN
    IF v_target.suspended_at IS NOT NULL THEN
      RAISE EXCEPTION 'This account is already suspended.' USING ERRCODE = '22023';
    END IF;

    IF v_target.role = 'admin'::public.app_role
       AND (SELECT count(*) FROM public.profiles WHERE role = 'admin'::public.app_role AND suspended_at IS NULL) <= 1 THEN
      RAISE EXCEPTION 'Cannot suspend the last active administrator.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.profiles
    SET suspended_at = clock_timestamp(), suspension_reason = v_reason
    WHERE id = p_target_user_id;

    INSERT INTO public.admin_audit_log(actor_id, target_user_id, action, reason, details)
    VALUES (v_actor, p_target_user_id, 'account_suspended', v_reason,
      jsonb_build_object('role', v_target.role));

  ELSIF p_action = 'reactivate' THEN
    IF v_target.suspended_at IS NULL THEN
      RAISE EXCEPTION 'This account is not suspended.' USING ERRCODE = '22023';
    END IF;

    UPDATE public.profiles
    SET suspended_at = NULL, suspension_reason = NULL
    WHERE id = p_target_user_id;

    INSERT INTO public.admin_audit_log(actor_id, target_user_id, action, reason, details)
    VALUES (v_actor, p_target_user_id, 'account_reactivated', v_reason,
      jsonb_build_object('role', v_target.role));

  ELSE
    RAISE EXCEPTION 'Unsupported action. Use change_role, suspend, or reactivate.' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'action', p_action,
    'target_user_id', p_target_user_id,
    'previous_role', v_old_role,
    'new_role', CASE WHEN p_action = 'change_role' THEN p_new_role ELSE v_target.role END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_manage_account(uuid, text, public.app_role, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_manage_account(uuid, text, public.app_role, text) TO authenticated;

COMMENT ON TABLE public.admin_audit_log IS
  'Append-only identity/access audit events. Written only by SECURITY DEFINER admin RPCs.';
