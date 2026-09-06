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

async function getAllFindings() {
  let allData = []
  let from = 0
  const limit = 1000
  let hasMore = true

  while (hasMore) {
    const { data, error } = await supabase
      .from('findings')
      .select('id, report_id, department_id, canonical_text, original_text, created_at')
      .range(from, from + limit - 1)

    if (error) {
      console.error(error)
      break
    }

    if (data.length > 0) {
      allData = allData.concat(data)
      from += limit
    } else {
      hasMore = false
    }
  }

  return allData
}

async function run() {
  console.log('Fetching ALL findings...')
  const findings = await getAllFindings()
  console.log(`Fetched ${findings.length} findings.`)

  const groups = new Map()

  for (const finding of findings) {
    if (!finding.report_id || !finding.department_id) continue
    
    let textKey = finding.canonical_text ? finding.canonical_text.trim() : finding.original_text.trim()
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
      
      // Delete in chunks if there are many
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
