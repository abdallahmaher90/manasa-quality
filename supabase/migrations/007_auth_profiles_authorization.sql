-- =====================================================
-- PHASE P3: AUTHORIZATION UNIFICATION & SECURE RLS
-- =====================================================

-- 1. Create a private schema for internal authorization helpers
-- By default, schemas other than 'public' are NOT exposed via PostgREST in Supabase.
-- This ensures 'private' and its functions cannot be directly called via the REST API.
CREATE SCHEMA IF NOT EXISTS private;

-- Grant usage on private schema to authenticated users so they can execute functions within it during RLS
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;

-- 2. Create secure STABLE helper functions in private schema
-- Using SECURITY DEFINER to bypass caller RLS on profiles table.
-- Using SET search_path = '' to prevent search path injection attacks.

CREATE OR REPLACE FUNCTION private.get_current_user_role()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = auth.uid();
  
  RETURN COALESCE(v_role, '');
END;
$$;

CREATE OR REPLACE FUNCTION private.get_current_hospital_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hospital_id UUID;
BEGIN
  SELECT hospital_id INTO v_hospital_id
  FROM public.profiles
  WHERE id = auth.uid();
  
  RETURN v_hospital_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.is_directorate()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = auth.uid();
  
  RETURN v_role IN ('directorate_admin', 'directorate_member');
END;
$$;

CREATE OR REPLACE FUNCTION private.is_directorate_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = auth.uid();
  
  RETURN v_role = 'directorate_admin';
END;
$$;

-- Secure the functions: 
-- Authenticated users need EXECUTE so the functions can be evaluated within RLS policies.
-- Anon and PUBLIC must NOT have EXECUTE.
REVOKE EXECUTE ON FUNCTION private.get_current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.get_current_user_role() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION private.get_current_hospital_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.get_current_hospital_id() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION private.is_directorate() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_directorate() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION private.is_directorate_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_directorate_admin() TO authenticated, service_role;


-- =====================================================
-- 3. Update RLS Policies for canonical_findings
-- =====================================================

DROP POLICY IF EXISTS "Canonical findings writable by admin only" ON public.canonical_findings;
CREATE POLICY "Canonical findings writable by admin only" 
ON public.canonical_findings FOR ALL TO authenticated 
USING ((select private.is_directorate_admin()))
WITH CHECK ((select private.is_directorate_admin()));


-- =====================================================
-- 4. Update RLS Policies for report_findings
-- =====================================================

-- READ: Directorate can read all, Hospital can read own
DROP POLICY IF EXISTS "Hospital can read own report findings" ON public.report_findings;
CREATE POLICY "Users can read report findings"
ON public.report_findings FOR SELECT TO authenticated
USING (
  (select private.is_directorate()) OR hospital_id = (select private.get_current_hospital_id())
);

-- INSERT: Directorate only
DROP POLICY IF EXISTS "Directorate can insert report findings" ON public.report_findings;
CREATE POLICY "Directorate can insert report findings"
ON public.report_findings FOR INSERT TO authenticated
WITH CHECK (
  (select private.is_directorate())
);

-- UPDATE: Directorate only
-- (Hospital updates its own findings using bypass RLS via service_role in the API)
DROP POLICY IF EXISTS "Directorate can update report findings" ON public.report_findings;
CREATE POLICY "Directorate can update report findings"
ON public.report_findings FOR UPDATE TO authenticated
USING (
  (select private.is_directorate())
)
WITH CHECK (
  (select private.is_directorate())
);

-- DELETE: Admin only
DROP POLICY IF EXISTS "Admins can delete report findings" ON public.report_findings;
CREATE POLICY "Admins can delete report findings"
ON public.report_findings FOR DELETE TO authenticated
USING (
  (select private.is_directorate_admin())
);

-- NOTE: finding_match_logs remains service-role only, so we leave it alone (no policies for authenticated).
