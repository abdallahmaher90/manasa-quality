import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function exportReviewQueue() {
    console.log("Exporting GEMINI REVIEW QUEUE...");

    const queueData = JSON.parse(fs.readFileSync('final_uncertain_queue.json', 'utf8'));
    const localResults = JSON.parse(fs.readFileSync('historical_local_preparation_results.json', 'utf8'));
    
    // We want the 65 cases that are NEEDS_GEMINI_LATER
    const geminiQueue = queueData.queue.filter(q => q.queue_label === 'NEEDS_GEMINI_LATER');
    
    const findingIds = geminiQueue.map(q => q.finding_id);
    const { data: dbFindings } = await supabase.from('report_findings').select('id, department_id, hospital_id, recurrence_group_id').in('id', findingIds);
    const dbFindingsMap = new Map(dbFindings.map(f => [f.id, f]));

    // Fetch candidate groups mapping
    const { data: dbGroups } = await supabase.from('recurrence_groups').select('id, title');
    const groupTitleMap = new Map(dbGroups.map(g => [g.title, g.id]));

    // Track summary statistics
    const summary = {
        total_cases: geminiQueue.length,
        candidate_groups_count: new Set(geminiQueue.map(q => q.top_candidate_group)).size,
        strongest_candidates_count: 0,
        highest_risk_cases: 0,
        cases_with_hard_negative_conflicts: 0,
        cases_with_narrow_score_gap: 0
    };

    const outputQueue = [];

    for (const q of geminiQueue) {
        const dbRec = dbFindingsMap.get(q.finding_id);
        const localRec = localResults.find(l => l.finding_id === q.finding_id) || {};
        
        let candidateGroupId = groupTitleMap.get(q.top_candidate_group) || null;
        if (!candidateGroupId && localRec.top_candidates && localRec.top_candidates.length > 0) {
            candidateGroupId = localRec.top_candidates[0].id;
        }

        const scoreGap = localRec.top_candidates && localRec.top_candidates.length > 1 
            ? localRec.top_candidates[0].score - localRec.top_candidates[1].score 
            : null;

        const hardNegatives = localRec.hard_negative_flags || [];
        const hasHardNegatives = hardNegatives.length > 0;
        const isNarrowGap = scoreGap !== null && scoreGap < 0.05;

        let riskLevel = 0; // Higher is riskier
        if (hasHardNegatives) {
            riskLevel += 2;
            summary.cases_with_hard_negative_conflicts++;
        }
        if (isNarrowGap) {
            riskLevel += 1;
            summary.cases_with_narrow_score_gap++;
        }
        if (q.candidate_score > 0.8) {
            summary.strongest_candidates_count++;
        }
        if (riskLevel >= 2) {
            summary.highest_risk_cases++;
        }

        let whyLocalCouldNotDecide = "Candidate score was not high enough to automatically override ambiguity.";
        if (hasHardNegatives) {
            whyLocalCouldNotDecide = "Hard negative flags were triggered during V4 analysis preventing auto-merge.";
        } else if (q.reason.includes('Lexical candidate found')) {
            whyLocalCouldNotDecide = "Candidate identified lexically but V4 semantic engine missed it (Embedding Gap).";
        }

        outputQueue.push({
            finding_id: q.finding_id,
            original_text: q.original_text,
            hospital_id: q.hospital_id,
            department_id: dbRec ? dbRec.department_id : null,
            current_recurrence_group_id: dbRec ? dbRec.recurrence_group_id : null,
            candidate_group_id: candidateGroupId,
            candidate_title: q.top_candidate_group,
            top_5_candidates: localRec.top_candidates || [],
            lexical_score: null, // V4 JSON doesn't separate these natively, score is hybrid
            vector_score: q.candidate_score, 
            score_gap: scoreGap,
            entity: q.entity,
            defect: q.defect,
            requirement: q.requirement,
            context: localRec.context_match || [],
            hard_negative_flags: hardNegatives,
            why_local_engine_could_not_decide: whyLocalCouldNotDecide,
            previous_gemini_status: null, // The 1 failure we had wasn't recorded in the main json permanently
            review_status: 'PENDING_SEMANTIC_ADJUDICATION',
            model_required: 'gemini-3.5-flash',
            _sort_score: (q.candidate_score * 10) - riskLevel // Helper for sorting
        });
    }

    // Sort by candidate strength (descending) and risk (ascending risk = higher sort score)
    outputQueue.sort((a, b) => b._sort_score - a._sort_score);

    // Remove the sort helper
    outputQueue.forEach(q => delete q._sort_score);

    fs.writeFileSync('gemini_review_queue_v4.json', JSON.stringify({ summary, cases: outputQueue }, null, 2));

    let mdContent = `# Gemini Semantic Review Queue\n\n`;
    mdContent += `## Summary\n`;
    mdContent += `- **Total Cases Pending Adjudication:** ${summary.total_cases}\n`;
    mdContent += `- **Unique Candidate Groups:** ${summary.candidate_groups_count}\n`;
    mdContent += `- **Strongest Candidates (Score > 0.8):** ${summary.strongest_candidates_count}\n`;
    mdContent += `- **Highest-Risk Cases (False Merge Risk):** ${summary.highest_risk_cases}\n`;
    mdContent += `- **Cases with Hard-Negative Conflicts:** ${summary.cases_with_hard_negative_conflicts}\n`;
    mdContent += `- **Cases with Very Small Score Gap (< 0.05):** ${summary.cases_with_narrow_score_gap}\n\n`;
    mdContent += `> **Model Required:** \`gemini-3.5-flash\` | **Status:** \`PENDING_SEMANTIC_ADJUDICATION\`\n\n`;
    mdContent += `---\n\n`;

    mdContent += `## Queue Items\n\n`;
    for (const q of outputQueue) {
        mdContent += `### \`${q.original_text}\`\n`;
        mdContent += `- **Finding ID:** ${q.finding_id}\n`;
        mdContent += `- **Candidate Title:** \`${q.candidate_title}\`\n`;
        mdContent += `- **Score:** ${q.vector_score ? q.vector_score.toFixed(3) : 'N/A'}\n`;
        if (q.score_gap !== null) {
            mdContent += `- **Score Gap:** ${q.score_gap.toFixed(3)}\n`;
        }
        if (q.hard_negative_flags.length > 0) {
            mdContent += `- **Hard Negatives:** ${q.hard_negative_flags.join(', ')}\n`;
        }
        mdContent += `- **Why V4 Could Not Decide:** ${q.why_local_engine_could_not_decide}\n`;
        mdContent += `- **Entity:** ${q.entity.join(', ')} | **Defect:** ${q.defect.join(', ')}\n\n`;
    }

    fs.writeFileSync('gemini_review_queue_v4.md', mdContent);
    console.log("Queue exported successfully: gemini_review_queue_v4.json, gemini_review_queue_v4.md");
}

exportReviewQueue().catch(console.error);
