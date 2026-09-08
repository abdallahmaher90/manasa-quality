-- 1. Create the Custom Access Token Hook
-- This function will be called by Supabase Auth before issuing a JWT
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
  DECLARE
    claims jsonb;
    user_role text;
    user_hospital_id text;
  BEGIN
    -- Fetch the role and hospital_id from the profiles table
    SELECT role, hospital_id::text INTO user_role, user_hospital_id 
    FROM public.profiles 
    WHERE id = (event->>'user_id')::uuid;

    claims := event->'claims';

    IF user_role IS NOT NULL THEN
      -- Inject the role into app_metadata inside the claims
      claims := jsonb_set(claims, '{app_metadata, user_role}', to_jsonb(user_role));
    END IF;

    IF user_hospital_id IS NOT NULL THEN
      claims := jsonb_set(claims, '{app_metadata, user_hospital_id}', to_jsonb(user_hospital_id));
    END IF;

    -- Update the event object with the modified claims
    event := jsonb_set(event, '{claims}', claims);
    
    RETURN event;
  END;
$$;

-- Grant execute permissions so Supabase Auth can run it
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
-- Allow the hook to read profiles
GRANT SELECT ON TABLE public.profiles TO supabase_auth_admin;

-- 2. Secure the profiles table updates
-- We drop the naive UPDATE policy and replace it with a secure one.
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

-- Users can still update their name, but a trigger will prevent modifying role or hospital_id
-- unless they are a directorate admin.
CREATE OR REPLACE FUNCTION protect_profile_sensitive_fields()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if sensitive fields are being changed
  IF (OLD.role IS DISTINCT FROM NEW.role) OR (OLD.hospital_id IS DISTINCT FROM NEW.hospital_id) THEN
    -- If this is being executed by a logged-in user via API (not service role/admin)
    IF auth.uid() IS NOT NULL THEN
      -- Only directorate admins can change roles or hospital assignments
      -- We check the JWT claims for the role
      IF (auth.jwt() -> 'app_metadata' ->> 'user_role') NOT IN ('directorate_admin', 'directorate_member') THEN
         RAISE EXCEPTION 'Unauthorized: Cannot modify role or hospital_id fields';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS ensure_profile_security ON profiles;
CREATE TRIGGER ensure_profile_security
BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE PROCEDURE protect_profile_sensitive_fields();

-- Restore a secure update policy: users can update their own row (but trigger protects sensitive columns)
CREATE POLICY "Users can update own profile (restricted)" ON profiles
  FOR UPDATE USING (auth.uid() = id);
