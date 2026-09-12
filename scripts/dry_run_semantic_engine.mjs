import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'
import { RecurrenceMatcherService } from '../src/services/recurrence-matcher.service.js'
import { normalizeRecurrenceKey } from '../src/services/recurrence-matcher.service.js'
import { extractSemanticSignaturesBulk, extractSemanticIssueSignature } from '../src/lib/ai-parser.js'

dotenv.config({ path: '.env.local' })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const CACHE_FILE = 'semantic_signatures_cache.json'
const ADJUDICATION_CACHE_FILE = 'semantic_adjudication_cache.json'
let signatureCache = {}
let adjudicationCache = {}

if (fs.existsSync(CACHE_FILE)) {
  try { signatureCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) } catch (e) {}
}
if (fs.existsSync(ADJUDICATION_CACHE_FILE)) {
  try { adjudicationCache = JSON.parse(fs.readFileSync(ADJUDICATION_CACHE_FILE, 'utf8')) } catch (e) {}
}

function saveCache() {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(signatureCache, null, 2))
  fs.writeFileSync(ADJUDICATION_CACHE_FILE, JSON.stringify(adjudicationCache, null, 2))
}

const matcher = new RecurrenceMatcherService(supabase, { useVector: false })

matcher._heuristicExtract = async (text) => {
  const norm = normalizeRecurrenceKey(text)
  const cacheKey = `${norm}_SEMANTIC_SIGNATURE_V1_gemini-3.8-flash`
  if (signatureCache[cacheKey]) return signatureCache[cacheKey]
  
  // If not in cache during matcher run, extract single
  const sig = await extractSemanticIssueSignature(text)
  if (sig) {
    signatureCache[cacheKey] = sig
    saveCache()
  }
  return sig
}

async function bulkExtractMissingSignatures(texts, batchSize = 20) {
  const missing = []
  for (const t of texts) {
    const norm = normalizeRecurrenceKey(t)
    const cacheKey = `${norm}_SEMANTIC_SIGNATURE_V1_gemini-3.8-flash`
    if (!signatureCache[cacheKey]) missing.push(t)
  }

  if (missing.length === 0) return

  console.log(`Need to extract signatures for ${missing.length} texts. Batch size: ${batchSize}`)
  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize)
    console.log(`Processing batch ${i/batchSize + 1}/${Math.ceil(missing.length/batchSize)}...`)
    
    const results = await extractSemanticSignaturesBulk(batch)
    for (let j = 0; j < batch.length; j++) {
      if (results[j]) {
        const norm = normalizeRecurrenceKey(batch[j])
        const cacheKey = `${norm}_SEMANTIC_SIGNATURE_V1_gemini-3.8-flash`
        signatureCache[cacheKey] = results[j]
      }
    }
    saveCache()
    // 15 RPM limit -> need at least 4000ms delay between batch requests
    await new Promise(r => setTimeout(r, 5000))
  }
}

