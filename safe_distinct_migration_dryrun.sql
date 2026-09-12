-- SAFE DISTINCT MIGRATION (DRY RUN)
-- Generated at: 2026-09-11T20:48:26.120Z

BEGIN;

CREATE TEMP TABLE _safe_distinct_migration_plan (
    finding_id UUID PRIMARY KEY,
    old_group_id UUID,
    new_group_id UUID
) ON COMMIT DROP;

INSERT INTO _safe_distinct_migration_plan (finding_id, old_group_id, new_group_id)
VALUES ('1ebd9c93-5109-47ea-878a-2df65dc71518', 'd96cc381-d6df-4556-9abd-b73c36864096', 'cd30ccdd-0812-4b5e-a386-ca10d64e4d41');

INSERT INTO _safe_distinct_migration_plan (finding_id, old_group_id, new_group_id)
VALUES ('63c41f52-dd9c-4a92-bcee-f8937d7e46bc', NULL, '4721c3ee-5aea-4b7a-ad1f-9fa6b46f8526');

INSERT INTO _safe_distinct_migration_plan (finding_id, old_group_id, new_group_id)
VALUES ('8a72c2b7-b2ab-4c21-82e3-08b49d8ce192', NULL, 'a1e33baf-658d-4d2b-a67b-ac2e16183157');

-- 1. INSERT NEW GROUPS
INSERT INTO recurrence_groups (id, title, normalized_key, confidence, review_status, matching_policy_version)
VALUES ('cd30ccdd-0812-4b5e-a386-ca10d64e4d41', 'غرفة الأرشيف غير مطابقة للمواصفات', 'غرفه الارشيف غير مطابقه للمواصفات', 'HIGH', 'REVIEWED_SAFE', 'v4')
ON CONFLICT (id) DO NOTHING;

INSERT INTO recurrence_groups (id, title, normalized_key, confidence, review_status, matching_policy_version)
VALUES ('4721c3ee-5aea-4b7a-ad1f-9fa6b46f8526', 'يوجد ألات منتهية التعقيم و آخري منتهية التطهير', 'يوجد الات منتهيه التعقيم و اخري منتهيه التطهير', 'HIGH', 'REVIEWED_SAFE', 'v4')
ON CONFLICT (id) DO NOTHING;

INSERT INTO recurrence_groups (id, title, normalized_key, confidence, review_status, matching_policy_version)
VALUES ('a1e33baf-658d-4d2b-a67b-ac2e16183157', 'سجل التسليم و التسلم للتعقيم غير مكتمل وقت و تاريخ الاستلام للآلات المعقمة و تسليم الآلات الملوثة للتعقيم', 'سجل التسليم و التسلم للتعقيم غير مكتمل وقت و تاريخ الاستلام للالات المعقمه و تسليم الالات الملوثه للتعقيم', 'HIGH', 'REVIEWED_SAFE', 'v4')
ON CONFLICT (id) DO NOTHING;

-- 2. GUARDED UPDATES
UPDATE report_findings
SET recurrence_group_id = 'cd30ccdd-0812-4b5e-a386-ca10d64e4d41', updated_at = NOW()
WHERE id = '1ebd9c93-5109-47ea-878a-2df65dc71518'
AND recurrence_group_id IS NOT DISTINCT FROM 'd96cc381-d6df-4556-9abd-b73c36864096';

UPDATE report_findings
SET recurrence_group_id = '4721c3ee-5aea-4b7a-ad1f-9fa6b46f8526', updated_at = NOW()
WHERE id = '63c41f52-dd9c-4a92-bcee-f8937d7e46bc'
AND recurrence_group_id IS NOT DISTINCT FROM NULL;

UPDATE report_findings
SET recurrence_group_id = 'a1e33baf-658d-4d2b-a67b-ac2e16183157', updated_at = NOW()
WHERE id = '8a72c2b7-b2ab-4c21-82e3-08b49d8ce192'
AND recurrence_group_id IS NOT DISTINCT FROM NULL;

-- 3. ASSERTIONS
DO $$
DECLARE
    v_total_findings INT;
    v_updated_findings INT;
BEGIN
    SELECT COUNT(*) INTO v_total_findings FROM report_findings;
    IF v_total_findings != 1366 THEN
        RAISE EXCEPTION 'Total findings changed! Expected 1366, got %', v_total_findings;
    END IF;

    SELECT COUNT(*) INTO v_updated_findings
    FROM report_findings f
    JOIN _safe_distinct_migration_plan p ON f.id = p.finding_id
    WHERE f.recurrence_group_id = p.new_group_id;

    IF v_updated_findings != 3 THEN
        RAISE EXCEPTION 'Expected 3 updated findings, got %', v_updated_findings;
    END IF;
END $$;

ROLLBACK;
