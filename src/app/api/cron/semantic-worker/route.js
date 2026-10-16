import { createServiceClient } from '@/lib/supabase'
import { adjudicateFindingMatch, extractSemanticIssueSignature } from '@/lib/ai-parser'
import { normalizeRecurrenceKey } from '@/services/recurrence-matcher.service'
import { RECURRENCE_MATCHING_POLICY_VERSION } from '@/services/recurrence-matcher.service'

const DEFAULT_BATCH_SIZE = 25

async function handleWorker(request) {
  // 1. Verify CRON Secret if configured and present
  const authHeader = request.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const batchSize = Math.min(parseInt(searchParams.get('limit') || DEFAULT_BATCH_SIZE, 10), 100)

  const supabase = createServiceClient()

  try {
    // 2. Claim pending items
    const { data: queueItems, error: claimError } = await supabase.rpc('claim_semantic_queue_items', {
      batch_limit: batchSize
    })

    if (claimError) {
      console.error('Failed to claim semantic queue items:', claimError)
      return Response.json({ error: 'Failed to claim items', details: claimError }, { status: 500 })
    }

    if (!queueItems || queueItems.length === 0) {
      // Check remaining in queue
      const { count: pendingCount } = await supabase
        .from('semantic_adjudication_queue')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')

      return Response.json({ status: 'idle', count: 0, remainingPending: pendingCount || 0 })
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
          .select('id, original_text, department_id, departments(name)')
          .eq('id', item.report_finding_id)
          .single()

        if (!finding) {
          // Finding deleted, remove from queue
          await supabase.from('semantic_adjudication_queue').delete().eq('id', item.id)
          processed++
          continue
        }

        const domain = finding.departments?.name || 'عام'
        const normKey = normalizeRecurrenceKey(finding.original_text)

        // Case 1: If no candidate group id is specified, treat as DISTINCT new issue
        if (!item.candidate_group_id) {
          const sig = await extractSemanticIssueSignature(finding.original_text)
          await supabase.rpc('apply_semantic_decision', {
            p_queue_id: item.id,
            p_decision: 'DISTINCT',
            p_confidence: 'HIGH',
            p_reason: 'No candidate group provided; established as distinct issue.',
            p_model: 'groq/openai/gpt-oss-120b',
            p_policy_version: RECURRENCE_MATCHING_POLICY_VERSION,
            p_new_group_title: normKey,
            p_new_group_norm_key: normKey,
            p_new_group_entity: sig?.entity || normKey,
            p_new_group_defect: sig?.defect || 'غير محدد',
            p_new_group_domain: domain
          })
          processed++
          continue
        }

        // Fetch candidate group title and signature
        const { data: group } = await supabase
          .from('recurrence_groups')
          .select('id, title, semantic_signature')
          .eq('id', item.candidate_group_id)
          .maybeSingle()

        // Case 2: Candidate group deleted or not found -> treat as DISTINCT new issue
        if (!group) {
          const sig = await extractSemanticIssueSignature(finding.original_text)
          await supabase.rpc('apply_semantic_decision', {
            p_queue_id: item.id,
            p_decision: 'DISTINCT',
            p_confidence: 'HIGH',
            p_reason: 'Candidate group no longer exists; created new distinct group.',
            p_model: 'groq/openai/gpt-oss-120b',
            p_policy_version: RECURRENCE_MATCHING_POLICY_VERSION,
            p_new_group_title: normKey,
            p_new_group_norm_key: normKey,
            p_new_group_entity: sig?.entity || normKey,
            p_new_group_defect: sig?.defect || 'غير محدد',
            p_new_group_domain: domain
          })
          processed++
          continue
        }

        // Case 3: Both finding and group exist -> perform semantic extraction & adjudication via Groq
        const newSig = await extractSemanticIssueSignature(finding.original_text)
        let candSig = group.semantic_signature
        if (!candSig && group.title) {
          candSig = await extractSemanticIssueSignature(group.title)
        }

        if (!newSig || !candSig) {
          throw new Error('Failed to extract signatures for finding or candidate group')
        }

        const aiResult = await adjudicateFindingMatch(newSig, candSig)

        // Standardize decision for SQL RPC (which expects 'SAME_ISSUE', 'DISTINCT', or 'UNCERTAIN')
        let sqlDecision = 'UNCERTAIN'
        if (aiResult.decision === 'SAME_ISSUE') {
          sqlDecision = 'SAME_ISSUE'
        } else if (aiResult.decision === 'DIFFERENT_ISSUE' || aiResult.decision === 'DISTINCT') {
          sqlDecision = 'DISTINCT'
        }

        // Safely apply decision via RPC transaction
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
          console.error(`Error applying decision for item ${item.id}:`, applyError)
          throw applyError
        }

        processed++
      } catch (err) {
        console.error(`Error processing queue item ${item.id}:`, err)

        // Handle Rate Limit (Groq or Gemini)
        if (err.status === 429 || (err.message && err.message.includes('429'))) {
          rateLimited = true
          unprocessedItems.push(item.id)

          // Short backoff for Groq (20 seconds) instead of 1 hour
          const waitSecs = 20

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
          // Normal error -> mark failed with 2 min retry
          await supabase
            .from('semantic_adjudication_queue')
            .update({
              status: 'failed',
              locked_at: null,
              last_error: err.message,
              next_attempt_at: new Date(Date.now() + 120 * 1000).toISOString()
            })
            .eq('id', item.id)
        }
      }
    }

    // Release remaining unprocessed items if rate limited
    if (unprocessedItems.length > 0 && rateLimited) {
      await supabase
        .from('semantic_adjudication_queue')
        .update({
          status: 'pending',
          locked_at: null,
          next_attempt_at: new Date(Date.now() + 30 * 1000).toISOString()
        })
        .in('id', unprocessedItems)
    }

    // Count remaining
    const { count: remainingCount } = await supabase
      .from('semantic_adjudication_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')

    return Response.json({
      status: 'success',
      processed,
      rateLimited,
      remainingPending: remainingCount || 0
    })

  } catch (error) {
    console.error('Fatal error in semantic worker:', error)
    return Response.json({ error: 'Internal worker error' }, { status: 500 })
  }
}

export async function GET(request) {
  return handleWorker(request)
}

export async function POST(request) {
  return handleWorker(request)
}
