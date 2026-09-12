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
  'DEF_INCOMPLETE': ['غير مكتمل', 'ناقص', 'incomplete', 'غير كامل'],
  'DEF_BROKEN': ['معطل', 'لا يعمل', 'عطل', 'خربان', 'broken', 'damaged', 'تالف'],
  'DEF_CALIBRATION': ['معايره', 'صيانه', 'calibration', 'maintenance'],
  'DEF_MESSY': ['غير مرتب', 'مبعثر', 'غير منظم', 'messy', 'unorganized'],
  'DEF_WRONG_STORAGE': ['تخزين خاطئ', 'غير مفصوله', 'سوء تخزين'],
  'DEF_NOT_WEARING': ['لا يرتدي', 'بدون', 'غير ملتزم'],
  'DEF_NOT_DOCUMENTED': ['غير موثق', 'غير مسجل', 'بدون توثيق', 'not documented'],
  'DEF_DELAYED': ['تاخير', 'متاخر', 'delayed', 'late']
}

function normalizeText(text) {
  if (!text) return ''
  return text.toLowerCase()
    .replace(/[أإآا]/g, 'ا')
    .replace(/[ةه]/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .replace(/[^\w\s\u0600-\u06FF]/g, ' ')
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
  if (!vecA || !vecB) return 0
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

function calculateUnifiedScoreDetails(fTokens, cTokens, fConcepts, cConcepts, cosSim, jaccard) {
  const W_LEX = 0.20
  const W_VEC = 0.40
  const W_CONCEPT = 0.40
  
  let conceptMatchScore = 0
  let entityScore = 0
  let defectScore = 0
  
  if (fConcepts.size > 0 && cConcepts.size > 0) {
      let intersection = 0
      for (const c of fConcepts) {
         if (cConcepts.has(c)) {
            if (c.startsWith('ENT_')) {
                intersection += 1.5
                entityScore += 1.5
            } else if (c.startsWith('DEF_')) {
                intersection += 1.0
                defectScore += 1.0
            }
         } else if (c.startsWith('DEF_')) {
            // Contradictory defect for the same entity? Penalty
            let hasSameEntity = false
            for (const fc of fConcepts) if (fc.startsWith('ENT_') && cConcepts.has(fc)) hasSameEntity = true
            if (hasSameEntity) {
               let hasDiffDefect = false
               for (const cc of cConcepts) if (cc.startsWith('DEF_')) hasDiffDefect = true
               if (hasDiffDefect) {
                  intersection -= 0.5 // Penalty for matching entity but mismatching explicitly defined defect
                  defectScore -= 0.5
               }
            }
         }
      }
      conceptMatchScore = Math.max(0, Math.min(1.0, intersection / fConcepts.size))
  }

  let finalScore = (jaccard * W_LEX) + (cosSim * W_VEC) + (conceptMatchScore * W_CONCEPT)
  return { finalScore, lexScore: jaccard*W_LEX, vecScore: cosSim*W_VEC, conceptScore: conceptMatchScore*W_CONCEPT, entityScore, defectScore }
}

const CACHE_FILE = 'hybrid_benchmark_cache.json'
let cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {}

import { getEmbedding } from '../src/lib/ai-parser.js'

async function getVec(text) {
  const norm = normalizeText(text)
  let v = cache[`VEC_${norm}`]
  if (!v) {
      const oldNorm = text.toLowerCase()
         .replace(/[أإآا]/g, 'ا').replace(/[ةه]/g, 'ه').replace(/[ىي]/g, 'ي')
         .replace(/[^\w\s\u0600-\u06FF]/g, ' ').replace(/\s+/g, ' ').trim()
      v = cache[`VEC_${oldNorm}`]
  }
  if (!v) {
      let retries = 3
      while (retries > 0) {
          try {
              v = await getEmbedding(text)
              if (v) {
                 cache[`VEC_${norm}`] = v
                 fs.writeFileSync(CACHE_FILE, JSON.stringify(cache))
              }
              await new Promise(r => setTimeout(r, 700))
              break
          } catch (e) {
              retries--
              console.log(`Failed to embed "${norm}", retries left: ${retries}`)
              await new Promise(r => setTimeout(r, 2000))
          }
      }
  }
  return v
}

async function runAudit() {
  const report = {}
  console.log('Fetching all findings (1366)...')
  const { data: allFindings } = await supabase.from('report_findings').select('*')
  
  console.log('Fetching KB groups (500 limit for speed in dry run)...')
  const { data: groups } = await supabase.from('recurrence_groups').select('*').limit(500)
  
  const kb = []
  for (const g of groups) {
      const v = await getVec(g.title)
      kb.push({
          id: g.id, title: g.title,
          tokens: new Set(getTokens(g.title)),
          concepts: extractConcepts(g.title),
          vec: v
      })
  }

  const V_THRESH = 0.86

  // 1. Deep Dive LD1 & LD2
  const ldCases = [
      { id: 'LD1', input: 'عربة الإنعاش غير موجودة', target: 'نقص كراش كار' },
      { id: 'LD2', input: 'النتائج الحرجة لا تبلغ', target: 'قصور في نظام تبليغ القيم الحرجة' }
  ]
  report.ldDeepDive = {}

  for (const c of ldCases) {
     const tVec = await getVec(c.target)
     const fVec = await getVec(c.input)
     const fTokens = new Set(getTokens(c.input))
     const fConcepts = extractConcepts(c.input)
     
     // Inject Mock Target
     const mockKb = [...kb, {
        id: `mock-${c.id}`, title: c.target,
        tokens: new Set(getTokens(c.target)),
        concepts: extractConcepts(c.target),
        vec: tVec
     }]

     const candidateGroups = []
     for (const group of mockKb) {
         const jaccard = calculateJaccard(fTokens, group.tokens)
         const cosSim = cosineSimilarity(fVec, group.vec)
         const s = calculateUnifiedScoreDetails(fTokens, group.tokens, fConcepts, group.concepts, cosSim, jaccard)
         candidateGroups.push({
             id: group.id,
             title: group.title,
             lexScore: s.lexScore.toFixed(3),
             vecScore: s.vecScore.toFixed(3),
             conceptScore: s.conceptScore.toFixed(3),
             entityScore: s.entityScore,
             defectScore: s.defectScore,
             finalScore: s.finalScore
         })
     }

     candidateGroups.sort((a,b) => b.finalScore - a.finalScore)
     const top10 = candidateGroups.slice(0,10)
     const targetRank = candidateGroups.findIndex(x => x.id === `mock-${c.id}`) + 1

     report.ldDeepDive[c.id] = {
        input: c.input,
        target: c.target,
        targetRank: targetRank,
        targetFoundInTop10: targetRank > 0 && targetRank <= 10,
        top10: top10
     }
  }

  // 2. Hard Negatives Test (Concept Extractor Test)
  const hardNegatives = [
      { input: 'عربة الانعاش مفقودة', candidate: 'عربة الانعاش غير مرتبة', desc: 'Same Entity + Different Defect (Missing vs Messy)' },
      { input: 'عربة الانعاش معطلة', candidate: 'جهاز المراقبة معطل', desc: 'Same Defect + Different Entity (Crash Cart vs Monitor)' },
      { input: 'الاوامر الشفهية غير موثقة', candidate: 'تسويات دوائية غير موثقة', desc: 'Oral Orders vs Med Rec (Not Documented)' }
  ]
  report.hardNegatives = []
  for (const hn of hardNegatives) {
      const fVec = await getVec(hn.input)
      const cVec = await getVec(hn.candidate)
      const fTokens = new Set(getTokens(hn.input))
      const cTokens = new Set(getTokens(hn.candidate))
      const fConcepts = extractConcepts(hn.input)
      const cConcepts = extractConcepts(hn.candidate)
      const jaccard = calculateJaccard(fTokens, cTokens)
      const cosSim = cosineSimilarity(fVec, cVec)
      const s = calculateUnifiedScoreDetails(fTokens, cTokens, fConcepts, cConcepts, cosSim, jaccard)
      report.hardNegatives.push({
          desc: hn.desc,
          input: hn.input, candidate: hn.candidate,
          fConcepts: Array.from(fConcepts), cConcepts: Array.from(cConcepts),
          scoreDetails: s
      })
  }

  // 3 & 4 & 6. Shadow Run 1366 & Metrics
  const shadowMetrics = {
      totalFindings: allFindings.length,
      zeroCandidates: 0,
      totalCandidateGroups: 0,
      candidatesListLengths: [],
      geminiProjectedCalls: 0
  }

  console.log('Running shadow benchmark on all findings...')
  for (const f of allFindings) {
      const fVec = await getVec(f.original_text)
      const fTokens = new Set(getTokens(f.original_text))
      const fConcepts = extractConcepts(f.original_text)
      
      let candidateCount = 0
      const scores = []
      for (const group of kb) {
         const jaccard = calculateJaccard(fTokens, group.tokens)
         const cosSim = cosineSimilarity(fVec, group.vec)
         
         let conceptMatch = 0
         for (const c of fConcepts) if (group.concepts.has(c)) conceptMatch++
         
         if (jaccard >= 0.15 || cosSim >= V_THRESH || conceptMatch > 0) {
             const s = calculateUnifiedScoreDetails(fTokens, group.tokens, fConcepts, group.concepts, cosSim, jaccard)
             scores.push(s.finalScore)
         }
      }
      
      scores.sort((a,b) => b - a)
      const top5 = scores.slice(0, 5)
      candidateCount = top5.length

      if (candidateCount === 0) shadowMetrics.zeroCandidates++
      shadowMetrics.totalCandidateGroups += candidateCount
      shadowMetrics.candidatesListLengths.push(candidateCount)
      shadowMetrics.geminiProjectedCalls += candidateCount // Max calls per finding is the length of candidate list
  }

  shadowMetrics.candidatesListLengths.sort((a,b) => a - b)
  shadowMetrics.p50 = shadowMetrics.candidatesListLengths[Math.floor(shadowMetrics.candidatesListLengths.length * 0.5)] || 0
  shadowMetrics.p95 = shadowMetrics.candidatesListLengths[Math.floor(shadowMetrics.candidatesListLengths.length * 0.95)] || 0
  shadowMetrics.avgCandidates = (shadowMetrics.totalCandidateGroups / shadowMetrics.totalFindings).toFixed(2)

  report.shadowRun1366 = shadowMetrics
  
  // FINAL VERDICT calculation
  let verdict = 'NOT_READY'
  if (report.ldDeepDive['LD1'].targetRank > 0 && report.ldDeepDive['LD1'].targetRank <= 20) {
      verdict = 'READY'
  }

  report.finalVerdict = verdict

  fs.writeFileSync('v4_final_audit_report.json', JSON.stringify(report, null, 2))
  console.log('Audit Complete!')
}

runAudit().catch(console.error)
