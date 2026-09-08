-- We enforce the business rule: One hospital cannot have two reports on the EXACT same day.
-- This prevents race conditions during upload.

-- Clean up any existing duplicates before adding constraint to avoid errors
-- We will keep the latest report (by created_at) and delete the rest
DELETE FROM reports a USING reports b
WHERE a.id < b.id 
  AND a.hospital_id = b.hospital_id 
  AND a.inspection_date = b.inspection_date;

-- Add unique constraint
ALTER TABLE reports ADD CONSTRAINT unique_hospital_date UNIQUE (hospital_id, inspection_date);

-- Add file_hash column to reports to prepare for strict file duplication prevention later
ALTER TABLE reports ADD COLUMN IF NOT EXISTS file_hash TEXT;
