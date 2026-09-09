-- ============================================================================
-- 008_p4_recurrence_groups_and_engine.sql
-- MANASA: RECURRENCE GROUPS & UNIFIED MATCHING ENGINE (POLICY V1)
-- ============================================================================

-- 1. Create recurrence_groups table
CREATE TABLE IF NOT EXISTS public.recurrence_groups (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    normalized_key TEXT NOT NULL,
    entity TEXT,
    defect TEXT,
    domain TEXT,
    confidence TEXT DEFAULT 'HIGH_CONFIDENCE',
    review_status TEXT DEFAULT 'confirmed', -- 'confirmed', 'pending_review', 'confirmed_separate', 'single'
    matching_policy_version TEXT DEFAULT 'RECURRENCE_MATCHING_POLICY_V1',
    embedding extensions.vector(768),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for exact normalized key lookups
CREATE INDEX IF NOT EXISTS idx_recurrence_groups_norm_key ON public.recurrence_groups(normalized_key);
CREATE INDEX IF NOT EXISTS idx_recurrence_groups_review_status ON public.recurrence_groups(review_status);

-- Enable RLS on recurrence_groups
ALTER TABLE public.recurrence_groups ENABLE ROW LEVEL SECURITY;

-- Allow read access to authenticated users
DROP POLICY IF EXISTS "Allow authenticated read on recurrence_groups" ON public.recurrence_groups;
CREATE POLICY "Allow authenticated read on recurrence_groups" 
ON public.recurrence_groups FOR SELECT TO authenticated USING (true);

-- Allow service role full access
DROP POLICY IF EXISTS "Allow service role full access on recurrence_groups" ON public.recurrence_groups;
CREATE POLICY "Allow service role full access on recurrence_groups"
ON public.recurrence_groups FOR ALL TO service_role USING (true) WITH CHECK (true);


-- 2. Add recurrence fields to report_findings
ALTER TABLE public.report_findings
ADD COLUMN IF NOT EXISTS recurrence_group_id UUID REFERENCES public.recurrence_groups(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS matching_policy_version TEXT DEFAULT 'RECURRENCE_MATCHING_POLICY_V1',
ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT 'confirmed',
ADD COLUMN IF NOT EXISTS match_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_rf_recurrence_group_id ON public.report_findings(recurrence_group_id);
CREATE INDEX IF NOT EXISTS idx_rf_hosp_recurrence ON public.report_findings(hospital_id, recurrence_group_id);


-- 3. Vector Match RPC for recurrence_groups
CREATE OR REPLACE FUNCTION match_recurrence_groups (
  query_embedding extensions.vector(768),
  match_domain TEXT DEFAULT NULL,
  match_limit INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  normalized_key TEXT,
  entity TEXT,
  defect TEXT,
  domain TEXT,
  review_status TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    rg.id,
    rg.title,
    rg.normalized_key,
    rg.entity,
    rg.defect,
    rg.domain,
    rg.review_status,
    (1 - (rg.embedding <=> query_embedding))::FLOAT AS similarity
  FROM public.recurrence_groups rg
  WHERE rg.embedding IS NOT NULL
    AND (match_domain IS NULL OR rg.domain = match_domain OR rg.domain = 'عام')
  ORDER BY rg.embedding <=> query_embedding
  LIMIT match_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION match_recurrence_groups TO authenticated;
GRANT EXECUTE ON FUNCTION match_recurrence_groups TO service_role;


-- 4. Recreate v_report_findings safely by dropping and recreating
DROP VIEW IF EXISTS public.v_report_findings;

CREATE VIEW public.v_report_findings AS
SELECT 
  rf.id,
  rf.report_id,
  rf.last_report_id,
  rf.hospital_id,
  rf.department_id,
  rf.canonical_finding_id,
  rf.recurrence_group_id,
  
  -- From report_findings: Original text is always the primary truth
  rf.original_text,
  rf.corrective_action,
  rf.responsible,
  rf.deadline,
  rf.priority,
  rf.status,
  rf.resolution_note,
  rf.resolved_date,
  rf.resolved_by,
  rf.hospital_resolution_note,
  rf.hospital_resolution_date,
  rf.created_at,
  rf.updated_at,
  
  -- Recurrence Governance fields
  rf.matching_policy_version,
  rf.review_status,
  rf.match_reason,
  
  -- From recurrence_groups (Layer 2: Exact issue)
  rg.title AS recurrence_group_title,
  rg.entity AS recurrence_entity,
  rg.defect AS recurrence_defect,
  
  -- From canonical_findings (Layer 3: Broad standard/topic classification)
  cf.canonical_text,
  cf.category,
  cf.subcategory,
  cf.severity,
  cf.standard,
  
  -- Window function for strict repeat count (per hospital + recurrence_group_id)
  ROW_NUMBER() OVER (
    PARTITION BY rf.hospital_id, COALESCE(rf.recurrence_group_id, rf.id) 
    ORDER BY COALESCE(r.inspection_date, rf.created_at::DATE) ASC, rf.id ASC
  ) AS repeat_count,
  
  MIN(COALESCE(r.inspection_date, rf.created_at::DATE)) OVER (
    PARTITION BY rf.hospital_id, COALESCE(rf.recurrence_group_id, rf.id)
  ) AS first_seen_date,
  
  COALESCE(r.inspection_date, rf.created_at::DATE) AS last_seen_date

FROM public.report_findings rf
LEFT JOIN public.recurrence_groups rg ON rf.recurrence_group_id = rg.id
LEFT JOIN public.canonical_findings cf ON rf.canonical_finding_id = cf.id
LEFT JOIN public.reports r ON rf.report_id = r.id;

GRANT SELECT ON public.v_report_findings TO authenticated;
GRANT SELECT ON public.v_report_findings TO service_role;
