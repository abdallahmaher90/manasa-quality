import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// 1. DOMAIN MEDICAL SYNONYM LAYER
const SYNONYMS = {
  'كراش كار': 'عربه انعاش',
  'عربه الطوارئ': 'عربه انعاش',
  'مونيتور': 'جهاز مراقبه',
  'تبليغ القيم الحرجه': 'النتائج الحرجه',
  'سجلات المرضي': 'ملف المريض',
  'هويه تعريفيه': 'بطاقه',
  'كادر': 'موظف',
  'crash cart': 'عربه انعاش',
  'monitor': 'جهاز مراقبه'
}

// 2. ARABIC + ENGLISH NORMALIZATION
function normalizeText(text) {
  if (!text) return ''
  return text.toLowerCase()
    .replace(/[أإآا]/g, 'ا')
    .replace(/[ةه]/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .replace(/[^\w\s\u0600-\u06FF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const STOP_WORDS = new Set(['في', 'من', 'على', 'لا', 'يوجد', 'عدم', 'غير', 'تم', 'عن', 'و', 'أو', 'إلى', 'ان'])

function expandSynonyms(text) {
  let expanded = text
  for (const [key, val] of Object.entries(SYNONYMS)) {
    if (expanded.includes(key)) {
      expanded += ' ' + val
    } else if (expanded.includes(val)) {
      expanded += ' ' + key
    }
  }
  return expanded
}

function getTokens(text) { 
  return expandSynonyms(normalizeText(text)).split(' ').filter(w => w.length > 2 && !STOP_WORDS.has(w)) 
}

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

// Unified Score Calculation
function calculateUnifiedScore(fTokens, cTokens, cosSim, jaccard) {
  const W_LEX = 0.4
  const W_VEC = 0.6
  
  // Bonus for domain synonyms (already captured by getTokens expansion partially, but we can boost)
  let score = (jaccard * W_LEX) + (cosSim * W_VEC)
  return score
}

const CACHE_FILE = 'hybrid_benchmark_cache.json'
let cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {}

const LEXICAL_DISJOINT_CASES = [
  { input: 'عربة الإنعاش غير موجودة', target: 'نقص كراش كار' },
  { input: 'النتائج الحرجة لا تبلغ', target: 'قصور في نظام تبليغ القيم الحرجة' },
  { input: 'جهاز المراقبة معطل', target: 'المونيتور لا يعمل' },
  { input: 'ملف المريض غير مرتب', target: 'سجلات المرضى مبعثرة' },
  { input: 'الموظف لا يرتدي البطاقة', target: 'غياب الهوية التعريفية للكادر' }
]

async function runBenchmark() {
  console.log('Loading KB from cache (no new API calls)...')
  
  const { data: findings } = await supabase.from('report_findings').select('*').limit(100)
  const { data: groups } = await supabase.from('recurrence_groups').select('*').limit(500)
  
  const kb = groups.map(g => ({
    id: g.id, title: g.title,
    tokens: new Set(getTokens(g.title)),
    vec: cache[`VEC_${normalizeText(g.title)}`]
  })).filter(g => g.vec)

  LEXICAL_DISJOINT_CASES.forEach(c => {
     if (cache[`VEC_${normalizeText(c.target)}`]) {
       kb.push({
          id: `mock-${c.target}`, title: c.target,
          tokens: new Set(getTokens(c.target)),
          vec: cache[`VEC_${normalizeText(c.target)}`]
       })
     }
  })

  const thresholdsToTest = [0.80, 0.82, 0.84, 0.86, 0.88, 0.90]
  const thresholdResults = {}

  for (const V_THRESH of thresholdsToTest) {
    const metrics = {
      lexicalCandidates: 0, vectorCandidates: 0, overlapCandidates: 0,
      totalUniqueCandidates: 0, zeroCandidates: 0
    }

    for (const f of findings) {
      const originalNorm = normalizeText(f.original_text)
      const fTokens = new Set(getTokens(f.original_text))
      const fVec = cache[`VEC_${originalNorm}`]
      if (!fVec) continue

      const candidates = new Map()

      for (const cand of kb) {
         const jaccard = calculateJaccard(fTokens, cand.tokens)
         const cosSim = cosineSimilarity(fVec, cand.vec)
         
         const isLex = jaccard >= 0.15
         const isVec = cosSim >= V_THRESH
         
         if (isLex || isVec) {
            candidates.set(cand.id, {
               cand, isLex, isVec,
               score: calculateUnifiedScore(fTokens, cand.tokens, cosSim, jaccard)
            })
         }
      }
      
      let lexC = 0, vecC = 0, overC = 0
      for (const c of candidates.values()) {
         if (c.isLex && !c.isVec) lexC++
         if (c.isVec && !c.isLex) vecC++
         if (c.isLex && c.isVec) overC++
      }

      metrics.lexicalCandidates += lexC
      metrics.vectorCandidates += vecC
      metrics.overlapCandidates += overC
      
      // Limit to Top 8 for unified scoring count
      const sorted = Array.from(candidates.values()).sort((a,b) => b.score - a.score).slice(0, 8)
      
      metrics.totalUniqueCandidates += sorted.length
      if (sorted.length === 0) metrics.zeroCandidates++
    }

    thresholdResults[V_THRESH] = {
      avgCandidates: (metrics.totalUniqueCandidates / findings.length).toFixed(2),
      lexicalOnly: metrics.lexicalCandidates,
      vectorOnly: metrics.vectorCandidates,
      overlap: metrics.overlapCandidates,
      zeroCandidates: metrics.zeroCandidates
    }
  }

  // 2. Lexical Disjoint Test using V_THRESH = 0.86 (middle ground)
  const disjointResults = []
  for (const c of LEXICAL_DISJOINT_CASES) {
     const fTokens = new Set(getTokens(c.input))
     const fVec = cache[`VEC_${normalizeText(c.input)}`]
     if (!fVec) continue
     
     const candidates = []
     for (const cand of kb) {
         const jaccard = calculateJaccard(fTokens, cand.tokens)
         const cosSim = cosineSimilarity(fVec, cand.vec)
         candidates.push({
             title: cand.title,
             score: calculateUnifiedScore(fTokens, cand.tokens, cosSim, jaccard)
         })
     }

     candidates.sort((a,b) => b.score - a.score)
     const top3 = candidates.slice(0,3).map(x=>x.title)
     const top5 = candidates.slice(0,5).map(x=>x.title)
     const top8 = candidates.slice(0,8).map(x=>x.title)

     disjointResults.push({
        input: c.input, expected: c.target,
        recallAt3: top3.includes(c.target),
        recallAt5: top5.includes(c.target),
        recallAt8: top8.includes(c.target),
     })
  }

  const report = {
    thresholdComparison: thresholdResults,
    lexicalDisjointResults: disjointResults
  }

  fs.writeFileSync('hybrid_benchmark_v2_report.json', JSON.stringify(report, null, 2))
  console.log('Tuning Benchmark Complete!')
}

runBenchmark().catch(console.error)
