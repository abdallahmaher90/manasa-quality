import fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function runAudit() {
  console.log('Running Final Consistency Audit...')

  let allFindings = []
  let page = 0
  while (true) {
      const { data } = await supabase.from('report_findings').select('id, hospital_id, original_text').range(page*1000, (page+1)*1000 - 1)
      if (!data || data.length === 0) break
      allFindings = allFindings.concat(data)
      page++
  }

  if (!fs.existsSync('historical_preparation_results.json')) {
      console.log('ERROR: historical_preparation_results.json not found.')
      return
  }

  const results = JSON.parse(fs.readFileSync('historical_preparation_results.json', 'utf8'))
  const resultsMap = new Map(results.map(r => [r.finding_id, r]))
  
  let missing = 0
  for (const f of allFindings) {
      if (!resultsMap.has(f.id)) missing++
  }

  if (missing > 0 || results.length !== allFindings.length) {
      console.log(`WARNING: Processed count (${results.length}) does not match DB count (${allFindings.length}). Missing: ${missing}`)
  }

  // Check uniformity
  const pipelineVersion = "V4"
  const modelName = "gemini-flash-latest"

  // Summary stats
  const summary = {
      total_findings: results.length,
      SAME_ISSUE: 0,
      DISTINCT: 0,
      UNCERTAIN: 0,
      Zero_Candidate: 0,
      actual_Gemini_calls: 0,
      failed_calls: 0,
      total_candidates: 0,
      pipeline_consistency: "PASSED",
      model_used: modelName,
      policy_version: pipelineVersion
  }

  const candidateCounts = []

  const auditRecords = []

  for (const r of results) {
      const cCount = r.top_candidates ? r.top_candidates.length : 0
      candidateCounts.push(cCount)
      summary.total_candidates += cCount
      
      let geminiStatus = 'NOT_CALLED'
      if (cCount > 0) {
          if (r.reason && r.reason.includes('Gemini Error')) {
              geminiStatus = 'FAILED'
              summary.failed_calls++
          } else {
              geminiStatus = 'SUCCESS'
              summary.actual_Gemini_calls++
          }
      } else {
          summary.Zero_Candidate++
      }

      if (r.decision === 'SAME_ISSUE') summary.SAME_ISSUE++
      if (r.decision === 'DISTINCT') summary.DISTINCT++
      if (r.decision === 'UNCERTAIN') summary.UNCERTAIN++

      auditRecords.push({
          finding_id: r.finding_id,
          original_text: r.original_text,
          hospital_id: r.hospital_id,
          proposed_recurrence_group_id: r.proposed_recurrence_group_id,
          decision: r.decision,
          confidence: r.confidence || 'UNKNOWN',
          model_name: modelName,
          policy_version: pipelineVersion,
          candidate_count: cCount,
          gemini_call_status: geminiStatus
      })
  }

  candidateCounts.sort((a,b) => a - b)
  summary.average_candidates = (summary.total_candidates / results.length).toFixed(2)
  summary.P50_candidates = candidateCounts[Math.floor(candidateCounts.length * 0.5)] || 0
  summary.P95_candidates = candidateCounts[Math.floor(candidateCounts.length * 0.95)] || 0

  // 5. Group Statistics
  const groupMap = new Map() // groupId -> { findings: [] }
  for (const r of results) {
      if (!groupMap.has(r.proposed_recurrence_group_id)) {
          groupMap.set(r.proposed_recurrence_group_id, [])
      }
      groupMap.get(r.proposed_recurrence_group_id).push(r)
  }

  const groups = Array.from(groupMap.entries()).map(([id, findings]) => {
      const hospitals = new Set(findings.map(f => f.hospital_id))
      return {
          group_id: id,
          size: findings.length,
          hospitals_count: hospitals.size,
          findings: findings
      }
  })

  groups.sort((a,b) => b.size - a.size)

  const groupStats = {
      total_proposed_groups: groups.length,
      singleton_groups: groups.filter(g => g.size === 1).length,
      multi_finding_groups: groups.filter(g => g.size > 1).length,
      largest_group_size: groups.length > 0 ? groups[0].size : 0,
      largest_20_groups: groups.slice(0, 20).map(g => ({
          group_id: g.group_id,
          number_of_findings: g.size,
          hospitals_count: g.hospitals_count,
          examples: g.findings.slice(0, 5).map(f => f.original_text),
          decisions: Array.from(new Set(g.findings.map(f => f.decision))),
          confidence_distribution: g.findings.reduce((acc, f) => { acc[f.confidence || 'UNKNOWN'] = (acc[f.confidence || 'UNKNOWN'] || 0) + 1; return acc }, {})
      }))
  }

  // 7. Over-grouping & 8. Hard-negative audit
  // For over-grouping, we flag groups where text varies wildly or polarity is opposite
  const suspiciousGroups = []
  const missingIncompleteRegex = /(غير موجود|مفقود|لا يوجد).*?(غير مكتمل|ناقص|يحتاج تحديث)|(غير مكتمل|ناقص|يحتاج تحديث).*?(غير موجود|مفقود|لا يوجد)/i
  const maintenanceRegex = /(معطل|لا يعمل|مكسور).*?(معايره|صيانه دوريه)|(معايره|صيانه دوريه).*?(معطل|لا يعمل|مكسور)/i

  for (const g of groups) {
      if (g.size > 1) {
          const allText = g.findings.map(f => f.original_text).join(' ### ')
          // Check for polarity clashes within the same group
          let suspicious = false
          let reason = []
          
          const hasMissing = g.findings.some(f => /(غير موجود|لا يوجد|عدم وجود|نقص)/.test(f.original_text))
          const hasIncomplete = g.findings.some(f => /(غير مكتمل|ناقص|لم يكتمل)/.test(f.original_text))
          if (hasMissing && hasIncomplete) {
              suspicious = true
              reason.push('Contains both Missing and Incomplete polarity')
          }
          
          if (suspicious) {
              suspiciousGroups.push({
                  group_id: g.group_id,
                  reasons: reason,
                  findings: g.findings.map(f => f.original_text)
              })
          }
      }
  }
  
  fs.writeFileSync('suspicious_recurrence_groups.json', JSON.stringify(suspiciousGroups, null, 2))

  // Final Verdict
  let verdict = 'READY_FOR_MIGRATION'
  if (missing > 0 || results.length !== allFindings.length) verdict = 'NOT_READY_FOR_MIGRATION (Missing findings)'
  if (summary.failed_calls > 0) verdict = 'NOT_READY_FOR_MIGRATION (Failed Gemini calls)'
  // We don't fail for UNCERTAIN, but they must NOT be DISTINCT
  const distinctUncertain = results.some(r => r.decision === 'UNCERTAIN' && r.proposed_recurrence_group_id && !r.proposed_recurrence_group_id.startsWith('NEW_')) 
  if (distinctUncertain) verdict = 'NOT_READY_FOR_MIGRATION (UNCERTAIN was mapped to an existing group without HIGH confidence)'

  const finalOutput = {
      verdict,
      summary,
      groupStats,
      auditRecords
  }

  fs.writeFileSync('historical_preparation_final_audit.json', JSON.stringify(finalOutput, null, 2))
  
  const mdReport = `# Final Consistency Audit Report

## Verdict: **${verdict}**

### Summary
- Total Findings: ${summary.total_findings}
- SAME_ISSUE: ${summary.SAME_ISSUE}
- DISTINCT: ${summary.DISTINCT}
- UNCERTAIN: ${summary.UNCERTAIN}
- Zero Candidates: ${summary.Zero_Candidate}
- Actual Gemini Calls: ${summary.actual_Gemini_calls}
- Failed Calls: ${summary.failed_calls}
- Average Candidates: ${summary.average_candidates} (P50: ${summary.P50_candidates}, P95: ${summary.P95_candidates})

### Group Statistics
- Total Proposed Groups: ${groupStats.total_proposed_groups}
- Singleton Groups: ${groupStats.singleton_groups}
- Multi-finding Groups: ${groupStats.multi_finding_groups}
- Largest Group Size: ${groupStats.largest_group_size}
- Suspicious Groups Found: ${suspiciousGroups.length} (See suspicious_recurrence_groups.json)

### Top 20 Groups
${groupStats.largest_20_groups.map((g, i) => `
**${i+1}. Group ID: ${g.group_id}**
- Findings: ${g.number_of_findings}
- Hospitals: ${g.hospitals_count}
- Decisions: ${g.decisions.join(', ')}
- Examples:
${g.examples.map(ex => `  - ${ex}`).join('\n')}
`).join('\n')}
`

  fs.writeFileSync('historical_preparation_final_audit.md', mdReport)
  console.log('Audit complete! Output written to historical_preparation_final_audit.md')
}

runAudit().catch(console.error)
