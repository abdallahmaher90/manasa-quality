import fs from 'fs'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { RecurrenceMatcherService, normalizeRecurrenceKey } from '../src/services/recurrence-matcher.service.js'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function runSharedEngineMigration() {
  console.log('=== STARTING SHARED-ENGINE RECURRENCE MIGRATION ===')

  // 1. Verify counts before
  const { count: rfCountBefore } = await supabase.from('report_findings').select('*', { count: 'exact', head: true })
  const { count: cfCountBefore } = await supabase.from('canonical_findings').select('*', { count: 'exact', head: true })
  console.log(`Pre-check: report_findings = ${rfCountBefore}, canonical_findings = ${cfCountBefore}`)
  if (rfCountBefore !== 1340 || cfCountBefore !== 855) {
    console.error('Initial counts mismatch! Aborting.')
    process.exit(1)
  }

  // 2. Fetch all 1,340 report_findings in chronological order
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

  // 3. Initialize Shared Recurrence Matcher Service
  const matcher = new RecurrenceMatcherService(supabase)

  const stats = {
    total: allFindings.length,
    highConfidence: 0,
    uncertain: 0,
    distinct: 0,
    groupsCreated: 0
  }

  const updatesToApply = [] // { rf_id, recurrence_group_id, review_status, matching_policy_version, match_reason }

  // 4. Process each finding through the shared matcher
  for (let i = 0; i < allFindings.length; i++) {
    const rf = allFindings[i]
    const domain = rf.departments?.name || 'عام'
    
    // Call the EXACT SAME matcher function that /api/save-report will call
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
      // For uncertain, create an independent group with review_status = 'pending_review'
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
      // DISTINCT
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

  console.log('\n--- ALL FINDINGS MATCHED VIA SHARED ENGINE ---')
  console.log('Stats:', stats)

  // 5. Batch update report_findings via controlled SQL/RPC or direct update batches
  console.log('\nApplying updates to report_findings in controlled batches...')
  const batchSize = 100
  for (let b = 0; b < updatesToApply.length; b += batchSize) {
    const chunk = updatesToApply.slice(b, b + batchSize)
    // Execute updates in parallel within the chunk
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

  // 6. Post-migration verification
  const { count: rfCountAfter } = await supabase.from('report_findings').select('*', { count: 'exact', head: true })
  const { count: rgCountAfter } = await supabase.from('recurrence_groups').select('*', { count: 'exact', head: true })
  const { count: unassignedCount } = await supabase.from('report_findings').select('*', { count: 'exact', head: true }).is('recurrence_group_id', null)

  console.log('\n=== POST-MIGRATION VERIFICATION ===')
  console.log(`Total report_findings: ${rfCountAfter} (Expected: 1340)`)
  console.log(`Total recurrence_groups: ${rgCountAfter}`)
  console.log(`Unassigned findings: ${unassignedCount} (Expected: 0)`)

  if (rfCountAfter !== 1340 || unassignedCount !== 0) {
    console.error('VERIFICATION FAILED! Count mismatch or unassigned findings present.')
    process.exit(1)
  }

  fs.writeFileSync('./migration_summary_results.json', JSON.stringify({ stats, total_groups: rgCountAfter }, null, 2))
  console.log('=== MIGRATION COMPLETED SUCCESSFULLY WITH SHARED ENGINE ===')
}

runSharedEngineMigration()
