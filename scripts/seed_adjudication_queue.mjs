import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase credentials in .env.local")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function run() {
  const queueData = JSON.parse(fs.readFileSync('gemini_review_queue_v4.json', 'utf8'))
  const checkpointData = JSON.parse(fs.readFileSync('gemini_adjudication_checkpoint.json', 'utf8'))

  // Build a map of processed items using finding_id as key
  const processedMap = {}
  for (const [index, data] of Object.entries(checkpointData)) {
    if (data.finding_id && data.decision) {
      processedMap[data.finding_id] = data
    }
  }

  let successCount = 0
  let pendingCount = 0

  for (const caseItem of queueData.cases) {
    const findingId = caseItem.finding_id
    const processed = processedMap[findingId]

    if (processed) {
      console.log(`Processing completed item ${findingId} (Decision: ${processed.decision})`)
      
      const { data: queueRow, error: qErr } = await supabase.from('semantic_adjudication_queue').upsert({
        report_finding_id: findingId,
        candidate_group_id: caseItem.candidate_group_id,
        status: 'completed',
        decision: processed.decision,
        confidence: processed.confidence,
        reason: processed.reason || processed.reasonLog || 'No reason provided',
        model: 'gemini-3.6-flash',
        policy_version: 'V1',
        completed_at: new Date().toISOString()
      }, { onConflict: 'report_finding_id' }).select('id').single()

      if (qErr) {
        console.error("Failed to insert completed queue item", qErr)
        continue
      }
      
      const normKey = 'semantic_group_' + findingId
      
      const { error: applyErr } = await supabase.rpc('apply_semantic_decision', {
        p_queue_id: queueRow.id,
        p_decision: processed.decision,
        p_confidence: processed.confidence,
        p_reason: processed.reason || processed.reasonLog || 'No reason provided',
        p_model: 'gemini-3.6-flash',
        p_policy_version: 'V1',
        p_new_group_title: caseItem.original_text,
        p_new_group_norm_key: normKey,
        p_new_group_entity: 'عام',
        p_new_group_defect: 'عام',
        p_new_group_domain: 'عام'
      })

      if (applyErr) {
         console.error("Error applying decision for", findingId, applyErr)
      } else {
         successCount++
      }

    } else {
      console.log(`Queueing pending item ${findingId}`)
      const { error } = await supabase.from('semantic_adjudication_queue').upsert({
        report_finding_id: findingId,
        candidate_group_id: caseItem.candidate_group_id || null,
        status: 'pending'
      }, { onConflict: 'report_finding_id' })

      if (error) {
        console.error("Failed to queue item", error)
      } else {
        pendingCount++
      }
    }
  }

  console.log(`Seeding complete. ${successCount} completed applied. ${pendingCount} queued for worker.`)
}

run().catch(console.error)
