import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

function normalizeText(text) {
    if (!text) return '';
    return text.toLowerCase()
        .replace(/[أإآا]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/(^|\s)و(?=ال)/g, '$1')
        .replace(/[^\w\s\u0600-\u06FF]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenize(text) {
    const stopWords = new Set(['في', 'من', 'على', 'لا', 'يوجد', 'عدم', 'غير', 'مع', 'الى', 'عن', 'ان', 'او', 'لم']);
    return new Set(normalizeText(text).split(' ').filter(w => w.length > 2 && !stopWords.has(w)));
}

async function runRecoverableReview() {
    console.log("Starting RECOVERABLE-16 REVIEW...");

    const auditData = JSON.parse(fs.readFileSync('retrieval_gap_audit.json', 'utf8'));
    const localResults = JSON.parse(fs.readFileSync('historical_local_preparation_results.json', 'utf8'));
    
    const recoverableFindings = auditData.missing_embeddings.filter(m => m.recoverable_without_embedding);
    
    const findingIds = recoverableFindings.map(f => f.finding_id);
    const { data: dbFindings, error } = await supabase.from('report_findings').select('id, department_id, hospital_id, recurrence_group_id').in('id', findingIds);
    if (error) { console.error(error); return; }
    const dbFindingsMap = new Map((dbFindings || []).map(f => [f.id, f]));

    const summary = {
        total_recoverable: recoverableFindings.length,
        LIKELY_SAME_ISSUE: 0,
        LIKELY_DISTINCT: 0,
        INSUFFICIENT_EVIDENCE: 0,
        candidate_groups: new Set(),
        suspicious_lexical_only_matches: []
    };

    const reviewOutput = [];

    // Basic heuristic function for semantic comparison without LLM
    function basicSemanticAnalysis(text, targetText) {
        let label = 'INSUFFICIENT_EVIDENCE';
        let analysis = 'Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.';
        let entity = 'UNKNOWN';
        let defect = 'UNKNOWN';
        let context = 'UNKNOWN';
        let polarity = 'UNKNOWN';
        
        const t = text || '';
        const c = targetText || '';

        // Extremely naive check for polarity
        const tHasNeg = t.includes('لا يوجد') || t.includes('عدم') || t.includes('غير');
        const cHasNeg = c.includes('لا يوجد') || c.includes('عدم') || c.includes('غير');
        if (tHasNeg !== cHasNeg) polarity = 'POSSIBLE_MISMATCH';

        // Extremely naive context checks
        if ((t.includes('سجل') || t.includes('نموذج') || t.includes('ملف')) && !(c.includes('سجل') || c.includes('نموذج') || c.includes('ملف'))) {
            entity = 'MISMATCH (Documentation vs Non-Documentation)';
            label = 'LIKELY_DISTINCT';
        }
        else if (t.includes('غرفة') && !c.includes('غرفة')) {
            context = 'MISMATCH (Room context)';
            label = 'LIKELY_DISTINCT';
        }
        else if (t.includes('تالف') || t.includes('عطل') || t.includes('صيانة')) {
            if (!(c.includes('تالف') || c.includes('عطل') || c.includes('صيانة') || c.includes('تعمل'))) {
                defect = 'MISMATCH (Maintenance/Broken vs Other)';
                label = 'LIKELY_DISTINCT';
            }
        }

        // Without Gemini, it's very unsafe to mark LIKELY_SAME_ISSUE unless they are basically identical strings
        if (normalizeText(t) === normalizeText(c)) {
            label = 'LIKELY_SAME_ISSUE';
            analysis = 'Exact match after normalization.';
            entity = 'SAME';
            defect = 'SAME';
            context = 'SAME';
        }

        if (label === 'LIKELY_DISTINCT') {
            analysis = 'Semantic divergence detected despite lexical overlap.';
        }

        return { label, analysis, entity, defect, requirement: 'UNKNOWN', context, polarity };
    }

    for (const f of recoverableFindings) {
        const dbRec = dbFindingsMap.get(f.finding_id);
        const localRec = localResults.find(l => l.finding_id === f.finding_id) || {};
        
        const targetTitle = f.best_lexical_candidate;
        summary.candidate_groups.add(targetTitle);

        const sem = basicSemanticAnalysis(f.original_text, targetTitle);
        
        if (sem.label === 'LIKELY_SAME_ISSUE') summary.LIKELY_SAME_ISSUE++;
        else if (sem.label === 'LIKELY_DISTINCT') summary.LIKELY_DISTINCT++;
        else summary.INSUFFICIENT_EVIDENCE++;

        if (sem.label === 'INSUFFICIENT_EVIDENCE' || sem.label === 'LIKELY_DISTINCT') {
            summary.suspicious_lexical_only_matches.push({
                finding_id: f.finding_id,
                original_text: f.original_text,
                target: targetTitle,
                score: f.lexical_score,
                reason: sem.analysis
            });
        }

        const tTokens = tokenize(f.original_text);
        const cTokens = tokenize(targetTitle);
        const overlap = Array.from(tTokens).filter(x => cTokens.has(x));

        reviewOutput.push({
            finding_id: f.finding_id,
            original_text: f.original_text,
            hospital_id: f.hospital_id,
            department_id: dbRec ? dbRec.department_id : null,
            current_recurrence_group_id: dbRec ? dbRec.recurrence_group_id : null,
            normalized_text: normalizeText(f.original_text),
            extracted_concepts: f.concepts,
            lexical_candidate_group: targetTitle,
            lexical_score: f.lexical_score,
            token_overlap: overlap,
            review_label: sem.label,
            semantic_comparison: {
                entity: sem.entity,
                defect: sem.defect,
                requirement: sem.requirement,
                context: sem.context,
                polarity: sem.polarity,
                analysis: sem.analysis
            }
        });
    }

    summary.candidate_groups = summary.candidate_groups.size;

    fs.writeFileSync('recoverable_16_review.json', JSON.stringify({ summary, cases: reviewOutput }, null, 2));

    let mdContent = `# Recoverable-16 Deep Review\n\n`;
    mdContent += `## Summary\n`;
    mdContent += `- **Total Cases:** ${summary.total_recoverable}\n`;
    mdContent += `- **LIKELY_SAME_ISSUE:** ${summary.LIKELY_SAME_ISSUE}\n`;
    mdContent += `- **LIKELY_DISTINCT:** ${summary.LIKELY_DISTINCT}\n`;
    mdContent += `- **INSUFFICIENT_EVIDENCE:** ${summary.INSUFFICIENT_EVIDENCE}\n`;
    mdContent += `- **Unique Candidate Groups:** ${summary.candidate_groups}\n\n`;

    mdContent += `### Suspicious Lexical-Only Matches\n`;
    for (const s of summary.suspicious_lexical_only_matches) {
        mdContent += `- \`${s.original_text}\` -> \`${s.target}\` (Score: ${s.score.toFixed(2)})\n  *${s.reason}*\n`;
    }
    mdContent += `\n---\n\n`;

    for (const f of reviewOutput) {
        mdContent += `### Finding: \`${f.original_text}\`\n`;
        mdContent += `- **ID:** ${f.finding_id}\n`;
        mdContent += `- **Candidate:** \`${f.lexical_candidate_group}\` (Score: ${f.lexical_score.toFixed(2)})\n`;
        mdContent += `- **Token Overlap:** ${f.token_overlap.join(', ')}\n`;
        mdContent += `- **Review Label:** **${f.review_label}**\n`;
        mdContent += `- **Analysis:** ${f.semantic_comparison.analysis}\n`;
        mdContent += `- **Comparison Details:** Entity: ${f.semantic_comparison.entity}, Defect: ${f.semantic_comparison.defect}, Context: ${f.semantic_comparison.context}, Polarity: ${f.semantic_comparison.polarity}\n`;
        mdContent += `\n`;
    }

    fs.writeFileSync('recoverable_16_review.md', mdContent);
    console.log("Deep review complete. Output: recoverable_16_review.json, recoverable_16_review.md");
}

runRecoverableReview().catch(console.error);
