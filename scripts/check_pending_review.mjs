import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createServiceClient } from '../src/lib/supabase.js'

async function run() {
  const sb = createServiceClient()
  const { data: queueItems } = await sb.from('semantic_adjudication_queue').select('id, status, decision, report_finding_id, reason')
  const queueByFinding = {}
  queueItems?.forEach(q => { queueByFinding[q.report_finding_id] = q })
  
  const { data: findings } = await sb.from('report_findings').select('id, original_text, review_status, recurrence_group_id, hospital_id, hospitals(name)').eq('review_status', 'pending_review')
  
  console.log(`Total pending review findings in DB: ${findings.length}`)
  const statusCounts = {}
  findings.forEach(f => {
    const q = queueByFinding[f.id]
    const qStatus = q ? `${q.status} (decision: ${q.decision})` : 'NO_QUEUE_ITEM'
    statusCounts[qStatus] = (statusCounts[qStatus] || 0) + 1
  })
  console.log('Queue status for pending review findings:', statusCounts)
  
  console.log('\nSamples:')
  findings.slice(0, 10).forEach((f, i) => {
    const q = queueByFinding[f.id]
    console.log(`(${i+1}) [${f.hospitals?.name}] "${f.original_text.replace(/\n/g, ' ')}" -> Queue: ${q ? `${q.status} (dec: ${q.decision})` : 'NO_QUEUE_ITEM'}`)
  })
}

run().catch(console.error)
