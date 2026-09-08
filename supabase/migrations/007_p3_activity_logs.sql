-- =====================================================
-- PHASE P3: ACTIVITY LOGS / AUDIT TRAIL
-- =====================================================

-- 1. Create the activity_logs table
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- Who performed the action
  hospital_id UUID REFERENCES hospitals(id) ON DELETE SET NULL, -- Related hospital (if any)
  action TEXT NOT NULL, -- Action name (e.g., upload_report, resolve_finding, reply_report)
  entity_type TEXT NOT NULL, -- Entity type (e.g., report, report_finding, canonical_finding)
  entity_id UUID, -- ID of the affected entity
  details JSONB, -- Additional details/metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS activity_logs_user_id_idx ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS activity_logs_hospital_id_idx ON activity_logs(hospital_id);
CREATE INDEX IF NOT EXISTS activity_logs_created_at_idx ON activity_logs(created_at DESC);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies
-- ONLY Directorate Admin can view the activity logs (يظهر عندي انا بس)
CREATE POLICY "Directorate admin can view all activity logs" 
ON activity_logs FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() AND role = 'directorate_admin'
  )
);

-- Allow system functions to insert bypassing RLS, but just in case, allow authenticated users to insert their own logs
CREATE POLICY "Users can insert their own activity logs" 
ON activity_logs FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
);

-- 4. Helper Function: Log Activity manually via RPC (can be called from frontend/backend)
CREATE OR REPLACE FUNCTION log_system_activity(
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_hospital_id UUID DEFAULT NULL,
  p_details JSONB DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  INSERT INTO activity_logs (user_id, hospital_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), p_hospital_id, p_action, p_entity_type, p_entity_id, p_details);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =====================================================
-- 5. AUTOMATIC TRIGGERS FOR KEY ACTIONS
-- =====================================================

-- Trigger: When a new report is uploaded
CREATE OR REPLACE FUNCTION trigger_log_new_report() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO activity_logs (user_id, hospital_id, action, entity_type, entity_id, details)
  VALUES (
    auth.uid(), 
    NEW.hospital_id, 
    'upload_report', 
    'report', 
    NEW.id, 
    jsonb_build_object('file_name', NEW.file_name, 'inspector', NEW.inspector_name)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_new_report ON reports;
CREATE TRIGGER on_new_report
  AFTER INSERT ON reports
  FOR EACH ROW EXECUTE PROCEDURE trigger_log_new_report();


-- Trigger: When a report finding is updated (e.g. resolved, replied)
CREATE OR REPLACE FUNCTION trigger_log_finding_update() RETURNS TRIGGER AS $$
DECLARE
  v_action TEXT := 'update_finding';
BEGIN
  -- Determine specific action based on what changed
  IF OLD.status != NEW.status AND NEW.status = 'resolved_by_hospital' THEN
    v_action := 'hospital_resolve_finding';
  ELSIF OLD.status != NEW.status AND NEW.status = 'resolved_confirmed' THEN
    v_action := 'admin_confirm_resolution';
  ELSIF OLD.resolution_note IS DISTINCT FROM NEW.resolution_note THEN
    v_action := 'add_resolution_note';
  END IF;

  INSERT INTO activity_logs (user_id, hospital_id, action, entity_type, entity_id, details)
  VALUES (
    auth.uid(), 
    NEW.hospital_id, 
    v_action, 
    'report_finding', 
    NEW.id, 
    jsonb_build_object(
      'old_status', OLD.status, 
      'new_status', NEW.status
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_report_finding_update ON report_findings;
CREATE TRIGGER on_report_finding_update
  AFTER UPDATE ON report_findings
  FOR EACH ROW 
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE PROCEDURE trigger_log_finding_update();
