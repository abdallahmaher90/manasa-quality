-- =====================================================
-- MANASA Platform - Patient Safety Management
-- Supabase Database Schema
-- Run this in Supabase SQL Editor
-- =====================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- SETTINGS
-- =====================================================
CREATE TABLE IF NOT EXISTS settings (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- HOSPITALS
-- =====================================================
CREATE TABLE IF NOT EXISTS hospitals (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  governorate TEXT,
  code TEXT,
  director_name TEXT,
  director_phone TEXT,
  quality_head_name TEXT,
  quality_head_phone TEXT,
  quality_team JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- DEPARTMENTS
-- =====================================================
CREATE TABLE IF NOT EXISTS departments (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  hospital_id UUID REFERENCES hospitals(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- REPORTS (Archive)
-- =====================================================
CREATE TABLE IF NOT EXISTS reports (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  hospital_id UUID REFERENCES hospitals(id) ON DELETE CASCADE,
  inspector_name TEXT,
  inspection_date DATE,
  raw_text TEXT,
  file_name TEXT,
  file_url TEXT,
  signatory_1_name TEXT,
  signatory_1_title TEXT,
  signatory_2_name TEXT,
  signatory_2_title TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- STORAGE BUCKETS
-- =====================================================
-- Create 'reports_files' bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public) 
VALUES ('reports_files', 'reports_files', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public access to read files
CREATE POLICY "Public Access" ON storage.objects
  FOR SELECT USING (bucket_id = 'reports_files');

-- Allow authenticated users to upload files
CREATE POLICY "Authenticated users can upload files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'reports_files' AND auth.role() = 'authenticated'
  );

-- =====================================================
-- FINDINGS (Core - السلبيات)
-- =====================================================
CREATE TABLE IF NOT EXISTS findings (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  hospital_id UUID REFERENCES hospitals(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
  report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
  last_report_id UUID REFERENCES reports(id) ON DELETE SET NULL,

  -- Text
  original_text TEXT NOT NULL,
  canonical_text TEXT NOT NULL,

  -- Action
  corrective_action TEXT,
  responsible TEXT,
  deadline TEXT,

  -- Classification
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  status TEXT DEFAULT 'open' CHECK (
    status IN ('open', 'recurring', 'resolved_by_hospital', 'resolved_confirmed')
  ),
  repeat_count INTEGER DEFAULT 1,

  -- Dates
  first_seen_date DATE,
  last_seen_date DATE,
  resolved_date DATE,
  resolved_by TEXT CHECK (resolved_by IN ('directorate', 'hospital', NULL)),

  -- Notes
  resolution_note TEXT,
  hospital_resolution_note TEXT,
  hospital_resolution_date DATE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- USER PROFILES
-- =====================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT,
  role TEXT DEFAULT 'hospital_member' CHECK (
    role IN ('directorate_admin', 'directorate_member', 'hospital_admin', 'hospital_member')
  ),
  hospital_id UUID REFERENCES hospitals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- INDEXES (Performance)
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_findings_hospital ON findings(hospital_id);
CREATE INDEX IF NOT EXISTS idx_findings_department ON findings(department_id);
CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status);
CREATE INDEX IF NOT EXISTS idx_findings_repeat ON findings(repeat_count DESC);
CREATE INDEX IF NOT EXISTS idx_departments_hospital ON departments(hospital_id);
CREATE INDEX IF NOT EXISTS idx_reports_hospital ON reports(hospital_id);
CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(inspection_date DESC);

-- =====================================================
-- AUTO UPDATE updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_findings_updated_at
  BEFORE UPDATE ON findings
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hospitals ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Settings: Read for all, manage for directorate
CREATE POLICY "Anyone can read settings" ON settings
  FOR SELECT USING (true);

CREATE POLICY "Directorate can manage settings" ON settings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('directorate_admin', 'directorate_member')
    )
  );

-- Profiles: Users can only see their own profile
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Hospitals: Directorate sees all, Hospital users see only their hospital
CREATE POLICY "Directorate can view all hospitals" ON hospitals
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('directorate_admin', 'directorate_member')
    )
  );

CREATE POLICY "Hospital users can view own hospital" ON hospitals
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND hospital_id = hospitals.id
      AND role IN ('hospital_admin', 'hospital_member')
    )
  );

