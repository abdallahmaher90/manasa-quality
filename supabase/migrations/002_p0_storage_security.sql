-- 1. Make the bucket private
UPDATE storage.buckets
SET public = false
WHERE id = 'reports_files';

-- 2. Drop existing overly permissive policies
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Upload" ON storage.objects;

-- 3. Create strict RLS for Storage

-- Read access
CREATE POLICY "Users can view reports files" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'reports_files' AND 
    auth.role() = 'authenticated' AND
    (
      -- Directorate can see all
      (auth.jwt() -> 'app_metadata' ->> 'user_role' IN ('directorate_admin', 'directorate_member'))
      OR
      -- Hospital users can only see files in their hospital's folder
      -- Path structure: reports_files/{hospital_id}/{report_id}/filename.ext
      -- (storage.foldername(name))[1] gets the first part of the path, which is hospital_id
      (auth.jwt() -> 'app_metadata' ->> 'user_hospital_id' = (storage.foldername(name))[1])
    )
  );

-- Insert access (Upload)
CREATE POLICY "Users can upload reports files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'reports_files' AND 
    auth.role() = 'authenticated' AND
    (
      -- Directorate can upload to any folder
      (auth.jwt() -> 'app_metadata' ->> 'user_role' IN ('directorate_admin', 'directorate_member'))
      OR
      -- Hospital users can only upload to their hospital's folder
      (
        auth.jwt() -> 'app_metadata' ->> 'user_hospital_id' = (storage.foldername(name))[1]
        AND 
        auth.jwt() -> 'app_metadata' ->> 'user_role' IN ('hospital_admin', 'hospital_member')
      )
    )
  );
