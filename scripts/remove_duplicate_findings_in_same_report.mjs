import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envPath = '.env.local'
const envContent = fs.readFileSync(envPath, 'utf8')
const envVars = Object.fromEntries(envContent.split('\n').map(line => {
  const [key, ...value] = line.split('=')
  return [key, value.join('=').trim()]
}).filter(([key]) => key && !key.startsWith('#')))

const supabaseUrl = envVars['NEXT_PUBLIC_SUPABASE_URL']
const supabaseServiceKey = envVars['SUPABASE_SERVICE_ROLE_KEY']

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase environment variables.")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function run() {
  console.log("Fetching all findings...")
  const { data: findings, error } = await supabase
    .from('findings')
    .select('id, report_id, department_id, canonical_text, original_text, created_at')
    
  if (error) {
    console.error("Error fetching findings:", error)
    return
  }

  console.log(`Found ${findings.length} total findings.`)

  const groups = new Map()

  for (const finding of findings) {
    if (!finding.report_id || !finding.department_id) continue
    
    // Group by report_id, department_id, and canonical_text (fallback to original_text)
    const textKey = (finding.canonical_text || finding.original_text || "").trim()
    const key = `${finding.report_id}_${finding.department_id}_${textKey}`
    
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key).push(finding)
  }

  let deletedCount = 0
  for (const [key, group] of groups.entries()) {
    if (group.length > 1) {
      // Sort by created_at so we keep the oldest one
      group.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      
      const keep = group[0]
      const toDelete = group.slice(1)
      
      console.log(`Found ${toDelete.length} duplicates for: "${keep.canonical_text || keep.original_text}" in report ${keep.report_id}`)
      
      const idsToDelete = toDelete.map(f => f.id)
      
      const { error: delError } = await supabase
        .from('findings')
        .delete()
        .in('id', idsToDelete)
        
      if (delError) {
        console.error("Error deleting:", delError)
      } else {
        deletedCount += idsToDelete.length
      }
    }
  }

  console.log(`Done. Deleted ${deletedCount} duplicate findings from the same report/department.`)
}

run()