-- Directorate can insert/update hospitals
CREATE POLICY "Directorate can manage hospitals" ON hospitals
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('directorate_admin', 'directorate_member')
    )
  );

-- Hospital users can update their own hospital details (management & quality team)
CREATE POLICY "Hospital users can update own hospital" ON hospitals
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND hospital_id = hospitals.id
      AND role IN ('hospital_admin', 'hospital_member')
    )
  );

-- Departments: Same logic as hospitals
CREATE POLICY "Directorate can view all departments" ON departments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid()
      AND role IN ('directorate_admin', 'directorate_member')
    )
  );

CREATE POLICY "Hospital users can view own departments" ON departments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid()
      AND hospital_id = departments.hospital_id
    )
  );

CREATE POLICY "Directorate can manage departments" ON departments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid()
      AND role IN ('directorate_admin', 'directorate_member')
    )
  );

-- Reports: Directorate sees all, Hospital sees own
CREATE POLICY "Directorate can view all reports" ON reports
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('directorate_admin', 'directorate_member'))
  );

CREATE POLICY "Hospital can view own reports" ON reports
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND hospital_id = reports.hospital_id)
  );

CREATE POLICY "Directorate can manage reports" ON reports
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('directorate_admin', 'directorate_member'))
  );

-- Findings: Directorate sees all, Hospital sees own
CREATE POLICY "Directorate can view all findings" ON findings
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('directorate_admin', 'directorate_member'))
  );

CREATE POLICY "Hospital can view own findings" ON findings
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND hospital_id = findings.hospital_id)
  );

CREATE POLICY "Directorate can manage findings" ON findings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('directorate_admin', 'directorate_member'))
  );

-- Hospital can update own findings (for claiming resolution)
CREATE POLICY "Hospital can update own findings" ON findings
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND hospital_id = findings.hospital_id)
  );

-- =====================================================
-- TRIGGER: Auto-create profile on signup
-- =====================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'hospital_member')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE handle_new_user();

-- =====================================================
-- SAMPLE DATA (لبيانات تجريبية)
-- Run after creating your first admin user
-- =====================================================
-- INSERT INTO hospitals (name, governorate) VALUES
--   ('مستشفى برج البرلس', 'كفر الشيخ'),
--   ('مستشفى كفر الشيخ العام', 'كفر الشيخ'),
--   ('مستشفى بيلا المركزي', 'كفر الشيخ');

-- =====================================================
-- STORAGE BUCKETS
-- =====================================================
-- Create bucket for report files (PDFs, Images, etc)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('reports_files', 'reports_files', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to reports_files
CREATE POLICY "Public Access" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'reports_files');

-- Allow authenticated users to upload to reports_files
CREATE POLICY "Authenticated Upload" 
ON storage.objects FOR INSERT 
WITH CHECK (
  bucket_id = 'reports_files' 
  AND auth.role() = 'authenticated'
);

-- =====================================================
-- NOTIFICATIONS
-- =====================================================
CREATE TABLE notifications (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  hospital_id UUID REFERENCES hospitals(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'system',
  link TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Allow users to see notifications for their hospital or specifically targeted to them
CREATE POLICY "Users can view their own notifications" ON notifications
  FOR SELECT USING (
    auth.uid() = user_id 
    OR 
    hospital_id = (SELECT hospital_id FROM profiles WHERE id = auth.uid())
    OR
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'directorate_admin'
  );

-- Allow users to update their own notifications (e.g. mark as read)
CREATE POLICY "Users can update their own notifications" ON notifications
  FOR UPDATE USING (
    auth.uid() = user_id 
    OR 
    hospital_id = (SELECT hospital_id FROM profiles WHERE id = auth.uid())
  );

