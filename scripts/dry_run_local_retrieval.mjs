import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

function normalizeText(text) {
  if (!text) return ''
  return text
    .replace(/[أإآا]/g, 'ا')
    .replace(/[ةه]/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .replace(/[^\w\s\u0600-\u06FF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const STOP_WORDS = new Set(['في', 'من', 'على', 'لا', 'يوجد', 'عدم', 'غير', 'تم', 'عن', 'و', 'أو', 'إلى'])

function getTokens(text) {
  return normalizeText(text).split(' ')
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
}

function calculateJaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0
  let intersection = 0
  for (const item of setA) {
    if (setB.has(item)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return intersection / union
}

async function runLocalDryRun() {
  console.log('Fetching all findings...')
  let allFindings = []
  let page = 0
  const limit = 500
  while (true) {
    const { data, error } = await supabase
      .from('report_findings')
      .select('id, original_text, hospital_id, department_id, recurrence_group_id')
      .range(page * limit, (page + 1) * limit - 1)
    
    if (error) { console.error(error); break }
    if (!data || data.length === 0) break
    allFindings = allFindings.concat(data)
    page++
  }

  console.log(`Fetched ${allFindings.length} findings.`)

  // 1. Build Inverted Index & Local Knowledge Base
  const kb = []
  const uniqueKeys = new Set()
  const groups = new Set()

  for (const f of allFindings) {
    const norm = normalizeText(f.original_text)
    uniqueKeys.add(norm)
    if (f.recurrence_group_id) groups.add(f.recurrence_group_id)
    
    kb.push({
      id: f.id,
      text: f.original_text,
      hospital_id: f.hospital_id,
      department_id: f.department_id,
      group_id: f.recurrence_group_id,
      tokens: new Set(getTokens(f.original_text))
    })
  }

  console.log('Generating candidates...')
  const metrics = {
    totalFindings: allFindings.length,
    uniqueKeys: uniqueKeys.size,
    existingGroups: groups.size,
    totalCandidatePairs: 0,
    sameHospitalCandidates: 0,
    crossHospitalCandidates: 0,
    crossDepartmentCandidates: 0,
    distribution: { '0': 0, '1': 0, '2-3': 0, '4-8': 0, '>8': 0 }
  }

  // To simulate future flow, we act as if we are processing each finding against an existing KB.
  // We'll query against all other findings (excluding self) to see what candidates pop up.
  for (let i = 0; i < kb.length; i++) {
    const target = kb[i]
    const candidates = []
    
    // Retrieval: Find any finding that shares at least 1 token
    for (let j = 0; j < kb.length; j++) {
      if (i === j) continue
      const cand = kb[j]
      
      const score = calculateJaccard(target.tokens, cand.tokens)
      // Lexical threshold (arbitrary small value to ensure recall)
      if (score >= 0.15) {
         candidates.push({ cand, score })
      }
    }

    // Rank and select Top-5 max (to avoid sending too many to Gemini)
    candidates.sort((a,b) => b.score - a.score)
    const strongCandidates = candidates.slice(0, 5)

    const cCount = strongCandidates.length
    if (cCount === 0) metrics.distribution['0']++
    else if (cCount === 1) metrics.distribution['1']++
    else if (cCount <= 3) metrics.distribution['2-3']++
    else if (cCount <= 8) metrics.distribution['4-8']++
    else metrics.distribution['>8']++

    metrics.totalCandidatePairs += cCount

    for (const c of strongCandidates) {
      if (c.cand.hospital_id === target.hospital_id) {
         metrics.sameHospitalCandidates++
         if (c.cand.department_id !== target.department_id) {
            metrics.crossDepartmentCandidates++
         }
      } else {
         metrics.crossHospitalCandidates++
      }
    }
  }

  // Cost estimates for historical processing
  const estimatedGeminiCalls = metrics.totalCandidatePairs // One pair = 1 adjudication call
  
  // Future report benchmark estimate (average candidates per finding)
  const avgCandidates = metrics.totalCandidatePairs / metrics.totalFindings
  
  const report = {
    A_LocalHistoricalIndexing: {
      totalFindings: metrics.totalFindings,
      uniqueNormalizedKeys: metrics.uniqueKeys,
      existingRecurrenceGroups: metrics.existingGroups,
      indexingGeminiCalls: 0 // Local only
    },
    B_CandidateRetrieval: {
      totalCandidatePairsGenerated: metrics.totalCandidatePairs,
      avgCandidatesPerFinding: avgCandidates.toFixed(2),
      sameHospitalPairs: metrics.sameHospitalCandidates,
      crossHospitalPairs: metrics.crossHospitalCandidates,
      crossDepartmentPairs: metrics.crossDepartmentCandidates
    },
    C_CandidateDistribution: metrics.distribution,
    D_EstimatedGeminiCalls_Historical: estimatedGeminiCalls,
    E_NewReportBenchmark: {
      findingCount: 30,
      estimatedLocalRetrievals: 30,
      estimatedGeminiAdjudications: Math.ceil(30 * avgCandidates)
    }
  }

  fs.writeFileSync('local_dry_run_metrics.json', JSON.stringify(report, null, 2))
  console.log('Local Dry Run Complete. Output in local_dry_run_metrics.json')
}

runLocalDryRun().catch(console.error)
