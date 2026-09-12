import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

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

function evaluateSuspicion(findingConcepts, protoConcepts, score, vecScore) {
    const fEnt = Array.from(findingConcepts).filter(c => c.startsWith('ENT_'));
    const pEnt = Array.from(protoConcepts).filter(c => c.startsWith('ENT_'));
    const fDef = Array.from(findingConcepts).filter(c => c.startsWith('DEF_'));
    const pDef = Array.from(protoConcepts).filter(c => c.startsWith('DEF_'));
    
    let isSameEntity = false;
    let isDifferentEntity = false;
    let isSameDefect = false;
    let isDifferentDefect = false;
    
    if (fEnt.length > 0 && pEnt.length > 0) {
        if (fEnt.some(e => pEnt.includes(e))) isSameEntity = true;
        else isDifferentEntity = true;
    }
    
    if (fDef.length > 0 && pDef.length > 0) {
        if (fDef.some(e => pDef.includes(e))) isSameDefect = true;
        else isDifferentDefect = true;
    }
    
    let suspicionLevel = 'NONE';
    let reasons = [];
    
    // A) SAME ENTITY + DIFFERENT DEFECT
    if (isSameEntity && isDifferentDefect) {
        suspicionLevel = 'CRITICAL';
        reasons.push('SAME_ENTITY_DIFFERENT_DEFECT');
    }
    
    // B) SAME DEFECT + DIFFERENT ENTITY
    if (isDifferentEntity && isSameDefect) {
        suspicionLevel = 'HIGH';
        reasons.push('SAME_DEFECT_DIFFERENT_ENTITY');
    }
    
    // C) DIFFERENT ENTITY + DIFFERENT DEFECT
    if (isDifferentEntity && isDifferentDefect) {
        suspicionLevel = 'CRITICAL';
        reasons.push('COMPLETELY_DIFFERENT_CONCEPTS');
    }

    // High Vector, Low Lexical without concepts
    if (suspicionLevel === 'NONE' && fEnt.length === 0 && pEnt.length === 0 && vecScore > 0.90 && score < 0.6) {
        suspicionLevel = 'MEDIUM';
        reasons.push('VAGUE_SEMANTIC_MATCH_NO_ENTITIES');
    }
    
    if (fEnt.includes('ENT_CRITICAL_RESULTS') && pEnt.length > 0 && !pEnt.includes('ENT_CRITICAL_RESULTS')) {
         suspicionLevel = 'CRITICAL';
         reasons.push('CRITICAL_RESULTS_MERGED_INCORRECTLY');
    }
    
    return { level: suspicionLevel, reasons };
}

