import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'
import { GoogleGenAI } from '@google/genai'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

function normalizeText(text) {
  if (!text) return ''
  return text.replace(/[أإآا]/g, 'ا').replace(/[ةه]/g, 'ه').replace(/[ىي]/g, 'ي')
    .replace(/[^\w\s\u0600-\u06FF]/g, ' ').replace(/\s+/g, ' ').trim()
}
const STOP_WORDS = new Set(['في', 'من', 'على', 'لا', 'يوجد', 'عدم', 'غير', 'تم', 'عن', 'و', 'أو', 'إلى'])
function getTokens(text) { return normalizeText(text).split(' ').filter(w => w.length > 2 && !STOP_WORDS.has(w)) }

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function calculateJaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0
  let intersection = 0
  for (const item of setA) if (setB.has(item)) intersection++
  return intersection / (setA.size + setB.size - intersection)
}

const CACHE_FILE = 'hybrid_benchmark_cache.json'
let cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {}

import { getEmbedding } from '../src/lib/ai-parser.js'

async function getEmbeddingsBatch(texts) {
  const missing = texts.filter(t => !cache[`VEC_${normalizeText(t)}`])
  if (missing.length > 0) {
    console.log(`Generating embeddings for ${missing.length} texts sequentially...`)
    for (let i = 0; i < missing.length; i++) {
      const t = missing[i]
      try {
        const emb = await getEmbedding(t)
        if (emb) {
          cache[`VEC_${normalizeText(t)}`] = emb
        }
        await new Promise(r => setTimeout(r, 700))
        if (i % 20 === 0) fs.writeFileSync(CACHE_FILE, JSON.stringify(cache))
      } catch (e) {
        console.error('Embed err for text:', t, e.message)
      }
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache))
  }
  return texts.map(t => cache[`VEC_${normalizeText(t)}`])
}

const LEXICAL_DISJOINT_CASES = [
  { input: 'عربة الإنعاش غير موجودة', target: 'نقص كراش كار' },
  { input: 'النتائج الحرجة لا تبلغ', target: 'قصور في نظام تبليغ القيم الحرجة' },
  { input: 'جهاز المراقبة معطل', target: 'المونيتور لا يعمل' },
  { input: 'ملف المريض غير مرتب', target: 'سجلات المرضى مبعثرة' },
  { input: 'الموظف لا يرتدي البطاقة', target: 'غياب الهوية التعريفية للكادر' }
]

async function runBenchmark() {
  console.log('Fetching 100 random findings and 500 groups for KB...')
  const { data: findings } = await supabase.from('report_findings').select('*').limit(100)
  const { data: groups } = await supabase.from('recurrence_groups').select('*').limit(500)
  
  const allTexts = new Set()
  findings.forEach(f => allTexts.add(f.original_text))
  groups.forEach(g => allTexts.add(g.title))
  LEXICAL_DISJOINT_CASES.forEach(c => { allTexts.add(c.input); allTexts.add(c.target) })
  
  await getEmbeddingsBatch(Array.from(allTexts))

  const kb = groups.map(g => ({
    id: g.id, title: g.title,
    tokens: new Set(getTokens(g.title)),
    vec: cache[`VEC_${normalizeText(g.title)}`]
  }))

  // Add the disjoint targets to KB to ensure they can be retrieved
  LEXICAL_DISJOINT_CASES.forEach(c => {
     kb.push({
        id: `mock-${c.target}`, title: c.target,
        tokens: new Set(getTokens(c.target)),
        vec: cache[`VEC_${normalizeText(c.target)}`]
     })
  })

  const metrics = {
    totalFindings: findings.length,
    lexicalCandidates: 0, vectorCandidates: 0,
    overlapCandidates: 0, totalUniqueCandidates: 0,
    distribution: {'0':0, '1':0, '2-3':0, '4-8':0, '>8':0},
    zeroCandidates: 0
  }

  // 1. Benchmark 100 Findings
  for (const f of findings) {
    const fTokens = new Set(getTokens(f.original_text))
    const fVec = cache[`VEC_${normalizeText(f.original_text)}`]
    if (!fVec) continue

    const lexMap = new Map(), vecMap = new Map()

    for (const cand of kb) {
       if (!cand.vec) continue
       const jaccard = calculateJaccard(fTokens, cand.tokens)
       const cosSim = cosineSimilarity(fVec, cand.vec)
       
       if (jaccard > 0.15) lexMap.set(cand.id, cand)
       if (cosSim > 0.82) vecMap.set(cand.id, cand)
    }
    
    let lexCount = 0, vecCount = 0, overCount = 0
    const finalSet = new Set([...lexMap.keys(), ...vecMap.keys()])
    
    for (const id of finalSet) {
       const inLex = lexMap.has(id), inVec = vecMap.has(id)
       if (inLex && !inVec) lexCount++
       if (inVec && !inLex) vecCount++
       if (inLex && inVec) overCount++
    }

    metrics.lexicalCandidates += lexCount
    metrics.vectorCandidates += vecCount
    metrics.overlapCandidates += overCount
    const cCount = finalSet.size
    metrics.totalUniqueCandidates += cCount

    if (cCount === 0) { metrics.distribution['0']++; metrics.zeroCandidates++ }
    else if (cCount === 1) metrics.distribution['1']++
    else if (cCount <= 3) metrics.distribution['2-3']++
    else if (cCount <= 8) metrics.distribution['4-8']++
    else metrics.distribution['>8']++
  }

  // 2. Lexical Disjoint Test
  const disjointResults = []
  for (const c of LEXICAL_DISJOINT_CASES) {
     const fTokens = new Set(getTokens(c.input))
     const fVec = cache[`VEC_${normalizeText(c.input)}`]
     
     const ranked = kb.map(cand => ({
        id: cand.id, title: cand.title,
        cosSim: cand.vec ? cosineSimilarity(fVec, cand.vec) : 0,
        jaccard: calculateJaccard(fTokens, cand.tokens)
     })).sort((a,b) => b.cosSim - a.cosSim)

     const top3 = ranked.slice(0,3).map(x=>x.title)
     const top5 = ranked.slice(0,5).map(x=>x.title)
     const top8 = ranked.slice(0,8).map(x=>x.title)

     disjointResults.push({
        input: c.input, expected: c.target,
        recallAt3: top3.includes(c.target),
        recallAt5: top5.includes(c.target),
        recallAt8: top8.includes(c.target),
        jaccardTop: ranked[0].jaccard,
        cosSimTop: ranked[0].cosSim
     })
  }

  const avgCand = metrics.totalUniqueCandidates / (metrics.totalFindings || 1)
  const report = {
    benchmarkSize: 100,
    candidateMetrics: {
      totalCandidatesGenerated: metrics.totalUniqueCandidates,
      averageCandidatesPerFinding: avgCand.toFixed(2),
      lexicalOnlyCandidates: metrics.lexicalCandidates,
      vectorOnlyCandidates: metrics.vectorCandidates,
      overlapCandidates: metrics.overlapCandidates
    },
    candidateDistribution: metrics.distribution,
    geminiAdjudicationEstimation: {
      percentageRequiringGemini: ((100 - metrics.zeroCandidates) / 100 * 100).toFixed(1) + '%',
      estimatedGeminiCallsFor100: metrics.totalUniqueCandidates, // Worst case
      projectedGeminiCallsFor1366: Math.ceil(metrics.totalUniqueCandidates * 13.66)
    },
    lexicalDisjointTest: disjointResults
  }

  fs.writeFileSync('hybrid_benchmark_report.json', JSON.stringify(report, null, 2))
  console.log('Done!')
}
runBenchmark().catch(console.error)
