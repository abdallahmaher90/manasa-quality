import fs from 'fs'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function audit() {
  const { count: rfCount } = await supabase.from('report_findings').select('*', { count: 'exact', head: true })
  const { count: rgCount } = await supabase.from('recurrence_groups').select('*', { count: 'exact', head: true })
  const { count: unassigned } = await supabase.from('report_findings').select('*', { count: 'exact', head: true }).is('recurrence_group_id', null)
  
  const { data: allGroups } = await supabase.from('recurrence_groups').select('id, title, confidence, review_status')
  
  const groupMap = new Map()
  let from = 0
  while (true) {
    const { data: rfs } = await supabase
      .from('report_findings')
      .select('id, recurrence_group_id, original_text, hospital_id, created_at, review_status, match_reason')
      .range(from, from + 999)
    if (!rfs || rfs.length === 0) break
    rfs.forEach(r => {
      if (!groupMap.has(r.recurrence_group_id)) groupMap.set(r.recurrence_group_id, [])
      groupMap.get(r.recurrence_group_id).push(r)
    })
    if (rfs.length < 1000) break
    from += 1000
  }
  
  const multiGroups = []
  const singleGroups = []
  for (const g of allGroups) {
    const items = groupMap.get(g.id) || []
    if (items.length > 1) {
      multiGroups.push({ group: g, count: items.length, items })
    } else {
      singleGroups.push({ group: g, count: items.length, items })
    }
  }

  // Count decision types from report_findings
  const { count: highConfCount } = await supabase.from('report_findings').select('*', { count: 'exact', head: true }).ilike('match_reason', '%تطابق%')
  const { data: pendingList } = await supabase.from('report_findings').select('id, original_text, recurrence_group_id, match_reason').eq('review_status', 'pending_review')

  console.log('=== VERIFICATION SUMMARY ===')
  console.log('Total report_findings:', rfCount)
  console.log('Total recurrence_groups:', rgCount)
  console.log('Unassigned findings:', unassigned)
  console.log('Multi-finding groups:', multiGroups.length)
  console.log('Single-finding groups:', singleGroups.length)
  console.log('HIGH_CONFIDENCE matched records:', rfCount - rgCount)
  console.log('UNCERTAIN records (pending_review):', pendingList.length)
  console.log('DISTINCT records:', singleGroups.length - pendingList.length)

  fs.writeFileSync('multi_finding_groups_audit.json', JSON.stringify(multiGroups, null, 2))
  fs.writeFileSync('uncertain_findings_audit.json', JSON.stringify(pendingList, null, 2))
  
  console.log('\n--- SAMPLE MULTI-FINDING GROUPS ---')
  multiGroups.slice(0, 10).forEach(mg => {
    console.log(`\nGroup: "${mg.group.title}" (Items: ${mg.count})`)
    mg.items.forEach(it => console.log(`  -> [${it.id}] ${it.original_text} (Hosp: ${it.hospital_id})`))
  })
}

audit()
