import fs from 'fs'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { RecurrenceMatcherService, normalizeRecurrenceKey } from '../src/services/recurrence-matcher.service.js'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function reEvaluateGroups() {
  console.log('=== STARTING RE-EVALUATION OF RECURRENCE GROUPS ===')

  // 1. Fetch all report_findings
  const { count: rfCountBefore } = await supabase.from('report_findings').select('*', { count: 'exact', head: true })
  console.log(`Pre-check: report_findings = ${rfCountBefore}`)

  // Empty the recurrence_groups table first (this sets recurrence_group_id to null in report_findings due to ON DELETE SET NULL)
  console.log('Wiping existing recurrence groups to start fresh...')
  await supabase.from('recurrence_groups').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  let allFindings = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('report_findings')
      .select('id, original_text, report_id, hospital_id, department_id, created_at, reports:reports!report_findings_report_id_fkey(inspection_date), departments(name)')
      .range(from, from + 999)
    if (error) { console.error('Fetch error:', error); process.exit(1); }
    if (!data || data.length === 0) break
    allFindings.push(...data)
    if (data.length < 1000) break
    from += 1000
  }

  // Sort strictly by inspection_date ASC, created_at ASC, id ASC
  allFindings.sort((a, b) => {
    const dateA = a.reports?.inspection_date || a.created_at
    const dateB = b.reports?.inspection_date || b.created_at
    if (dateA !== dateB) return dateA.localeCompare(dateB)
    return a.id.localeCompare(b.id)
  })
  console.log(`Loaded ${allFindings.length} findings sorted chronologically.`)

  const matcher = new RecurrenceMatcherService(supabase)

  const stats = {
    total: allFindings.length,
    highConfidence: 0,
    uncertain: 0,
    distinct: 0,
    groupsCreated: 0
  }

  const updatesToApply = []

  for (let i = 0; i < allFindings.length; i++) {
    const rf = allFindings[i]
    const domain = rf.departments?.name || 'عام'
    
    const matchResult = await matcher.matchFinding(rf.original_text, domain)

    let targetGroupId = matchResult.recurrenceGroupId

    if (matchResult.decision === 'HIGH_CONFIDENCE' && targetGroupId) {
      stats.highConfidence++
      updatesToApply.push({
        rf_id: rf.id,
        recurrence_group_id: targetGroupId,
        review_status: 'confirmed',
        matching_policy_version: matchResult.matchingPolicyVersion,
        match_reason: matchResult.reason
      })
    } else if (matchResult.decision === 'UNCERTAIN') {
      stats.uncertain++
      const normKey = normalizeRecurrenceKey(rf.original_text)
      const { data: newGroup, error: grpErr } = await supabase
        .from('recurrence_groups')
        .insert({
          title: normKey,
          normalized_key: normKey,
          entity: matchResult.entity,
          defect: matchResult.defect,
          domain: domain,
          confidence: 'UNCERTAIN',
          review_status: 'pending_review',
          matching_policy_version: matchResult.matchingPolicyVersion
        })
        .select('id')
        .single()

      if (grpErr) {
        console.error('Failed to create uncertain group:', grpErr)
        process.exit(1)
      }
      stats.groupsCreated++
      updatesToApply.push({
        rf_id: rf.id,
        recurrence_group_id: newGroup.id,
        review_status: 'pending_review',
        matching_policy_version: matchResult.matchingPolicyVersion,
        match_reason: matchResult.reason
      })
    } else {
      stats.distinct++
      const normKey = normalizeRecurrenceKey(rf.original_text)
      const { data: newGroup, error: grpErr } = await supabase
        .from('recurrence_groups')
        .insert({
          title: normKey,
          normalized_key: normKey,
          entity: matchResult.entity,
          defect: matchResult.defect,
          domain: domain,
          confidence: 'DISTINCT',
          review_status: 'single',
          matching_policy_version: matchResult.matchingPolicyVersion
        })
        .select('id')
        .single()

      if (grpErr) {
        console.error('Failed to create distinct group:', grpErr)
        process.exit(1)
      }
      stats.groupsCreated++
      updatesToApply.push({
        rf_id: rf.id,
        recurrence_group_id: newGroup.id,
        review_status: 'single',
        matching_policy_version: matchResult.matchingPolicyVersion,
        match_reason: matchResult.reason
      })
    }

    if ((i + 1) % 100 === 0 || i === allFindings.length - 1) {
      console.log(`Processed ${i + 1}/${allFindings.length} findings... (High: ${stats.highConfidence}, Uncertain: ${stats.uncertain}, Distinct/New: ${stats.distinct})`)
    }
  }

  console.log('\nApplying updates to report_findings in controlled batches...')
  const batchSize = 100
  for (let b = 0; b < updatesToApply.length; b += batchSize) {
    const chunk = updatesToApply.slice(b, b + batchSize)
    await Promise.all(chunk.map(u => 
      supabase.from('report_findings')
        .update({
          recurrence_group_id: u.recurrence_group_id,
          review_status: u.review_status,
          matching_policy_version: u.matching_policy_version,
          match_reason: u.match_reason
        })
        .eq('id', u.rf_id)
    ))
    console.log(`Applied updates ${Math.min(b + batchSize, updatesToApply.length)}/${updatesToApply.length}`)
  }

  console.log('=== RE-EVALUATION COMPLETED SUCCESSFULLY ===')
}

reEvaluateGroups()
