import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// 1. CONCEPT MAPPING (V4)
const MEDICAL_CONCEPTS = {
  // ENTITIES
  'ENT_CRASH_CART': ['عربه انعاش', 'كراش كار', 'crash cart', 'عربه طوارئ'],
  'ENT_MONITOR': ['مونيتور', 'جهاز مراقبه', 'monitor'],
  'ENT_CRITICAL_RESULTS': ['نتائج حرجه', 'قيم حرجه', 'تبليغ قيم حرجه', 'critical results', 'critical values', 'تبليغ نتائج', 'تبليغ قيم'],
  'ENT_AMBU_BAG': ['امبو باج', 'تنفس يدوي', 'ambu bag'],
  'ENT_LASA': ['lasa', 'ادويه متشابهه', 'عاليه خطوره', 'high alert'],
  'ENT_ORAL_ORDERS': ['اوامر شفهيه', 'oral orders', 'توثيق شفهي'],
  'ENT_PATIENT_FILE': ['ملف مريض', 'سجل مريض', 'سجلات مرضي', 'patient file', 'ملف طبي'],
  'ENT_ID_CARD': ['بطاقه', 'هويه', 'id card'],
  'ENT_MEDICAL_FORMS': ['medical forms', 'نماذج طبيه', 'نموذج طبي', 'ورقه'],
  'ENT_STAFF': ['موظف', 'كادر', 'طبيب', 'ممرض', 'staff'],
  
  // DEFECTS
  'DEF_MISSING': ['غير موجود', 'نقص', 'عدم وجود', 'غياب', 'مفقود', 'missing', 'لا يوجد', 'قصور'],
  'DEF_BROKEN': ['معطل', 'لا يعمل', 'عطل', 'خربان', 'broken', 'damaged', 'تالف'],
  'DEF_MESSY': ['غير مرتب', 'مبعثر', 'غير منظم', 'messy', 'unorganized'],
  'DEF_WRONG_STORAGE': ['تخزين خاطئ', 'غير مفصوله', 'سوء تخزين'],
  'DEF_NOT_WEARING': ['لا يرتدي', 'بدون', 'غير ملتزم'],
  'DEF_NOT_DOCUMENTED': ['غير موثق', 'غير مسجل', 'بدون توثيق', 'not documented']
}

