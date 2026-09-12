import fs from 'fs'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function runAudit() {
  const audit = {}

  // 1. Identify the new report
  const { data: reports, error: errRep } = await supabase
    .from('reports')
    .select('id, inspection_date, hospital_id, created_at')
    .order('created_at', { ascending: false })
    .limit(1)

  if (errRep || !reports || reports.length === 0) {
    console.error('Failed to fetch new report', errRep)
    process.exit(1)
  }

  const newReport = reports[0]
  audit.newReport = newReport

  // Count findings in this report
  const { count: findingsCount, data: reportFindings } = await supabase
    .from('report_findings')
    .select('*', { count: 'exact' })
    .eq('report_id', newReport.id)

  audit.newReport.findingsCount = findingsCount
  audit.findings = reportFindings

  // 2. Total baseline vs current
  const { count: totalFindings } = await supabase
    .from('report_findings')
    .select('*', { count: 'exact', head: true })
  audit.totalFindingsCount = totalFindings

  // Check matching info for the new report's findings
  audit.matchingDetails = reportFindings.map(f => ({
    id: f.id,
    original_text: f.original_text,
    canonical_finding_id: f.canonical_finding_id,
    recurrence_group_id: f.recurrence_group_id,
    review_status: f.review_status,
    matching_policy_version: f.matching_policy_version,
    match_reason: f.match_reason,
    hospital_id: f.hospital_id,
    department_id: f.department_id,
    status: f.status,
    priority: f.priority,
    corrective_action: f.corrective_action,
    responsible: f.responsible,
    deadline: f.deadline
  }))

  // 5 & 6. Test Recurrence and Distincts
  const groupIds = reportFindings.map(f => f.recurrence_group_id).filter(Boolean)
  
  // Find historical findings in the same groups
  const { data: historicalFindings } = await supabase
    .from('report_findings')
    .select('id, original_text, hospital_id, recurrence_group_id, created_at')
    .in('recurrence_group_id', groupIds)
    .neq('report_id', newReport.id) // exclude current report

  audit.historicalFindings = historicalFindings

  // Let's analyze groups
  audit.recurrenceMatchesCount = 0
  audit.existingGroupsExtendedCount = 0
  audit.newRecurrenceGroupsCount = 0
  audit.matchesInSameHospital = []
  
  const distinctGroups = new Set()
  const matchedGroups = new Set()

  for (const f of reportFindings) {
    if (f.review_status === 'single') {
      audit.newRecurrenceGroupsCount++
      distinctGroups.add(f.recurrence_group_id)
    } else {
      matchedGroups.add(f.recurrence_group_id)
      const matches = historicalFindings.filter(h => h.recurrence_group_id === f.recurrence_group_id)
      if (matches.length > 0) {
        audit.existingGroupsExtendedCount++
        audit.recurrenceMatchesCount++
        // Check if same hospital
        const sameHosp = matches.filter(h => h.hospital_id === f.hospital_id)
        if (sameHosp.length > 0) {
          audit.matchesInSameHospital.push({
            newFinding: f.original_text,
            historicalMatches: sameHosp.map(h => h.original_text),
            hospital_id: f.hospital_id,
            recurrence_group_id: f.recurrence_group_id
          })
        }
      }
    }
  }

  // 9. API View output check
  const { data: vFindings } = await supabase
    .from('v_report_findings')
    .select('id, original_text, hospital_id, recurrence_group_id, repeat_count')
    .in('recurrence_group_id', groupIds)
    .eq('hospital_id', newReport.hospital_id)

  audit.vFindings = vFindings

  fs.writeFileSync('audit_results.json', JSON.stringify(audit, null, 2))
  console.log('Audit completed and saved to audit_results.json')
}

runAudit()
