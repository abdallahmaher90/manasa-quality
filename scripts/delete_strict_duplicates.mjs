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

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function run() {
  const { data: findings, error } = await supabase
    .from('findings')
    .select('id, report_id, department_id, canonical_text, original_text, created_at')

  if (error) {
    console.error("Error:", error)
    return
  }

  const groups = new Map()

  for (const finding of findings) {
    if (!finding.report_id || !finding.department_id) continue
    
    // Group STRICTLY by canonical text, fallback to original. 
    // Wait, let's just group by canonical_text if it exists, otherwise original.
    let textKey = finding.canonical_text ? finding.canonical_text.trim() : finding.original_text.trim()
    
    // To be absolutely safe against weird invisible characters, let's normalize spaces
    textKey = textKey.replace(/\s+/g, ' ')
    
    const key = `${finding.report_id}_${finding.department_id}_${textKey}`
    
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key).push(finding)
  }

  let deletedCount = 0
  for (const [key, group] of groups.entries()) {
    if (group.length > 1) {
      group.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      
      const keep = group[0]
      const toDelete = group.slice(1)
      const idsToDelete = toDelete.map(f => f.id)
      
      console.log(`Deleting ${idsToDelete.length} for canonical: "${keep.canonical_text}" in report ${keep.report_id}`)
      
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

  console.log(`Deleted ${deletedCount} more duplicates.`)
}
run()
