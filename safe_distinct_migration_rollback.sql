-- SAFE DISTINCT ROLLBACK
BEGIN;

UPDATE report_findings
SET recurrence_group_id = 'd96cc381-d6df-4556-9abd-b73c36864096', updated_at = NOW()
WHERE id = '1ebd9c93-5109-47ea-878a-2df65dc71518' AND recurrence_group_id = 'cd30ccdd-0812-4b5e-a386-ca10d64e4d41';

UPDATE report_findings
SET recurrence_group_id = NULL, updated_at = NOW()
WHERE id = '63c41f52-dd9c-4a92-bcee-f8937d7e46bc' AND recurrence_group_id = '4721c3ee-5aea-4b7a-ad1f-9fa6b46f8526';

UPDATE report_findings
SET recurrence_group_id = NULL, updated_at = NOW()
WHERE id = '8a72c2b7-b2ab-4c21-82e3-08b49d8ce192' AND recurrence_group_id = 'a1e33baf-658d-4d2b-a67b-ac2e16183157';

-- Note: We do not delete the new groups to avoid cascade issues. They will remain as orphans temporarily.

COMMIT;
