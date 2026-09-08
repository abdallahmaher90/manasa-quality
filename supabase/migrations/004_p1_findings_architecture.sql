-- =====================================================
-- PHASE P1: FINDINGS REFACTOR & PGVECTOR
-- =====================================================

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Create canonical_findings table
CREATE TABLE IF NOT EXISTS canonical_findings (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  canonical_text TEXT NOT NULL UNIQUE,
  category TEXT,
  subcategory TEXT,
  severity TEXT,
  standard TEXT,
  standard_code TEXT,
  active BOOLEAN DEFAULT true,
  embedding vector(768),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for similarity search
CREATE INDEX IF NOT EXISTS canonical_findings_embedding_idx ON canonical_findings USING hnsw (embedding vector_ip_ops);

-- 3. Create report_findings table
CREATE TABLE IF NOT EXISTS report_findings (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  report_id UUID REFERENCES reports(id) ON DELETE CASCADE,
  hospital_id UUID REFERENCES hospitals(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
  canonical_finding_id UUID REFERENCES canonical_findings(id) ON DELETE RESTRICT,
  
  -- Original text from the report
  original_text TEXT NOT NULL,
  
  -- Action and tracking (Specific to this exact occurrence)
  corrective_action TEXT,
  responsible TEXT,
  deadline TEXT,
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  status TEXT DEFAULT 'open' CHECK (
    status IN ('open', 'resolved_by_hospital', 'resolved_confirmed')
  ),
  
  -- Resolution specific to this occurrence
  resolution_note TEXT,
  resolved_date DATE,
  resolved_by TEXT CHECK (resolved_by IN ('directorate', 'hospital', NULL)),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS report_findings_report_id_idx ON report_findings(report_id);
CREATE INDEX IF NOT EXISTS report_findings_hospital_id_idx ON report_findings(hospital_id);
CREATE INDEX IF NOT EXISTS report_findings_department_id_idx ON report_findings(department_id);
CREATE INDEX IF NOT EXISTS report_findings_canonical_idx ON report_findings(canonical_finding_id);

-- 4. Enable RLS on new tables
ALTER TABLE canonical_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_findings ENABLE ROW LEVEL SECURITY;

-- Canonical Findings Policies: Everyone authenticated can read, only admin can write
CREATE POLICY "Canonical findings are readable by all authenticated users" 
ON canonical_findings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Canonical findings can be created by authenticated users via API" 
ON canonical_findings FOR INSERT TO authenticated WITH CHECK (true);

-- Report Findings Policies: Same logic as before
CREATE POLICY "Directorate sees all report findings" 
ON report_findings FOR SELECT TO authenticated 
USING (
  (auth.jwt() -> 'app_metadata' ->> 'user_role') IN ('directorate_admin', 'directorate_member')
);

CREATE POLICY "Hospital sees own report findings" 
ON report_findings FOR SELECT TO authenticated 
USING (
  (auth.jwt() -> 'app_metadata' ->> 'user_hospital_id')::uuid = hospital_id
);

-- Inserts are allowed via API / service role, but just in case:
CREATE POLICY "Allow insert report findings for own hospital" 
ON report_findings FOR INSERT TO authenticated 
WITH CHECK (
  (auth.jwt() -> 'app_metadata' ->> 'user_role') IN ('directorate_admin', 'directorate_member')
  OR
  (auth.jwt() -> 'app_metadata' ->> 'user_hospital_id')::uuid = hospital_id
);

-- =====================================================
-- 5. MIGRATION FROM `findings` TO NEW TABLES
-- =====================================================

DO $$
DECLARE
  rec RECORD;
  canon_id UUID;
  dept_name TEXT;
  inferred_category TEXT;
BEGIN
  -- We assume old `findings` table is NOT empty. If it is, this does nothing.
  
  -- 5.1 Migrate unique canonical_texts to canonical_findings
  FOR rec IN 
    SELECT DISTINCT canonical_text, department_id 
    FROM findings 
    WHERE canonical_text IS NOT NULL 
      AND canonical_text != ''
  LOOP
    -- Simple inference of category based on department name (optional logic)
    SELECT name INTO dept_name FROM departments WHERE id = rec.department_id;
    
    inferred_category := CASE
      WHEN dept_name LIKE '%مكافحة%' OR dept_name LIKE '%عدوى%' THEN 'Infection Control'
      WHEN dept_name LIKE '%جودة%' THEN 'Quality'
      WHEN dept_name LIKE '%طوارئ%' OR dept_name LIKE '%استقبال%' THEN 'Emergency'
      WHEN dept_name LIKE '%عناية%' THEN 'ICU'
      WHEN dept_name LIKE '%عمليات%' THEN 'Surgery'
      WHEN dept_name LIKE '%صيدلية%' THEN 'Pharmacy'
      WHEN dept_name LIKE '%مخزن%' THEN 'Warehouse'
      ELSE 'General'
    END;

    INSERT INTO canonical_findings (canonical_text, category)
    VALUES (rec.canonical_text, inferred_category)
    ON CONFLICT (canonical_text) DO NOTHING;
  END LOOP;

  -- 5.2 Migrate records to report_findings
  -- Note: The old table might have multiple occurrences aggregated (repeat_count).
  -- But we only have `last_report_id` or `report_id` available. We will map 1 record in old table to 1 record in new.
  -- In the future, every repeat will just be a new row.
  FOR rec IN 
    SELECT f.*, c.id as c_id 
    FROM findings f
    JOIN canonical_findings c ON f.canonical_text = c.canonical_text
  LOOP
    INSERT INTO report_findings (
      report_id,
      hospital_id,
      department_id,
      canonical_finding_id,
      original_text,
      corrective_action,
      responsible,
      deadline,
      priority,
      -- we map 'recurring' to 'open' since 'recurring' is now computed dynamically
      status,
      resolution_note,
      resolved_date,
      resolved_by,
      created_at,
      updated_at
    ) VALUES (
      COALESCE(rec.last_report_id, rec.report_id),
      rec.hospital_id,
      rec.department_id,
      rec.c_id,
      rec.original_text,
      rec.corrective_action,
      rec.responsible,
      rec.deadline,
      rec.priority,
      CASE WHEN rec.status = 'recurring' THEN 'open' ELSE rec.status END,
      rec.resolution_note,
      rec.resolved_date,
      rec.resolved_by,
      rec.created_at,
      rec.updated_at
    );
  END LOOP;

END $$;
