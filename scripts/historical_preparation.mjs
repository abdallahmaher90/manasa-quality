import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'
import crypto from 'crypto'
// Gemini import removed/disabled as requested for bulk

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const args = process.argv.slice(2)
const IS_LOCAL_ONLY = args.includes('--local-only')

console.log(`=========================================`)
console.log(`MODE = ${IS_LOCAL_ONLY ? 'LOCAL_ONLY_SHADOW' : 'STANDARD'}`)
console.log(`GEMINI_DISABLED_FOR_BULK = true`)
console.log(`=========================================`)

const MEDICAL_CONCEPTS = {
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
          if (norm.includes(normalizeText(alias))) {
             concepts.add(concept); break;
          }
       }
   }
   return concepts
}

const STOP_WORDS = new Set(['في', 'من', 'على', 'لا', 'يوجد', 'عدم', 'غير', 'تم', 'عن', 'و', 'أو', 'إلى', 'ان', 'هل'])
function getTokens(text) { return normalizeText(text).split(' ').filter(w => w.length > 2 && !STOP_WORDS.has(w)) }

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) return 0
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
  const W_LEX = 0.20, W_VEC = 0.40, W_CONCEPT = 0.40
  let conceptMatchScore = 0
  if (fConcepts.size > 0 && cConcepts.size > 0) {
      let intersection = 0
      for (const c of fConcepts) {
         if (cConcepts.has(c)) {
            if (c.startsWith('ENT_')) intersection += 1.5
            else if (c.startsWith('DEF_')) intersection += 1.0
         } else if (c.startsWith('DEF_')) {
            let hasSameEntity = false
            for (const fc of fConcepts) if (fc.startsWith('ENT_') && cConcepts.has(fc)) hasSameEntity = true
            if (hasSameEntity) {
               let hasDiffDefect = false
               for (const cc of cConcepts) if (cc.startsWith('DEF_')) hasDiffDefect = true
               if (hasDiffDefect) intersection -= 0.5
            }
         }
      }
      conceptMatchScore = Math.max(0, Math.min(1.0, intersection / fConcepts.size))
  }
  return (jaccard * W_LEX) + (cosSim * W_VEC) + (conceptMatchScore * W_CONCEPT)
}

const CACHE_FILE = 'hybrid_benchmark_cache.json'
let cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {}

async function getVec(text) {
  const norm = normalizeText(text)
  let v = cache[`VEC_${norm}`]
  if (!v) {
      const oldNorm = text.toLowerCase().replace(/[أإآا]/g, 'ا').replace(/[ةه]/g, 'ه').replace(/[ىي]/g, 'ي')
         .replace(/[^\w\s\u0600-\u06FF]/g, ' ').replace(/\s+/g, ' ').trim()
      v = cache[`VEC_${oldNorm}`]
  }
  // DO NOT call Gemini if embedding is missing
  return v || null
}

