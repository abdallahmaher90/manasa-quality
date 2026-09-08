-- =====================================================
-- PHASE P2: AI VECTOR MATCHING & GOVERNANCE
-- =====================================================

-- 1. Governance Lifecycle
-- Ensure status constraint is explicitly named and enforced idempotently
ALTER TABLE canonical_findings DROP CONSTRAINT IF EXISTS canonical_findings_status_check;

ALTER TABLE canonical_findings 
ADD CONSTRAINT canonical_findings_status_check 
CHECK (status IN ('pending', 'under_review', 'active', 'rejected'));

-- 1b. Governance Fields
ALTER TABLE canonical_findings
ADD COLUMN IF NOT EXISTS reviewer_id UUID,
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS review_note TEXT;


-- 3. finding_match_logs for AI Traceability
CREATE TABLE IF NOT EXISTS finding_match_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  finding_text TEXT NOT NULL,
  similarity_score FLOAT,
  candidate_canonical_id UUID REFERENCES canonical_findings(id) ON DELETE SET NULL,
  matching_method TEXT CHECK (matching_method IN ('exact', 'vector_auto', 'gemini_adjudicated_match', 'gemini_adjudicated_new', 'vector_pending_match', 'new')),
  adjudication_result TEXT,
  embedding_model TEXT,
  embedding_dimensions INT,
  embedding_version TEXT,
  threshold_used FLOAT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS and intentionally add NO policies to make it Service-Role Only
ALTER TABLE finding_match_logs ENABLE ROW LEVEL SECURITY;


-- 4. Vector Search RPC with dynamic status filtering
CREATE OR REPLACE FUNCTION match_canonical_findings (
  query_embedding extensions.vector(768),
  match_category TEXT,
  allowed_statuses TEXT[],
  match_limit INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  canonical_text TEXT,
  category TEXT,
  status TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cf.id,
    cf.canonical_text,
    cf.category,
    cf.status,
    (1 - (cf.embedding <=> query_embedding))::FLOAT as similarity
  FROM canonical_findings cf
  WHERE cf.category = match_category
    AND cf.status = ANY(allowed_statuses)
    AND cf.embedding IS NOT NULL
  ORDER BY cf.embedding <=> query_embedding
  LIMIT match_limit;
END;
$$;

-- Secure the RPC
REVOKE EXECUTE ON FUNCTION public.match_canonical_findings(
  extensions.vector,
  TEXT,
  TEXT[],
  INT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.match_canonical_findings(
  extensions.vector,
  TEXT,
  TEXT[],
  INT
) TO authenticated;
