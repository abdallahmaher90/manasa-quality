import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function runFinalQueue() {
    console.log("Starting FINAL REVIEW QUEUE builder...");

    const localResults = JSON.parse(fs.readFileSync('historical_local_preparation_results.json', 'utf8'));
    const safeDistinctData = JSON.parse(fs.readFileSync('safe_distinct_resolution.json', 'utf8'));
    const retrievalGapData = JSON.parse(fs.readFileSync('retrieval_gap_audit.json', 'utf8'));
    const recoverableData = JSON.parse(fs.readFileSync('recoverable_16_review.json', 'utf8'));
    
    // We want all 179 UNCERTAIN findings, minus the 3 SAFE DISTINCT that are considered resolved.
    const safeIds = new Set(safeDistinctData.map(d => d.finding_id));
    
    const unresolved = localResults
        .filter(f => f.local_decision === 'LOCAL_UNCERTAIN')
        .filter(f => !safeIds.has(f.finding_id));

    // Maps for fast lookup
    const gapMap = new Map();
    retrievalGapData.zero_candidates.forEach(z => gapMap.set(z.finding_id, { type: 'ZERO', ...z }));
    retrievalGapData.missing_embeddings.forEach(m => gapMap.set(m.finding_id, { type: 'MISSING', ...m }));

    const recoverableMap = new Map(recoverableData.cases.map(c => [c.finding_id, c]));

    const findingIds = unresolved.map(u => u.finding_id);
    const { data: dbFindings } = await supabase.from('report_findings').select('id, recurrence_group_id').in('id', findingIds);
    const dbMap = new Map(dbFindings.map(f => [f.id, f]));

    const summary = {
        total_unresolved: unresolved.length,
        NEEDS_HUMAN_REVIEW: 0,
        NEEDS_GEMINI_LATER: 0,
        NO_ACTION_FOR_NOW: 0,
        HIGH_priority_count: 0,
        MEDIUM_priority_count: 0,
        LOW_priority_count: 0
    };

    const queue = [];

    for (const f of unresolved) {
        let queue_label = 'NO_ACTION_FOR_NOW';
        let priority = 'LOW';
        let reason = '';
        let targetGroup = 'None';
        let candidateScore = 0;

        const gapInfo = gapMap.get(f.finding_id);
        const recInfo = recoverableMap.get(f.finding_id);

        if (gapInfo) {
            if (gapInfo.type === 'ZERO') {
                if (gapInfo.cause === 'GENUINELY_NEW_ISSUE') {
                    queue_label = 'NO_ACTION_FOR_NOW';
                    priority = 'LOW';
                    reason = 'Genuinely new issue. No candidate exists.';
                } else if (gapInfo.lexical_candidate_found) {
                    queue_label = 'NEEDS_GEMINI_LATER';
                    priority = 'HIGH';
                    reason = 'Lexical candidate found but missed by V4 embedding. Needs semantic check.';
                    targetGroup = gapInfo.best_lexical_candidate;
                    candidateScore = gapInfo.best_lexical_score;
                } else {
                    queue_label = 'NEEDS_HUMAN_REVIEW';
                    priority = 'LOW';
                    reason = `Zero candidates due to ${gapInfo.cause}.`;
                }
            } else if (gapInfo.type === 'MISSING') {
                if (recInfo) {
                    queue_label = 'NEEDS_GEMINI_LATER';
                    priority = 'HIGH';
                    reason = 'Missing embedding but has strong lexical candidate. Needs semantic check.';
                    targetGroup = recInfo.lexical_candidate_group;
                    candidateScore = recInfo.lexical_score;
                } else {
                    queue_label = 'NO_ACTION_FOR_NOW';
                    priority = 'LOW';
                    reason = 'Missing embedding and no lexical candidate (True Retrieval Blocked).';
                }
            }
        } else {
            // Normal V4 output
            const topCandidate = f.top_candidates && f.top_candidates.length > 0 ? f.top_candidates[0] : null;
            if (topCandidate) {
                targetGroup = topCandidate.title;
                candidateScore = topCandidate.score;
                
                if (candidateScore >= 0.70) {
                    queue_label = 'NEEDS_GEMINI_LATER';
                    priority = 'HIGH';
                    reason = 'Strong candidate exists. Semantic adjudication required to resolve.';
                } else {
                    queue_label = 'NEEDS_HUMAN_REVIEW';
                    priority = 'MEDIUM';
                    reason = 'Weak candidate score. Semantic overlap likely ambiguous.';
                }
            } else {
                queue_label = 'NO_ACTION_FOR_NOW';
                priority = 'LOW';
                reason = 'No candidate data available.';
            }
        }

        if (queue_label === 'NEEDS_HUMAN_REVIEW') summary.NEEDS_HUMAN_REVIEW++;
        if (queue_label === 'NEEDS_GEMINI_LATER') summary.NEEDS_GEMINI_LATER++;
        if (queue_label === 'NO_ACTION_FOR_NOW') summary.NO_ACTION_FOR_NOW++;

        if (priority === 'HIGH') summary.HIGH_priority_count++;
        if (priority === 'MEDIUM') summary.MEDIUM_priority_count++;
        if (priority === 'LOW') summary.LOW_priority_count++;

        const dbRec = dbMap.get(f.finding_id);

        queue.push({
            finding_id: f.finding_id,
            original_text: f.original_text,
            hospital_id: f.hospital_id,
            current_recurrence_group_id: dbRec ? dbRec.recurrence_group_id : null,
            top_candidate_group: targetGroup,
            candidate_score: candidateScore,
            entity: f.entity_matches || [],
            defect: f.defect_matches || [],
            requirement: f.context_match || [],
            queue_label: queue_label,
            priority: priority,
            reason: reason
        });
    }

    // Sort queue: HIGH -> MEDIUM -> LOW
    queue.sort((a, b) => {
        const p = { 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };
        if (p[b.priority] !== p[a.priority]) return p[b.priority] - p[a.priority];
        return b.candidate_score - a.candidate_score;
    });

    fs.writeFileSync('final_uncertain_queue.json', JSON.stringify({ summary, queue }, null, 2));

    let mdContent = `# Final Uncertain Review Queue\n\n`;
    mdContent += `## Summary\n`;
    mdContent += `- **Total Unresolved:** ${summary.total_unresolved}\n\n`;
    mdContent += `### Categories\n`;
    mdContent += `- **NEEDS_GEMINI_LATER:** ${summary.NEEDS_GEMINI_LATER}\n`;
    mdContent += `- **NEEDS_HUMAN_REVIEW:** ${summary.NEEDS_HUMAN_REVIEW}\n`;
    mdContent += `- **NO_ACTION_FOR_NOW:** ${summary.NO_ACTION_FOR_NOW}\n\n`;
    mdContent += `### Priority Queue\n`;
    mdContent += `- **HIGH Priority:** ${summary.HIGH_priority_count}\n`;
    mdContent += `- **MEDIUM Priority:** ${summary.MEDIUM_priority_count}\n`;
    mdContent += `- **LOW Priority:** ${summary.LOW_priority_count}\n\n`;

    mdContent += `## Top 30 HIGH Priority Cases\n\n`;
    
    const highCases = queue.filter(q => q.priority === 'HIGH').slice(0, 30);
    for (const c of highCases) {
        mdContent += `### Finding: \`${c.original_text}\`\n`;
        mdContent += `- **ID:** ${c.finding_id}\n`;
        mdContent += `- **Target Candidate:** \`${c.top_candidate_group}\` (Score: ${c.candidate_score.toFixed(3)})\n`;
        mdContent += `- **Queue Category:** **${c.queue_label}**\n`;
        mdContent += `- **Reason:** ${c.reason}\n`;
        mdContent += `- **Extracted Concepts:** Entities: ${c.entity.join(', ')} | Defect: ${c.defect.join(', ')}\n\n`;
    }

    fs.writeFileSync('final_uncertain_queue.md', mdContent);
    console.log("Final queue generated successfully: final_uncertain_queue.json, final_uncertain_queue.md");
}

runFinalQueue().catch(console.error);
