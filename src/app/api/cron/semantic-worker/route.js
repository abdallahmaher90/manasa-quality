import { createServiceClient } from '@/lib/supabase'
import { adjudicateFindingMatch, extractSemanticIssueSignature } from '@/lib/ai-parser'
import { normalizeRecurrenceKey } from '@/services/recurrence-matcher.service'
import { RECURRENCE_MATCHING_POLICY_VERSION } from '@/services/recurrence-matcher.service'

const BATCH_SIZE = 5

export async function GET(request) {
  // 1. Verify CRON Secret if configured
  const authHeader = request.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  try {
    // 2. Claim pending items
    const { data: queueItems, error: claimError } = await supabase.rpc('claim_semantic_queue_items', {
      batch_limit: BATCH_SIZE
    })

    if (claimError) {
      console.error('Failed to claim semantic queue items:', claimError)
      return Response.json({ error: 'Failed to claim items', details: claimError }, { status: 500 })
    }

    if (!queueItems || queueItems.length === 0) {
      return Response.json({ status: 'idle', count: 0 })
    }

    let processed = 0
    let rateLimited = false
    const unprocessedItems = []

    for (const item of queueItems) {
      if (rateLimited) {
        unprocessedItems.push(item.id)
        continue
      }

      try {
        // Fetch original finding text
        const { data: finding } = await supabase
          .from('report_findings')
          .select('original_text, department_id, departments(name)')
          .eq('id', item.report_finding_id)
          .single()

        if (!finding) throw new Error('Finding not found')

        // Fetch candidate group title and signature
        const { data: group } = await supabase
          .from('recurrence_groups')
          .select('title, semantic_signature')
          .eq('id', item.candidate_group_id)
          .single()

        if (!group) throw new Error('Candidate group not found')

        // Evaluate using Gemini
        const newSig = await extractSemanticIssueSignature(finding.original_text)
        const candSig = group.semantic_signature // fallback can be added if missing
        
        if (!newSig || !candSig) {
          throw new Error('Failed to extract signatures')
        }

        const aiResult = await adjudicateFindingMatch(newSig, candSig)
        
        const domain = finding.departments?.name || 'عام'
        const normKey = normalizeRecurrenceKey(finding.original_text)

        // Safely apply decision via RPC transaction
        const { error: applyError } = await supabase.rpc('apply_semantic_decision', {
          p_queue_id: item.id,
          p_decision: aiResult.decision,
          p_confidence: aiResult.confidence || 'HIGH',
          p_reason: aiResult.reason,
          p_model: 'gemini-3.6-flash',
          p_policy_version: RECURRENCE_MATCHING_POLICY_VERSION,
          p_new_group_title: normKey,
          p_new_group_norm_key: normKey,
          p_new_group_entity: newSig.entity,
          p_new_group_defect: newSig.defect,
          p_new_group_domain: domain
        })

        if (applyError) {
           console.error(`Error applying decision for item ${item.id}:`, applyError)
           throw applyError
        }

        processed++
      } catch (err) {
        console.error(`Error processing queue item ${item.id}:`, err)
        
        // Handle Gemini Rate Limit (429)
        if (err.status === 429 || (err.message && err.message.includes('429'))) {
          rateLimited = true
          unprocessedItems.push(item.id)
          
          let waitSecs = 3600 // default 1 hour for daily quota
          const retryMatch = err.message.match(/retry in ([\d\.]+)s/)
          if (retryMatch && retryMatch[1]) {
            waitSecs = Math.ceil(parseFloat(retryMatch[1]))
            // if wait is huge (daily limit), just set to tomorrow
            if (waitSecs < 60) {
               // Even if it says 58s, if we hit the daily quota it repeats. 
               // Best to back off for a good amount of time, e.g., 15 mins.
               waitSecs = 900 
            }
          }

          // Release the lock for this item with backoff
          await supabase
            .from('semantic_adjudication_queue')
            .update({
              status: 'pending',
              locked_at: null,
              next_attempt_at: new Date(Date.now() + waitSecs * 1000).toISOString(),
              last_error: 'Rate Limit (429)'
            })
            .eq('id', item.id)
            
        } else {
          // Normal error (e.g. extraction failed)
          await supabase
            .from('semantic_adjudication_queue')
            .update({
              status: 'failed',
              locked_at: null,
              last_error: err.message,
              next_attempt_at: new Date(Date.now() + 300 * 1000).toISOString() // retry in 5 mins
            })
            .eq('id', item.id)
        }
      }
    }

    // Release remaining unprocessed items if we got rate limited
    if (unprocessedItems.length > 0 && rateLimited) {
       await supabase
         .from('semantic_adjudication_queue')
         .update({
           status: 'pending',
           locked_at: null,
           next_attempt_at: new Date(Date.now() + 3600 * 1000).toISOString() // Wait an hour globally
         })
         .in('id', unprocessedItems)
    }

    return Response.json({ status: 'success', processed, rateLimited })

  } catch (error) {
    console.error('Fatal error in semantic worker:', error)
    return Response.json({ error: 'Internal worker error' }, { status: 500 })
  }
}
