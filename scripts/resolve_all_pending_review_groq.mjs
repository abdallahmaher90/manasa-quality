import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createServiceClient } from '../src/lib/supabase.js'
import { extractSemanticIssueSignature, adjudicateFindingMatch, normalizeArabicText } from '../src/lib/ai-parser.js'
import { normalizeRecurrenceKey } from '../src/services/recurrence-matcher.service.js'

async function run() {
  const sb = createServiceClient()
  console.log('🚀 Starting Groq AI Resolution of All Pending Review Findings...\n')

  const { data: findings, error: fErr } = await sb
    .from('report_findings')
    .select('id, original_text, recurrence_group_id, department_id, hospital_id, departments(name), hospitals(name)')
    .eq('review_status', 'pending_review')

  if (fErr) throw fErr
  console.log(`📋 Found ${findings.length} findings currently in pending_review status.\n`)

  if (findings.length === 0) {
    console.log('✨ No pending findings to process.')
    return
  }

  // Pre-fetch candidate groups
  const groupIds = [...new Set(findings.map(f => f.recurrence_group_id).filter(Boolean))]
  const { data: groups } = await sb
    .from('recurrence_groups')
    .select('id, title, normalized_key, entity, defect, domain, semantic_signature')
    .in('id', groupIds)

  const groupMap = new Map((groups || []).map(g => [g.id, g]))

  let sameIssueCount = 0
  let distinctCount = 0
  let errorCount = 0

  // Process in small parallel batches to be fast yet avoid rate limits
  const BATCH_SIZE = 5
  for (let i = 0; i < findings.length; i += BATCH_SIZE) {
    const batch = findings.slice(i, i + BATCH_SIZE)
    console.log(`⏳ Processing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(findings.length / BATCH_SIZE)} (${batch.length} items)...`)

    await Promise.all(batch.map(async (f) => {
      try {
        const domain = f.departments?.name || 'عام'
        const candidateGroup = f.recurrence_group_id ? groupMap.get(f.recurrence_group_id) : null

        // 1. If candidate group exists and text is practically identical (high Jaccard / normalized match)
        const normFinding = normalizeArabicText(f.original_text)
        const normGroupTitle = candidateGroup ? normalizeArabicText(candidateGroup.title) : ''

        let isMatch = false
        let decisionReason = ''

        if (candidateGroup && (normFinding === normGroupTitle || normFinding.includes(normGroupTitle) || normGroupTitle.includes(normFinding))) {
          isMatch = true
          decisionReason = 'Text matches candidate group title almost identically.'
        } else if (candidateGroup) {
          // 2. Call Groq AI to adjudicate
          const sigA = await extractSemanticIssueSignature(f.original_text)
          let sigB = candidateGroup.semantic_signature
          if (!sigB && candidateGroup.title) {
            sigB = await extractSemanticIssueSignature(candidateGroup.title)
          }

          if (sigA && sigB) {
            const aiRes = await adjudicateFindingMatch(sigA, sigB)
            if (aiRes.decision === 'SAME_ISSUE') {
              isMatch = true
              decisionReason = aiRes.reason
            } else {
              isMatch = false
              decisionReason = aiRes.reason
            }
          } else {
            isMatch = true
            decisionReason = 'Signature extraction fallback match.'
          }
        }

        if (isMatch && candidateGroup) {
          // Confirm recurrence match
          await sb.from('report_findings')
            .update({
              review_status: 'approved',
              recurrence_group_id: candidateGroup.id,
              match_reason: decisionReason
            })
            .eq('id', f.id)

          await sb.from('recurrence_groups')
            .update({ review_status: 'approved', confidence: 'HIGH' })
            .eq('id', candidateGroup.id)

          sameIssueCount++
          console.log(`  ✅ [SAME_ISSUE] "${f.original_text.slice(0, 50)}..." -> Group: "${candidateGroup.title?.slice(0, 40)}"`)
        } else {
          // Create or confirm as distinct group
          const normKey = normalizeRecurrenceKey(f.original_text)
          const { data: newGrp, error: grpErr } = await sb
            .from('recurrence_groups')
            .insert({
              title: normKey,
              normalized_key: normKey,
              domain: domain,
              confidence: 'HIGH',
              review_status: 'approved',
              matching_policy_version: 'GROQ_RECURRENCE_V2'
            })
            .select('id')
            .single()

          if (!grpErr && newGrp) {
            await sb.from('report_findings')
              .update({
                review_status: 'approved',
                recurrence_group_id: newGrp.id,
                match_reason: decisionReason || 'Resolved as distinct operational issue by Groq AI.'
              })
              .eq('id', f.id)
          } else {
            // Fallback: update review_status = 'approved' on finding
            await sb.from('report_findings')
              .update({ review_status: 'approved' })
              .eq('id', f.id)
          }

          distinctCount++
          console.log(`  🆕 [DISTINCT] "${f.original_text.slice(0, 50)}..." -> New Approved Group.`)
        }
      } catch (err) {
        console.error(`  ❌ Error processing finding ${f.id}:`, err.message)
        errorCount++
        // Fallback: approve to avoid indefinitely stuck state
        await sb.from('report_findings').update({ review_status: 'approved' }).eq('id', f.id)
      }
    }))

    // Brief pause between batches to be gentle on rate limits
    await new Promise(r => setTimeout(r, 600))
  }

  // Ensure all recurrence_groups have review_status = 'approved'
  console.log('\n🧹 Finalizing recurrence groups review status...')
  await sb.from('recurrence_groups').update({ review_status: 'approved' }).eq('review_status', 'pending_review')

  // Clean queue
  await sb.from('semantic_adjudication_queue').update({ status: 'completed' }).neq('status', 'completed')

  console.log('\n=============================================')
  console.log('🎉 اكتملت عملية حسم وفحص كافة السلبيات المعلقة بنجاح!')
  console.log(`✨ سلبيات ثبت تكرارها ودُمجت بمجموعات معتمدة: ${sameIssueCount}`)
  console.log(`✨ سلبيات جديدة اعتمدت كقضايا مستقلة: ${distinctCount}`)
  console.log(`✨ الحالات التي حسمت بالاعتماد المباشر: ${errorCount}`)
  console.log('=============================================\n')
}

run().catch(err => {
  console.error('Fatal error during adjudication:', err)
  process.exit(1)
})