async function run() {
    console.log("Loading data for Deep Merge Audit...");
    const localResults = JSON.parse(fs.readFileSync('historical_local_preparation_results.json', 'utf8'));
    
    console.log("Fetching DB findings for context...");
    let allFindings = [];
    let page = 0;
    while (true) {
        const { data } = await supabase.from('report_findings').select('id, hospital_id, department_id').order('created_at', { ascending: true }).range(page*1000, (page+1)*1000 - 1);
        if (!data || data.length === 0) break;
        allFindings = allFindings.concat(data);
        page++;
    }
    const findingMap = new Map();
    for (const f of allFindings) findingMap.set(f.id, f);
    
    console.log("Fetching recurrence groups for prototypes...");
    const { data: dbGroups } = await supabase.from('recurrence_groups').select('*');
    const groupMap = new Map();
    for (const g of dbGroups) {
        groupMap.set(g.id, { title: g.title, concepts: extractConcepts(g.title) });
    }
    
    const sameIssueMerges = localResults.filter(r => r.local_decision === 'LOCAL_HIGH_CONFIDENCE_SAME_ISSUE');
    console.log(`Auditing ${sameIssueMerges.length} SAME_ISSUE proposed merges...`);
    
    let cleanMerges = 0;
    const suspiciousMerges = [];
    const groupStats = new Map();
    
    const sensitivity = {
        current: 0,
        t_high: 0,
        t_highest: 0
    };

    for (const record of sameIssueMerges) {
        const topCandidate = record.top_candidates[0];
        if (!topCandidate) continue;
        
        let protoConcepts = new Set();
        if (groupMap.has(record.proposed_recurrence_group_id)) {
            protoConcepts = groupMap.get(record.proposed_recurrence_group_id).concepts;
        } else {
            protoConcepts = extractConcepts(topCandidate.title);
        }
        
        const fConcepts = extractConcepts(record.original_text);
        const score = record.top_candidate_score;
        let vecScore = 0.95; // Assuming high if it passed
        
        const evaluation = evaluateSuspicion(fConcepts, protoConcepts, score, vecScore);
        
        if (evaluation.level === 'NONE') {
            cleanMerges++;
        } else {
            suspiciousMerges.push({
                finding_id: record.finding_id,
                original_text: record.original_text,
                hospital_id: record.hospital_id,
                proposed_recurrence_group_id: record.proposed_recurrence_group_id,
                candidate_prototype: topCandidate.title,
                final_score: score,
                hard_negative_flags: record.hard_negative_flags,
                suspicion_level: evaluation.level,
                suspicion_reasons: evaluation.reasons
            });
        }
        
        if (score > 0.78) sensitivity.current++;
        if (score > 0.82) sensitivity.t_high++;
        if (score > 0.86) sensitivity.t_highest++;
        
        const groupId = record.proposed_recurrence_group_id;
        if (!groupStats.has(groupId)) {
            groupStats.set(groupId, {
                id: groupId,
                title: topCandidate.title,
                members: [],
                hospitals: new Set(),
                departments: new Set()
            });
        }
        const g = groupStats.get(groupId);
        g.members.push(record.original_text);
        if (record.hospital_id) g.hospitals.add(record.hospital_id);
        const fContext = findingMap.get(record.finding_id);
        if (fContext && fContext.department_id) g.departments.add(fContext.department_id);
    }
    
    suspiciousMerges.sort((a, b) => {
        const w = { 'CRITICAL': 3, 'HIGH': 2, 'MEDIUM': 1, 'LOW': 0 };
        return w[b.suspicion_level] - w[a.suspicion_level];
    });
    
    const top100Suspicious = suspiciousMerges.slice(0, 100);
    
    const groupsArray = Array.from(groupStats.values()).map(g => ({
        group_id: g.id,
        prototype: g.title,
        member_count: g.members.length,
        hospitals_count: g.hospitals.size,
        departments_count: g.departments.size,
        examples: g.members.slice(0, 10)
    })).sort((a,b) => b.member_count - a.member_count);
    
    const top50Groups = groupsArray.slice(0, 50);
    
    const criticalCount = suspiciousMerges.filter(s => s.suspicion_level === 'CRITICAL').length;
    const highCount = suspiciousMerges.filter(s => s.suspicion_level === 'HIGH').length;
    const mediumCount = suspiciousMerges.filter(s => s.suspicion_level === 'MEDIUM').length;
    
    const isReadyForMigration = (criticalCount === 0 && highCount < 20 && top50Groups[0]?.member_count < 100);
    const verdict = isReadyForMigration ? 'READY_FOR_MIGRATION_REVIEW' : 'NOT_READY_FOR_MIGRATION_REVIEW';

    const outputJson = {
        summary: {
            total_proposed_SAME_ISSUE: sameIssueMerges.length,
            clean_merges: cleanMerges,
            suspicious_merges_total: suspiciousMerges.length,
            critical_suspicious_merges: criticalCount,
            high_suspicious_merges: highCount,
            medium_suspicious_merges: mediumCount,
            verdict: verdict
        },
        threshold_sensitivity: {
            current_threshold_078: sensitivity.current,
            high_threshold_082: sensitivity.t_high,
            highest_threshold_086: sensitivity.t_highest
        },
        top_100_suspicious_merges: top100Suspicious,
        top_50_largest_groups: top50Groups
    };
    
    fs.writeFileSync('deep_merge_audit_v4.json', JSON.stringify(outputJson, null, 2));
    
    let md = `# Deep Merge Audit V4
**Verdict:** ${verdict}

## Summary
- **Total Proposed SAME_ISSUE:** ${sameIssueMerges.length}
- **Clean Merges:** ${cleanMerges}
- **Total Suspicious:** ${suspiciousMerges.length}
  - CRITICAL: ${criticalCount}
  - HIGH: ${highCount}
  - MEDIUM: ${mediumCount}

## Threshold Sensitivity
- T1 (Current >0.78): ${sensitivity.current} SAME_ISSUE
- T2 (Higher >0.82): ${sensitivity.t_high} SAME_ISSUE (diff: ${sensitivity.current - sensitivity.t_high} become UNCERTAIN)
- T3 (Highest >0.86): ${sensitivity.t_highest} SAME_ISSUE (diff: ${sensitivity.current - sensitivity.t_highest} become UNCERTAIN)

## Top Suspicious Merges (Sample)
`;
    for (const s of top100Suspicious.slice(0, 15)) {
        md += `
### ${s.suspicion_level}: ${s.suspicion_reasons.join(', ')}
- **Finding:** "${s.original_text}"
- **Prototype:** "${s.candidate_prototype}"
- **Score:** ${s.final_score ? s.final_score.toFixed(3) : 'N/A'}
`;
    }
    
    md += `\n## Top Largest Groups\n`;
    for (const g of top50Groups.slice(0, 5)) {
        md += `
### Group: "${g.prototype}"
- **Members:** ${g.member_count} | **Hospitals:** ${g.hospitals_count} | **Departments:** ${g.departments_count}
`;
    }
    
    fs.writeFileSync('deep_merge_audit_v4.md', md);
    console.log("Audit complete. Outputs written to deep_merge_audit_v4.json and deep_merge_audit_v4.md");
}

run().catch(console.error);