async function run() {
  if (!IS_LOCAL_ONLY) {
      console.log("Please run with --local-only flag to execute shadow run.");
      return;
  }

  console.log('Loading all findings...')
  let allFindings = []
  let page = 0
  while (true) {
      const { data } = await supabase.from('report_findings').select('*').order('created_at', { ascending: true }).range(page*1000, (page+1)*1000 - 1)
      if (!data || data.length === 0) break
      allFindings = allFindings.concat(data)
      page++
  }
  console.log(`Loaded ${allFindings.length} findings!`)
  
  console.log('Loading existing DB groups to prepopulate KB...')
  const { data: dbGroups } = await supabase.from('recurrence_groups').select('*')
  
  const kb = []
  for (const g of dbGroups) {
      const v = await getVec(g.title)
      kb.push({
          id: g.id, title: g.title,
          tokens: new Set(getTokens(g.title)),
          concepts: extractConcepts(g.title),
          vec: v || [],
          findingIds: []
      })
  }

  const V_THRESH = 0.86
  
  // Load previous Gemini results for historical comparison
  const previousResultsFile = 'historical_preparation_results.json';
  const previousResults = fs.existsSync(previousResultsFile) ? JSON.parse(fs.readFileSync(previousResultsFile, 'utf8')) : [];
  const prevMap = new Map();
  for (const r of previousResults) {
      prevMap.set(r.finding_id, r);
  }

  const localResults = [];
  const summary = {
      processed: 0,
      local_SAME_ISSUE: 0,
      local_DISTINCT: 0,
      local_UNCERTAIN: 0,
      missing_embeddings: 0,
      zero_candidates: 0,
      hard_negative_blocks: 0,
      total_candidates_evaluated: 0
  };

  const regressionReport = {
      totalCompared: 0,
      matches: 0,
      conflicts: 0,
      undercalls: 0, // Local was uncertain, Gemini was confident
      details: []
  };

  // Smoke test successes mapping for regression testing
  const smokeFile = 'resume_smoke_test_v2.json';
  const smokeTestResults = fs.existsSync(smokeFile) ? JSON.parse(fs.readFileSync(smokeFile, 'utf8')) : [];
  for (const sr of smokeTestResults) {
      if (sr.new_decision !== 'UNCERTAIN' && prevMap.has(sr.finding_id)) {
          prevMap.get(sr.finding_id).decision = sr.new_decision; // Use the successful smoke test decision as ground truth
      }
  }

  for (const f of allFindings) {
      summary.processed++;
      const fVec = await getVec(f.original_text)
      const fTokens = new Set(getTokens(f.original_text))
      const fConcepts = extractConcepts(f.original_text)
      
      let embeddingAvailable = true;
      if (!fVec) {
          summary.missing_embeddings++;
          embeddingAvailable = false;
      }

      const scores = []
      if (fVec) {
          for (const group of kb) {
             const jaccard = calculateJaccard(fTokens, group.tokens)
             const cosSim = cosineSimilarity(fVec, group.vec)
             let conceptMatch = 0
             for (const c of fConcepts) if (group.concepts.has(c)) conceptMatch++
             
             if (jaccard >= 0.15 || cosSim >= V_THRESH || conceptMatch > 0) {
                 const score = calculateUnifiedScore(fTokens, group.tokens, fConcepts, group.concepts, cosSim, jaccard)
                 scores.push({ id: group.id, title: group.title, score, cosSim, jaccard, concepts: Array.from(group.concepts) })
             }
          }
          scores.sort((a,b) => b.score - a.score)
      }
      
      const topCandidates = scores.slice(0, 5)
      summary.total_candidates_evaluated += topCandidates.length;

      let localDecision = 'LOCAL_UNCERTAIN';
      let localReason = '';
      let matchId = null;
      let hardNegativeFlags = [];
      let entityMatches = [];
      let defectMatches = [];
      let confidence = 'LOW';

      if (topCandidates.length === 0) {
          summary.zero_candidates++;
          localDecision = 'LOCAL_UNCERTAIN';
          localReason = embeddingAvailable ? 'Zero candidates above threshold' : 'Missing embedding';
      } else {
          const best = topCandidates[0];
          
          const fEnt = Array.from(fConcepts).filter(c => c.startsWith('ENT_'));
          const cEnt = best.concepts.filter(c => c.startsWith('ENT_'));
          
          const fDef = Array.from(fConcepts).filter(c => c.startsWith('DEF_'));
          const cDef = best.concepts.filter(c => c.startsWith('DEF_'));
          
          entityMatches = fEnt.filter(x => cEnt.includes(x));
          defectMatches = fDef.filter(x => cDef.includes(x));
          
          let entityConflict = (fEnt.length > 0 && cEnt.length > 0 && entityMatches.length === 0);
          let defectConflict = (entityMatches.length > 0 && fDef.length > 0 && cDef.length > 0 && defectMatches.length === 0);
          
          if (entityConflict) hardNegativeFlags.push('ENTITY_CONFLICT');
          if (defectConflict) hardNegativeFlags.push('DEFECT_CONFLICT');
          
          if (hardNegativeFlags.length > 0) {
              summary.hard_negative_blocks++;
              localDecision = 'LOCAL_HIGH_CONFIDENCE_DISTINCT';
              localReason = 'Hard negative confirmed: ' + hardNegativeFlags.join(', ');
              confidence = 'HIGH';
          } else {
              // No hard negative. Check if we have high confidence for SAME_ISSUE
              if (best.score > 0.78 || (best.cosSim >= 0.93)) {
                  if (fEnt.length === 0 && cEnt.length === 0 && best.jaccard < 0.2) {
                      localDecision = 'LOCAL_UNCERTAIN';
                      localReason = 'High vector score but no entities and low lexical overlap';
                  } else {
                      localDecision = 'LOCAL_HIGH_CONFIDENCE_SAME_ISSUE';
                      localReason = `High confidence match (Score: ${best.score.toFixed(2)}, Vec: ${best.cosSim.toFixed(2)})`;
                      confidence = 'HIGH';
                      matchId = best.id;
                  }
              } else {
                   localDecision = 'LOCAL_UNCERTAIN';
                   localReason = `Score ${best.score.toFixed(2)} below high confidence threshold`;
              }
          }
      }

      if (localDecision === 'LOCAL_HIGH_CONFIDENCE_SAME_ISSUE') summary.local_SAME_ISSUE++;
      else if (localDecision === 'LOCAL_HIGH_CONFIDENCE_DISTINCT') summary.local_DISTINCT++;
      else summary.local_UNCERTAIN++;

      const prev = prevMap.get(f.id);
      
      const record = {
          finding_id: f.id,
          original_text: f.original_text,
          hospital_id: f.hospital_id,
          top_candidates: topCandidates.map(c => ({ id: c.id, title: c.title, score: c.score })),
          top_candidate_score: topCandidates.length > 0 ? topCandidates[0].score : null,
          entity_matches: entityMatches,
          defect_matches: defectMatches,
          hard_negative_flags: hardNegativeFlags,
          local_decision: localDecision,
          confidence: confidence,
          proposed_recurrence_group_id: matchId || ('NEW_' + crypto.randomUUID()),
          decision_reason: localReason,
          embedding_available: embeddingAvailable,
          previous_gemini_decision: prev ? prev.decision : null,
          previous_gemini_failure_reason: prev ? prev.reason : null
      };
      
      localResults.push(record);

      // Regression Analysis
      if (prev && prev.decision && prev.decision !== 'UNCERTAIN') {
          regressionReport.totalCompared++;
          
          let isMatch = false;
          let isConflict = false;
          let isUndercall = false;
          
          if (prev.decision === 'SAME_ISSUE' && localDecision === 'LOCAL_HIGH_CONFIDENCE_SAME_ISSUE') isMatch = true;
          else if (prev.decision === 'DISTINCT' && localDecision === 'LOCAL_HIGH_CONFIDENCE_DISTINCT') isMatch = true;
          else if (localDecision === 'LOCAL_UNCERTAIN') isUndercall = true;
          else isConflict = true;
          
          if (isMatch) regressionReport.matches++;
          else if (isUndercall) regressionReport.undercalls++;
          else {
              regressionReport.conflicts++;
              regressionReport.details.push({
                  finding_id: f.id,
                  text: f.original_text,
                  gemini_decision: prev.decision,
                  local_decision: localDecision,
                  local_reason: localReason
              });
          }
      }
  }

  summary.average_candidates_per_finding = (summary.total_candidates_evaluated / summary.processed).toFixed(2);

  fs.writeFileSync('historical_local_preparation_results.json', JSON.stringify(localResults, null, 2))
  fs.writeFileSync('historical_local_preparation_summary.json', JSON.stringify(summary, null, 2))
  fs.writeFileSync('local_engine_regression_report.json', JSON.stringify(regressionReport, null, 2))
  
  console.log(`\n=========================================`)
  console.log(`LOCAL PREPARATION SHADOW RUN COMPLETE`);
  console.log(`Processed: ${summary.processed}`)
  console.log(`LOCAL_HIGH_CONFIDENCE_SAME_ISSUE: ${summary.local_SAME_ISSUE}`)
  console.log(`LOCAL_HIGH_CONFIDENCE_DISTINCT: ${summary.local_DISTINCT}`)
  console.log(`LOCAL_UNCERTAIN: ${summary.local_UNCERTAIN}`)
  console.log(`Missing Embeddings: ${summary.missing_embeddings}`)
  console.log(`Zero Candidates: ${summary.zero_candidates}`)
  console.log(`Hard-Negative Blocks: ${summary.hard_negative_blocks}`)
  console.log(`-----------------------------------------`)
  console.log(`REGRESSION AGAINST KNOWN GOOD CASES`);
  console.log(`Total Compared: ${regressionReport.totalCompared}`);
  console.log(`Matches (Agreement): ${regressionReport.matches}`);
  console.log(`Undercalls (Local uncertain, Gemini confident): ${regressionReport.undercalls}`);
  console.log(`Conflicts (Disagreements): ${regressionReport.conflicts}`);
  console.log(`=========================================`)
}

run().catch(console.error)
