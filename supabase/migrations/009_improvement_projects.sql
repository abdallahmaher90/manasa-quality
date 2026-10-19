-- Migration: 009_improvement_projects.sql
-- Description: Quality Improvement Projects (QIPs) table for Directorate Members
-- Allows evidence-based, performance-driven healthcare improvement projects

CREATE TABLE IF NOT EXISTS public.improvement_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
    hospital_name TEXT NOT NULL,
    title TEXT NOT NULL,
    department_name TEXT,
    priority TEXT NOT NULL DEFAULT 'high', -- 'high', 'medium', 'low'
    status TEXT NOT NULL DEFAULT 'draft',  -- 'draft', 'approved', 'in_progress', 'completed', 'suspended'
    category TEXT,                         -- e.g. 'سلامة المرضى', 'إدارة الدواء', 'مكافحة العدوى'
    problem_statement TEXT,                -- Problem Statement & Root Cause
    baseline_metrics TEXT,                 -- Baseline performance & defects
    smart_goal TEXT,                       -- Measurable SMART objective
    evidence_reference TEXT,               -- GAHAR / WHO / CBAHI accreditation standard
    target_completion_date DATE,
    kpis JSONB DEFAULT '[]'::jsonb,        -- Process and outcome indicators
    interventions JSONB DEFAULT '[]'::jsonb,-- Action steps (FOCUS-PDCA)
    project_lead TEXT,
    team_members JSONB DEFAULT '[]'::jsonb,
    estimated_duration_weeks INT DEFAULT 12,
    linked_finding_ids JSONB DEFAULT '[]'::jsonb,
    linked_findings_summary JSONB DEFAULT '[]'::jsonb,
    directorate_notes TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performant filtering
CREATE INDEX IF NOT EXISTS idx_imp_proj_hospital_id ON public.improvement_projects(hospital_id);
CREATE INDEX IF NOT EXISTS idx_imp_proj_status ON public.improvement_projects(status);
CREATE INDEX IF NOT EXISTS idx_imp_proj_priority ON public.improvement_projects(priority);

-- RLS: Visible ONLY to Directorate Members (admins & members)
ALTER TABLE public.improvement_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Directorate members can view all improvement projects"
ON public.improvement_projects FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role IN ('directorate_admin', 'directorate_member')
    )
);

CREATE POLICY "Directorate members can insert improvement projects"
ON public.improvement_projects FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role IN ('directorate_admin', 'directorate_member')
    )
);

CREATE POLICY "Directorate members can update improvement projects"
ON public.improvement_projects FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role IN ('directorate_admin', 'directorate_member')
    )
);

CREATE POLICY "Directorate admins can delete improvement projects"
ON public.improvement_projects FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role = 'directorate_admin'
    )
);
