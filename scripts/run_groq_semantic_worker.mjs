import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createServiceClient } from '../src/lib/supabase.js'
import { extractSemanticIssueSignature, adjudicateFindingMatch } from '../src/lib/ai-parser.js'
import { normalizeRecurrenceKey, RECURRENCE_MATCHING_POLICY_VERSION } from '../src/services/recurrence-matcher.service.js'

const BATCH_SIZE = 15
const MAX_BATCHES = 100 // up to 1500 items

async function main() {
  const supabase = createServiceClient()
  console.log('🚀 Starting Groq Semantic Queue Worker...\n')

  // 1. Release any stuck processing items (older than 10 mins)
  const { error: resetError } = await supabase
    .from('semantic_adjudication_queue')
    .update({ status: 'pending', locked_at: null })
    .eq('status', 'processing')
    .lt('locked_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())

  if (resetError) {
    console.warn('Warning resetting stuck items:', resetError.message)
  }

  // 2. Also reset failed items that had "Candidate group not found" or "Rate Limit" so they can be processed by Groq
  await supabase
    .from('semantic_adjudication_queue')
    .update({ status: 'pending', locked_at: null, next_attempt_at: null })
    .eq('status', 'failed')

  let totalProcessed = 0
  let sameIssueCount = 0
  let distinctCount = 0

  for (let batchNum = 1; batchNum <= MAX_BATCHES; batchNum++) {
    const { data: queueItems, error: claimError } = await supabase.rpc('claim_semantic_queue_items', {
      batch_limit: BATCH_SIZE
    })

    if (claimError) {
      console.error('Failed to claim queue items:', claimError)
      break
    }

    if (!queueItems || queueItems.length === 0) {
      console.log('✅ Queue is empty! No more items to process.')
      break
    }

    console.log(`\n📦 Batch #${batchNum} claimed: ${queueItems.length} items`)

    for (let i = 0; i < queueItems.length; i++) {
      const item = queueItems[i]
      const itemStartTime = Date.now()

      try {
        // Fetch finding
        const { data: finding } = await supabase
          .from('report_findings')
          .select('id, original_text, department_id, departments(name)')
          .eq('id', item.report_finding_id)
          .single()

        if (!finding) {
          await supabase.from('semantic_adjudication_queue').delete().eq('id', item.id)
          totalProcessed++
          continue
        }

        const domain = finding.departments?.name || 'عام'
        const normKey = normalizeRecurrenceKey(finding.original_text)

        // Case 1: No candidate group id
        if (!item.candidate_group_id) {
          const sig = await extractSemanticIssueSignature(finding.original_text)
          await supabase.rpc('apply_semantic_decision', {
            p_queue_id: item.id,
            p_decision: 'DISTINCT',
            p_confidence: 'HIGH',
            p_reason: 'No candidate group specified; created as distinct issue.',
            p_model: 'groq/openai/gpt-oss-120b',
            p_policy_version: RECURRENCE_MATCHING_POLICY_VERSION,
            p_new_group_title: normKey,
            p_new_group_norm_key: normKey,
            p_new_group_entity: sig?.entity || normKey,
            p_new_group_defect: sig?.defect || 'غير محدد',
            p_new_group_domain: domain
          })
          distinctCount++
          totalProcessed++
          console.log(`  [${i+1}/${queueItems.length}] -> DISTINCT (new group) in ${Date.now() - itemStartTime}ms`)
          continue
        }

        // Fetch candidate group
        const { data: group } = await supabase
          .from('recurrence_groups')
          .select('id, title, semantic_signature')
          .eq('id', item.candidate_group_id)
          .maybeSingle()

        if (!group) {
          const sig = await extractSemanticIssueSignature(finding.original_text)
          await supabase.rpc('apply_semantic_decision', {
            p_queue_id: item.id,
            p_decision: 'DISTINCT',
            p_confidence: 'HIGH',
            p_reason: 'Candidate group not found; created as distinct issue.',
            p_model: 'groq/openai/gpt-oss-120b',
            p_policy_version: RECURRENCE_MATCHING_POLICY_VERSION,
            p_new_group_title: normKey,
            p_new_group_norm_key: normKey,
            p_new_group_entity: sig?.entity || normKey,
            p_new_group_defect: sig?.defect || 'غير محدد',
            p_new_group_domain: domain
          })
          distinctCount++
          totalProcessed++
          console.log(`  [${i+1}/${queueItems.length}] -> DISTINCT (orphaned candidate) in ${Date.now() - itemStartTime}ms`)
          continue
        }

        // Extract signatures and adjudicate with Groq
        const newSig = await extractSemanticIssueSignature(finding.original_text)
        let candSig = group.semantic_signature
        if (!candSig && group.title) {
          candSig = await extractSemanticIssueSignature(group.title)
        }

        if (!newSig || !candSig) {
          throw new Error('Could not extract semantic signatures')
        }

        const aiResult = await adjudicateFindingMatch(newSig, candSig)
        let sqlDecision = 'UNCERTAIN'
        if (aiResult.decision === 'SAME_ISSUE') {
          sqlDecision = 'SAME_ISSUE'
          sameIssueCount++
        } else if (aiResult.decision === 'DIFFERENT_ISSUE' || aiResult.decision === 'DISTINCT') {
          sqlDecision = 'DISTINCT'
          distinctCount++
        }

        const { error: applyError } = await supabase.rpc('apply_semantic_decision', {
          p_queue_id: item.id,
          p_decision: sqlDecision,
          p_confidence: aiResult.confidence || 'HIGH',
          p_reason: aiResult.reason,
          p_model: 'groq/openai/gpt-oss-120b',
          p_policy_version: RECURRENCE_MATCHING_POLICY_VERSION,
          p_new_group_title: normKey,
          p_new_group_norm_key: normKey,
          p_new_group_entity: newSig.entity,
          p_new_group_defect: newSig.defect,
          p_new_group_domain: domain
        })

        if (applyError) {
          console.error(`  Error applying decision for item ${item.id}:`, applyError.message)
        } else {
          totalProcessed++
          console.log(`  [${i+1}/${queueItems.length}] -> ${sqlDecision} (elapsed: ${Date.now() - itemStartTime}ms)`)
        }

        // Pacing delay to stay well under TPM limits
        await new Promise(r => setTimeout(r, 1500))

      } catch (err) {
        console.error(`  [${i+1}/${queueItems.length}] Error on item ${item.id}:`, err.message)
        await supabase
          .from('semantic_adjudication_queue')
          .update({
            status: 'failed',
            locked_at: null,
            last_error: err.message,
            next_attempt_at: new Date(Date.now() + 60 * 1000).toISOString()
          })
          .eq('id', item.id)
      }
    }

    const { count: remainingCount } = await supabase
      .from('semantic_adjudication_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')

    console.log(`✨ Progress: ${totalProcessed} processed (Same: ${sameIssueCount}, Distinct: ${distinctCount}). Remaining pending in DB: ${remainingCount || 0}`)
  }

  console.log('\n🏁 Worker finished processing.')
  process.exit(0)
}

main().catch(err => {
  console.error('Worker fatal error:', err)
  process.exit(1)
})