async function runBenchmark(limit = null, reportName = 'semantic_dry_run_report.json') {
  console.log(`\n=== SEMANTIC ENGINE DRY RUN (LIMIT: ${limit || 'ALL'}) ===\n`)

  let allFindings = []
  let from = 0
  let step = 1000
  while (true) {
    const { data, error } = await supabase
      .from('report_findings')
      .select('id, original_text, hospital_id, recurrence_group_id, department_id, created_at')
      .order('created_at', { ascending: false })
      .range(from, from + step - 1)
    
    if (error) {
      console.error('Error fetching findings:', error)
      return
    }
    if (!data || data.length === 0) break
    allFindings = allFindings.concat(data)
    from += step
  }

  if (limit) {
    allFindings = allFindings.slice(0, limit)
  }

  console.log(`Loaded ${allFindings.length} findings for evaluation.`)

  // Pre-fetch all candidates internally to make sure we cache their signatures too
  await matcher.initializeGroupCache()
  
  // Collect all unique texts that might need signatures
  const textsToExtract = new Set()
  allFindings.forEach(f => textsToExtract.add(f.original_text))
  matcher._allGroups.forEach(g => textsToExtract.add(g.title))
  
  // Run Bulk Extraction Phase
  console.log('--- PHASE 1: BULK EXTRACTION ---')
  await bulkExtractMissingSignatures(Array.from(textsToExtract), 20)

  console.log('--- PHASE 2: AI ADJUDICATION ---')
  const results = {
    total: allFindings.length,
    HIGH_CONFIDENCE: 0,
    UNCERTAIN: 0,
    DISTINCT: 0,
    proposedMerges: [],
    proposedSplits: [],
    sameHospitalCrossWording: [],
    crossDepartmentMerges: [],
    falseNegativeDiscoveries: [],
    riskiestMerges: [],
    strongestMerges: []
  }

  let count = 0
  let apiCalls = 0
  let cacheHits = 0
  let cacheMisses = 0

  const startTime = Date.now()

  for (const finding of allFindings) {
    count++
    if (count % 10 === 0) console.log(`Processing ${count}/${allFindings.length}...`)

    const adjCacheKey = `ADJ_${finding.id}_V2`
    let result = adjudicationCache[adjCacheKey]

    if (result) {
       cacheHits++
    } else {
       cacheMisses++
       try {
         result = await matcher.matchFinding(finding.original_text, finding.department_id)
         adjudicationCache[adjCacheKey] = result
         saveCache()
         apiCalls++
       } catch (e) {
         console.error(`Error matching finding ${finding.id}:`, e.message)
         result = { decision: 'UNCERTAIN', reason: 'Exception: ' + e.message }
       }
    }

    results[result.decision] = (results[result.decision] || 0) + 1

    if (result.decision === 'HIGH_CONFIDENCE' && result.candidateGroupId && result.candidateGroupId !== finding.recurrence_group_id) {
      const mergeObj = {
        findingId: finding.id,
        textA: finding.original_text,
        textB: result.title,
        oldGroup: finding.recurrence_group_id,
        newGroup: result.candidateGroupId,
        lexicalScore: result.similarity,
        semanticScore: result.confidence,
        reason: result.reason,
        departmentA: finding.department_id,
        decision: result.decision,
        entityA: result.sigA?.entity,
        entityB: result.sigB?.entity,
        defectA: result.sigA?.defect,
        defectB: result.sigB?.defect,
        requirementA: result.sigA?.requirement,
        requirementB: result.sigB?.requirement,
        polarityA: result.sigA?.polarity,
        polarityB: result.sigB?.polarity,
        scopeA: result.sigA?.scope,
        scopeB: result.sigB?.scope,
        contextA: result.sigA?.context,
        contextB: result.sigB?.context
      }
      results.proposedMerges.push(mergeObj)
      results.falseNegativeDiscoveries.push(mergeObj)
    }

    if (result.decision === 'DISTINCT' && finding.recurrence_group_id) {
      results.proposedSplits.push({
        findingId: finding.id,
        text: finding.original_text,
        oldGroup: finding.recurrence_group_id,
        reason: result.reason
      })
    }
  }

  const duration = (Date.now() - startTime) / 1000

  results.proposedMerges.sort((a, b) => b.semanticScore - a.semanticScore)
  results.strongestMerges = results.proposedMerges.slice(0, 30)
  
  const risky = results.proposedMerges.filter(m => m.semanticScore < 0.95 && m.semanticScore > 0).sort((a, b) => a.semanticScore - b.semanticScore)
  results.riskiestMerges = risky.slice(0, 30)

  results.metrics = {
     totalProcessed: results.total,
     timeSeconds: duration,
     apiCalls,
     cacheHits,
     cacheMisses,
     avgLatencyPerFinding: duration / results.total
  }

  fs.writeFileSync(reportName, JSON.stringify(results, null, 2))
  console.log(`\n=== RESULTS SAVED TO ${reportName} ===`)
  console.log(`HIGH_CONFIDENCE: ${results.HIGH_CONFIDENCE}`)
  console.log(`UNCERTAIN: ${results.UNCERTAIN}`)
  console.log(`DISTINCT: ${results.DISTINCT}`)
  console.log(`New Merges Found: ${results.proposedMerges.length}`)
}

async function run() {
  const mode = process.argv[2]
  if (mode === '10') {
    await runBenchmark(10, 'benchmark_10.json')
  } else if (mode === '50') {
    await runBenchmark(50, 'benchmark_50.json')
  } else if (mode === 'full') {
    await runBenchmark(null, 'dry_run_1366.json')
  } else {
    console.log("Please specify mode: node scripts/dry_run_semantic_engine.mjs [10|50|full]")
  }
}

run().catch(console.error)