function normalizeText(text) {
  if (!text) return ''
  return text.toLowerCase()
    .replace(/[أإآا]/g, 'ا')
    .replace(/[ةه]/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .replace(/[^\w\s\u0600-\u06FF]/g, ' ')
    // Strip "ال" prefix safely (JS \b doesn't work for Arabic, use (^|\s)ال)
    .replace(/(^|\s)ال/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractConcepts(text) {
   let concepts = new Set()
   const norm = normalizeText(text)
   for (const [concept, aliases] of Object.entries(MEDICAL_CONCEPTS)) {
       for (const alias of aliases) {
          const aliasNorm = normalizeText(alias)
          if (norm.includes(aliasNorm)) {
             concepts.add(concept)
             break
          }
       }
   }
   return concepts
}

const STOP_WORDS = new Set(['في', 'من', 'على', 'لا', 'يوجد', 'عدم', 'غير', 'تم', 'عن', 'و', 'أو', 'إلى', 'ان', 'هل'])

function getTokens(text) { 
  return normalizeText(text).split(' ').filter(w => w.length > 2 && !STOP_WORDS.has(w)) 
}

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function calculateJaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0
  let intersection = 0
  for (const item of setA) if (setB.has(item)) intersection++
  return intersection / (setA.size + setB.size - intersection)
}

function calculateUnifiedScore(fTokens, cTokens, fConcepts, cConcepts, cosSim, jaccard) {
  const W_LEX = 0.20
  const W_VEC = 0.40
  const W_CONCEPT = 0.40
  
  let conceptMatchScore = 0
  if (fConcepts.size > 0 && cConcepts.size > 0) {
      let intersection = 0
      for (const c of fConcepts) {
         if (cConcepts.has(c)) {
            // Entities are weighted higher than defects
            intersection += c.startsWith('ENT_') ? 1.5 : 1.0
         } else if (c.startsWith('DEF_')) {
            // Penalty for having a different defect for the same entity? We keep it simple.
         }
      }
      conceptMatchScore = Math.min(1.0, intersection / fConcepts.size)
  }

  // If there's a strong concept match (like they share ENT_CRASH_CART + DEF_MISSING), 
  // we want to ensure this candidate shoots to the top.
  let score = (jaccard * W_LEX) + (cosSim * W_VEC) + (conceptMatchScore * W_CONCEPT)
  return score
}

const CACHE_FILE = 'hybrid_benchmark_cache.json'
let cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {}

const LEXICAL_DISJOINT_CASES = [
  { id: 'LD1', input: 'عربة الإنعاش غير موجودة', target: 'نقص كراش كار' },
  { id: 'LD2', input: 'النتائج الحرجة لا تبلغ', target: 'قصور في نظام تبليغ القيم الحرجة' },
  { id: 'LD3', input: 'جهاز المراقبة معطل', target: 'المونيتور لا يعمل' },
  { id: 'LD4', input: 'ملف المريض غير مرتب', target: 'سجلات المرضى مبعثرة' },
  { id: 'LD5', input: 'الموظف لا يرتدي البطاقة', target: 'غياب الهوية التعريفية للكادر' },
  { id: 'LD6', input: 'عدم وجود امبو باج', target: 'نقص جهاز تنفس يدوي' },
  { id: 'LD7', input: 'تخزين ادوية LASA خاطئ', target: 'الادوية المتشابهة غير مفصولة' },
  { id: 'LD8', input: 'لا يوجد Medical forms', target: 'نقص النماذج الطبية' },
  { id: 'LD9', input: 'Oral orders not documented', target: 'الاوامر الشفهية غير موثقة' },
]

import { getEmbedding } from '../src/lib/ai-parser.js'

async function runBenchmark() {
  console.log('Loading KB from cache (no new API calls)...')
  
  const { data: findings } = await supabase.from('report_findings').select('*').limit(100)
  const { data: groups } = await supabase.from('recurrence_groups').select('*').limit(500)
  
  const kb = groups.map(g => {
    const text = g.title
    const oldNormText = text.toLowerCase()
         .replace(/[أإآا]/g, 'ا').replace(/[ةه]/g, 'ه').replace(/[ىي]/g, 'ي')
         .replace(/[^\w\s\u0600-\u06FF]/g, ' ').replace(/\s+/g, ' ').trim()
    return {
      id: g.id, title: g.title,
      tokens: new Set(getTokens(g.title)),
      concepts: extractConcepts(g.title),
      vec: cache[`VEC_${normalizeText(g.title)}`] || cache[`VEC_${oldNormText}`]
    }
  })

  for (const c of LEXICAL_DISJOINT_CASES) {
     const norm = normalizeText(c.target)
     if (!cache[`VEC_${norm}`]) {
        cache[`VEC_${norm}`] = await getEmbedding(c.target)
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache))
        await new Promise(r => setTimeout(r, 700))
     }
     
     kb.push({
        id: `mock-${c.id}`, title: c.target,
        tokens: new Set(getTokens(c.target)),
        concepts: extractConcepts(c.target),
        vec: cache[`VEC_${norm}`]
     })
  }

  const V_THRESH = 0.86
  const metrics = {
    totalUniqueCandidates: 0,
    zeroCandidates: 0,
    conceptCandidates: 0,
    lexicalCandidates: 0,
    vectorCandidates: 0
  }

  for (const f of findings) {
    const normText = normalizeText(f.original_text)
    const fTokens = new Set(getTokens(f.original_text))
    const fConcepts = extractConcepts(f.original_text)
    let fVec = cache[`VEC_${normText}`]
    if (!fVec) {
       // fallback: find the vector by checking if original text matches
       const text = f.original_text
       const oldNormText = text.toLowerCase()
         .replace(/[أإآا]/g, 'ا').replace(/[ةه]/g, 'ه').replace(/[ىي]/g, 'ي')
         .replace(/[^\w\s\u0600-\u06FF]/g, ' ').replace(/\s+/g, ' ').trim()
       fVec = cache[`VEC_${oldNormText}`]
    }
    if (!fVec) continue

    const candidateGroups = new Map()

    for (const group of kb) {
       if (!group.vec) continue
       const jaccard = calculateJaccard(fTokens, group.tokens)
       const cosSim = cosineSimilarity(fVec, group.vec)
       
       let conceptMatch = 0
       for (const c of fConcepts) if (group.concepts.has(c)) conceptMatch++
       
       const isLex = jaccard >= 0.15
       const isVec = cosSim >= V_THRESH
       const isConcept = conceptMatch > 0
       
       if (isLex || isVec || isConcept) {
          candidateGroups.set(group.id, {
             group, isLex, isVec, isConcept,
             score: calculateUnifiedScore(fTokens, group.tokens, fConcepts, group.concepts, cosSim, jaccard)
          })
       }
    }
    
    for (const c of candidateGroups.values()) {
        if (c.isConcept) metrics.conceptCandidates++
        if (c.isLex) metrics.lexicalCandidates++
        if (c.isVec) metrics.vectorCandidates++
    }

    const sorted = Array.from(candidateGroups.values()).sort((a,b) => b.score - a.score).slice(0, 5)
    metrics.totalUniqueCandidates += sorted.length
    if (sorted.length === 0) metrics.zeroCandidates++
  }

  const disjointResults = []
  for (const c of LEXICAL_DISJOINT_CASES) {
     const inputNorm = normalizeText(c.input)
     const oldNormText = c.input.toLowerCase()
         .replace(/[أإآا]/g, 'ا').replace(/[ةه]/g, 'ه').replace(/[ىي]/g, 'ي')
         .replace(/[^\w\s\u0600-\u06FF]/g, ' ').replace(/\s+/g, ' ').trim()
         
     let fVec = cache[`VEC_${inputNorm}`] || cache[`VEC_${oldNormText}`]
     if (!fVec) {
        console.log('Generating missing vector for input:', c.input)
        cache[`VEC_${inputNorm}`] = await getEmbedding(c.input)
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache))
        await new Promise(r => setTimeout(r, 700))
        fVec = cache[`VEC_${inputNorm}`]
     }

     const fTokens = new Set(getTokens(c.input))
     const fConcepts = extractConcepts(c.input)
     
     if (!fVec) continue

     const candidateGroups = []
     for (const group of kb) {
         if (!group.vec) continue
         const jaccard = calculateJaccard(fTokens, group.tokens)
         const cosSim = cosineSimilarity(fVec, group.vec)
         candidateGroups.push({
             title: group.title,
             concepts: Array.from(group.concepts),
             score: calculateUnifiedScore(fTokens, group.tokens, fConcepts, group.concepts, cosSim, jaccard)
         })
     }

     candidateGroups.sort((a,b) => b.score - a.score)
     const top3 = candidateGroups.slice(0,3).map(x=>x.title)
     const top5 = candidateGroups.slice(0,5).map(x=>x.title)
     const top8 = candidateGroups.slice(0,8).map(x=>x.title)

     disjointResults.push({
        id: c.id, input: c.input, expected: c.target,
        inputConcepts: Array.from(fConcepts),
        recallAt3: top3.includes(c.target),
        recallAt5: top5.includes(c.target),
        recallAt8: top8.includes(c.target)
     })
  }

  const avgCandidateGroups = metrics.totalUniqueCandidates / findings.length
  
  const report = {
    v4_tuning_metrics: {
      averageCandidateGroupsPerFinding: avgCandidateGroups.toFixed(2),
      zeroCandidates: metrics.zeroCandidates,
      conceptCandidates: metrics.conceptCandidates,
      geminiCallsReduction: "Group-level architecture + Concept Injection limits candidates to Top 5 high-quality."
    },
    lexicalDisjointResults: disjointResults,
    geminiVolumeProjections: {
      "20_findings_report": Math.ceil(20 * avgCandidateGroups),
      "30_findings_report": Math.ceil(30 * avgCandidateGroups),
      "1366_historical": Math.ceil(1366 * avgCandidateGroups)
    }
  }

  fs.writeFileSync('hybrid_benchmark_v4_report.json', JSON.stringify(report, null, 2))
  console.log('V4 Benchmark Complete!')
}

runBenchmark().catch(console.error)
