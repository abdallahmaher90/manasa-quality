-- Preserve the evidence and root-cause review fields written by the QIP service.
-- These additions are nullable or have safe defaults so existing projects remain valid.

ALTER TABLE public.improvement_projects
  ADD COLUMN IF NOT EXISTS problem_id TEXT,
  ADD COLUMN IF NOT EXISTS why_hard_to_solve TEXT,
  ADD COLUMN IF NOT EXISTS root_cause_analysis TEXT,
  ADD COLUMN IF NOT EXISTS root_cause_hypotheses JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS root_cause_validation_plan TEXT,
  ADD COLUMN IF NOT EXISTS prioritization_matrix JSONB,
  ADD COLUMN IF NOT EXISTS forensic_corroboration JSONB,
  ADD COLUMN IF NOT EXISTS evidence_references JSONB;

CREATE INDEX IF NOT EXISTS idx_improvement_projects_problem
  ON public.improvement_projects (hospital_id, problem_id)
  WHERE problem_id IS NOT NULL;
