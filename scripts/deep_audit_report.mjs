import fs from 'fs'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { normalizeRecurrenceKey, getCoreTokens } from '../src/services/recurrence-matcher.service.js'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function computeSimilarity(tokA, tokB) {
  const setB = new Set(tokB)
  const shared = tokA.filter(w => setB.has(w))
  const union = new Set([...tokA, ...tokB])
  return union.size === 0 ? 0 : shared.length / union.size
}

async function deepAudit() {
  const reportId = '242e9940-8208-49d0-953e-3db69d412791'

  // Fetch the 26 new findings
  const { data: newFindings } = await supabase
    .from('report_findings')
    .select('id, original_text, recurrence_group_id, review_status, match_reason, canonical_finding_id, hospital_id')
    .eq('report_id', reportId)

  // Fetch all historical findings for the SAME hospital
  const { data: hospFindings } = await supabase
    .from('report_findings')
    .select('id, original_text, recurrence_group_id, created_at')
    .eq('hospital_id', newFindings[0].hospital_id)
    .neq('report_id', reportId)

  // For pending_review, find the candidate group historical texts globally
  const pendingGroupIds = newFindings.filter(f => f.review_status === 'pending_review').map(f => f.recurrence_group_id)
  let candidateGroupFindings = []
  if (pendingGroupIds.length > 0) {
    const { data: gFindings } = await supabase
      .from('report_findings')
      .select('id, original_text, recurrence_group_id, hospital_id')
      .in('recurrence_group_id', pendingGroupIds)
      .neq('report_id', reportId)
    candidateGroupFindings = gFindings || []
  }

  const results = []

  for (const f of newFindings) {
    const newTokens = getCoreTokens(f.original_text)
    
    // 1. If pending_review, find what triggered it
    let candidateTrigger = []
    if (f.review_status === 'pending_review') {
      candidateTrigger = candidateGroupFindings
        .filter(c => c.recurrence_group_id === f.recurrence_group_id)
        .map(c => ({
          text: c.original_text,
          hospital_id: c.hospital_id,
          similarity: computeSimilarity(newTokens, getCoreTokens(c.original_text))
        }))
    }

    // 2. Search for missed historical matches in the SAME hospital (independent of recurrence_group_id)
    const missedCandidates = []
    for (const hf of hospFindings) {
      const histTokens = getCoreTokens(hf.original_text)
      const sim = computeSimilarity(newTokens, histTokens)
      if (sim > 0.3) {
        missedCandidates.push({
          text: hf.original_text,
          groupId: hf.recurrence_group_id,
          similarity: sim
        })
      }
    }

    // Sort by highest similarity
    missedCandidates.sort((a, b) => b.similarity - a.similarity)
    candidateTrigger.sort((a, b) => b.similarity - a.similarity)

    results.push({
      original_text: f.original_text,
      review_status: f.review_status,
      match_reason: f.match_reason,
      groupId: f.recurrence_group_id,
      candidateTrigger: candidateTrigger.slice(0, 3), // top 3 triggers
      missedCandidatesSameHosp: missedCandidates.slice(0, 3) // top 3 missed in same hosp
    })
  }

  fs.writeFileSync('deep_audit_results.json', JSON.stringify(results, null, 2))
  console.log('Deep audit saved to deep_audit_results.json')
}

deepAudit()
