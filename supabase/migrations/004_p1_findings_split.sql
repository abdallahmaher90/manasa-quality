-- =====================================================
-- PHASE P1: FINDINGS ARCHITECTURE SPLIT & PREPARATION
-- =====================================================

-- 1. Create the Canonical Findings Governance Table
CREATE TABLE IF NOT EXISTS canonical_findings (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    canonical_text TEXT NOT NULL,
    category TEXT,
    subcategory TEXT,
    severity TEXT,
    standard TEXT,
    standard_code TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('pending', 'under_review', 'active', 'rejected')),
    embedding extensions.vector(768),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_canonical_category UNIQUE (canonical_text, category)
);

ALTER TABLE canonical_findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Canonical findings readable by all" ON canonical_findings;
CREATE POLICY "Canonical findings readable by all"
ON canonical_findings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Canonical findings writable by admin only" ON canonical_findings;
CREATE POLICY "Canonical findings writable by admin only" 
ON canonical_findings FOR ALL TO authenticated 
USING ((auth.jwt() -> 'app_metadata' ->> 'user_role') = 'directorate_admin')
WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'user_role') = 'directorate_admin');

-- 1.1 Insert default fallback for truly unclassified
INSERT INTO canonical_findings (id, canonical_text, category, status)
VALUES (uuid_generate_v4(), 'غير مصنف', 'عام', 'active')
ON CONFLICT (canonical_text, category) DO NOTHING;

-- 1.2 Insert all historical distinct canonical texts to preserve legacy grouping
INSERT INTO canonical_findings (canonical_text, category, status)
SELECT DISTINCT 
    TRIM(canonical_text) as c_text,
    'عام' as category, -- Defaulting historical to 'عام' as requested
    'active' as status
FROM findings
WHERE canonical_text IS NOT NULL AND TRIM(canonical_text) != ''
ON CONFLICT (canonical_text, category) DO NOTHING;


-- 2. Create the Instance-based Report Findings Table
CREATE TABLE IF NOT EXISTS report_findings (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    report_id UUID REFERENCES reports(id) ON DELETE SET NULL, 
    last_report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
    hospital_id UUID REFERENCES hospitals(id) ON DELETE CASCADE,
    department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
    canonical_finding_id UUID REFERENCES canonical_findings(id) ON DELETE SET NULL,
    
    original_text TEXT NOT NULL,
    corrective_action TEXT,
    responsible TEXT,
    deadline TEXT,
    priority TEXT DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'resolved_by_hospital', 'resolved_confirmed', 'recurring')),
    resolution_note TEXT,
    resolved_date DATE,
    resolved_by TEXT, 
    hospital_resolution_note TEXT,
    hospital_resolution_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE report_findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hospital can read own report findings" ON report_findings;
CREATE POLICY "Hospital can read own report findings"
ON report_findings FOR SELECT TO authenticated
USING (
  (auth.jwt() -> 'app_metadata' ->> 'user_hospital_id')::uuid = hospital_id 
  OR (auth.jwt() -> 'app_metadata' ->> 'user_role') IN ('directorate_admin', 'directorate_member')
);

DROP POLICY IF EXISTS "Directorate can insert report findings" ON report_findings;
CREATE POLICY "Directorate can insert report findings"
ON report_findings FOR INSERT TO authenticated
WITH CHECK (
  (auth.jwt() -> 'app_metadata' ->> 'user_role') IN ('directorate_admin', 'directorate_member')
);

DROP POLICY IF EXISTS "Directorate can update report findings" ON report_findings;
CREATE POLICY "Directorate can update report findings"
ON report_findings FOR UPDATE TO authenticated
USING (
  (auth.jwt() -> 'app_metadata' ->> 'user_role') IN ('directorate_admin', 'directorate_member')
)
WITH CHECK (
  (auth.jwt() -> 'app_metadata' ->> 'user_role') IN ('directorate_admin', 'directorate_member')
);

DROP POLICY IF EXISTS "Admins can delete report findings" ON report_findings;
CREATE POLICY "Admins can delete report findings"
ON report_findings FOR DELETE TO authenticated
USING (
  (auth.jwt() -> 'app_metadata' ->> 'user_role') = 'directorate_admin'
);


-- 3. Initial Data Migration from the old `findings` table
INSERT INTO report_findings (
    id, report_id, last_report_id, hospital_id, department_id, canonical_finding_id,
    original_text, corrective_action, responsible, deadline, priority,
    status, resolution_note, resolved_date, resolved_by, 
    hospital_resolution_note, hospital_resolution_date,
    created_at, updated_at
)
SELECT 
    f.id,
    f.report_id,
    f.last_report_id,
    f.hospital_id,
    f.department_id,
    
    -- Map to the newly created historical canonical finding, or fallback to 'غير مصنف'
    COALESCE(
        (SELECT id FROM canonical_findings cf WHERE cf.canonical_text = TRIM(f.canonical_text) AND cf.category = 'عام' LIMIT 1),
        (SELECT id FROM canonical_findings WHERE canonical_text = 'غير مصنف' AND category = 'عام' LIMIT 1)
    ),
    
    COALESCE(NULLIF(TRIM(f.original_text), ''), 'غير محدد'),
    f.corrective_action,
    f.responsible,
    f.deadline,
    CASE 
      WHEN LOWER(f.priority) IN ('high', 'medium', 'low') THEN LOWER(f.priority)
      ELSE 'medium' 
    END,
    f.status,
    f.resolution_note,
    f.resolved_date,
    f.resolved_by,
    f.hospital_resolution_note,
    f.hospital_resolution_date,
    f.created_at,
    f.updated_at
FROM findings f
ON CONFLICT (id) DO NOTHING;
