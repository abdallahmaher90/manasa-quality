-- =====================================================
-- PHASE P1: READ-PATH MIGRATION VIEWS
-- =====================================================

CREATE OR REPLACE VIEW v_report_findings AS
SELECT 
  rf.id,
  rf.report_id,
  rf.last_report_id,
  rf.hospital_id,
  rf.department_id,
  rf.canonical_finding_id,
  
  -- From report_findings
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
  
  -- From canonical_findings
  cf.canonical_text,
  cf.category,
  cf.subcategory,
  cf.severity,
  cf.standard,
  
  -- Window functions for analytics
  -- If last_report_id is populated, it means this was seen in a PREVIOUS report natively. 
  -- We order chronologically using COALESCE(r.inspection_date, rf.created_at::DATE).
  ROW_NUMBER() OVER (
    PARTITION BY rf.hospital_id, rf.canonical_finding_id 
    ORDER BY COALESCE(r.inspection_date, rf.created_at::DATE) ASC, rf.id ASC
  ) as repeat_count,
  
  -- first_seen_date
  MIN(COALESCE(r.inspection_date, rf.created_at::DATE)) OVER (
    PARTITION BY rf.hospital_id, rf.canonical_finding_id
  ) as first_seen_date,
  
  COALESCE(r.inspection_date, rf.created_at::DATE) as last_seen_date

FROM report_findings rf
LEFT JOIN canonical_findings cf ON rf.canonical_finding_id = cf.id
LEFT JOIN reports r ON rf.report_id = r.id;

-- Grant access to authenticated users
GRANT SELECT ON v_report_findings TO authenticated;
