// Run Supabase schema via Management API
const SUPABASE_URL = 'https://tuqxtpwtaluynnmconnr.supabase.co'
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1cXh0cHd0YWx1eW5ubWNvbm5yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzUxODEyOSwiZXhwIjoyMTAzMDk0MTI5fQ.rzo1uIXDOfZ90eS0HeiF2HSLFxI2lU9uQ96NrVxdJEI'

// Run SQL via Supabase's pg endpoint
async function runSQL(sql) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({ query: sql })
  })
  return res
}

// Use the Postgres direct connection via Supabase's SQL API
async function executeSQL(sql) {
  const res = await fetch(`https://tuqxtpwtaluynnmconnr.supabase.co/pg/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ query: sql })
  })
  const text = await res.text()
  return { status: res.status, body: text }
}

const statements = [
  `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`,

  `CREATE TABLE IF NOT EXISTS hospitals (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name TEXT NOT NULL,
    governorate TEXT,
    code TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS departments (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    hospital_id UUID REFERENCES hospitals(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS reports (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    hospital_id UUID REFERENCES hospitals(id) ON DELETE CASCADE,
    inspector_name TEXT,
    inspection_date DATE,
    raw_text TEXT,
    file_name TEXT,
    signatory_1_name TEXT,
    signatory_1_title TEXT,
    signatory_2_name TEXT,
    signatory_2_title TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS findings (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    hospital_id UUID REFERENCES hospitals(id) ON DELETE CASCADE,
    department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
    report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
    last_report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
    original_text TEXT NOT NULL,
    canonical_text TEXT NOT NULL,
    corrective_action TEXT,
    responsible TEXT,
    deadline TEXT,
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'open',
    repeat_count INTEGER DEFAULT 1,
    first_seen_date DATE,
    last_seen_date DATE,
    resolved_date DATE,
    resolved_by TEXT,
    resolution_note TEXT,
    hospital_resolution_note TEXT,
    hospital_resolution_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY,
    full_name TEXT,
    role TEXT DEFAULT 'hospital_member',
    hospital_id UUID REFERENCES hospitals(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_findings_hospital ON findings(hospital_id)`,
  `CREATE INDEX IF NOT EXISTS idx_findings_department ON findings(department_id)`,
  `CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status)`,
  `CREATE INDEX IF NOT EXISTS idx_departments_hospital ON departments(hospital_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_hospital ON reports(hospital_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(inspection_date DESC)`,
]

import { createClient } from '@supabase/supabase-js'

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  db: { schema: 'public' },
  auth: { persistSession: false }
})

console.log('🚀 Creating Manasa database tables...\n')

for (const stmt of statements) {
  const label = stmt.trim().split('\n')[0].slice(0, 60)
  try {
    // Use rpc to execute raw SQL
    const { error } = await sb.rpc('exec_sql', { query: stmt })
    if (error) {
      // rpc not available, try direct insert to trigger error revealing table existence
      console.log(`⚠️  ${label} - ${error.message}`)
    } else {
      console.log(`✅ ${label}`)
    }
  } catch(e) {
    console.log(`⚠️  ${label} - ${e.message}`)
  }
}

// Verify by checking if tables exist
console.log('\n📋 Verifying tables...')
const tables = ['hospitals', 'departments', 'reports', 'findings', 'profiles']
for (const table of tables) {
  const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true })
  if (error) {
    console.log(`❌ ${table}: ${error.message}`)
  } else {
    console.log(`✅ ${table}: OK (${count} rows)`)
  }
}
