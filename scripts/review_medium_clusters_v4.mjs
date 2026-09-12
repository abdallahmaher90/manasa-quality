import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function runMediumReview() {
    console.log("Starting MEDIUM-CLUSTER REVIEW...");

    const reviewData = JSON.parse(fs.readFileSync('uncertain_review_clusters.json', 'utf8'));
    const mediumClusters = reviewData.clusters.filter(c => c.priority === 'MEDIUM');

    // Fetch department_id and hospital_id for findings in MEDIUM clusters
    let findingIds = [];
    mediumClusters.forEach(c => {
        c.all_findings.forEach(f => findingIds.push(f.finding_id));
    });

    const { data: dbFindings } = await supabase.from('report_findings').select('id, department_id, hospital_id').in('id', findingIds);
    const dbMap = new Map(dbFindings.map(f => [f.id, f]));

    const summary = {
        total_medium_findings: findingIds.length,
        cluster_count: mediumClusters.length,
        LIKELY_SAME_ISSUE: 0,
        LIKELY_DISTINCT: 0,
        INSUFFICIENT_EVIDENCE: 0,
        candidate_for_safe_resolution: [],
        top_suspicious_clusters: []
    };

    const reviewOutput = [];

    // Helper for basic semantic heuristics without new hardcoded rules
    function basicSemanticAnalysis(text, target, hardNegatives) {
        let label = 'INSUFFICIENT_EVIDENCE';
        let analysis = 'Requires manual or LLM review. Ambiguous overlap.';
        let entity = 'UNKNOWN';
        let defect = 'UNKNOWN';
        let context = 'UNKNOWN';

        const t = text || '';
        const c = target || '';

        if (hardNegatives && hardNegatives.length > 0) {
            label = 'LIKELY_DISTINCT';
            analysis = `Distinct due to hard negative flags: ${hardNegatives.join(', ')}`;
            defect = 'CONFLICTING';
        } else {
            // Check for obvious Entity mismatches using existing V4 logic concepts if possible, 
            // but we fall back to INSUFFICIENT_EVIDENCE to avoid making arbitrary new rules.
            label = 'INSUFFICIENT_EVIDENCE';
            analysis = 'No hard negative flags triggered by V4 engine. Semantic dimensions overlap ambiguously.';
            
            // Simple keyword overlap checks (just for the report display)
            if (t.includes('سجل') && !c.includes('سجل')) entity = 'POSSIBLE_MISMATCH (Register/Log)';
            if (t.includes('غرفة') && !c.includes('غرفة')) context = 'POSSIBLE_MISMATCH (Room context)';
        }

        return { label, analysis, entity, defect, requirement: 'UNKNOWN', context, temporal: 'UNKNOWN', polarity: 'UNKNOWN' };
    }

    for (const cluster of mediumClusters) {
        const clusterReview = {
            cluster_id: cluster.cluster_id,
            target_title: cluster.target_title,
            count: cluster.count,
            reason_for_medium: cluster.conflicts,
            findings: []
        };

        summary.top_suspicious_clusters.push({
            cluster_id: cluster.cluster_id,
            target_title: cluster.target_title,
            finding_count: cluster.count
        });

        for (const finding of cluster.all_findings) {
            const dbRecord = dbMap.get(finding.finding_id);
            const department_id = dbRecord ? dbRecord.department_id : null;
            const original_text = finding.original_text;

            const sem = basicSemanticAnalysis(original_text, cluster.target_title, finding.hard_negative_flags);
            
            if (sem.label === 'LIKELY_SAME_ISSUE') summary.LIKELY_SAME_ISSUE++;
            else if (sem.label === 'LIKELY_DISTINCT') summary.LIKELY_DISTINCT++;
            else summary.INSUFFICIENT_EVIDENCE++;

            if (sem.label === 'LIKELY_DISTINCT') {
                 summary.candidate_for_safe_resolution.push({
                     finding_id: finding.finding_id,
                     original_text,
                     target_title: cluster.target_title,
                     resolution: 'DISTINCT'
                 });
            } else if (sem.label === 'LIKELY_SAME_ISSUE') {
                 summary.candidate_for_safe_resolution.push({
                     finding_id: finding.finding_id,
                     original_text,
                     target_title: cluster.target_title,
                     resolution: 'SAME_ISSUE'
                 });
            }

            clusterReview.findings.push({
                finding_id: finding.finding_id,
                original_text,
                hospital_id: finding.hospital_id,
                department_id,
                current_recurrence_group_id: finding.current_recurrence_group_id,
                best_candidate_group: cluster.cluster_id,
                top_5_candidates: finding.top_5_candidates,
                candidate_score: finding.score,
                score_gap: finding.score_gap,
                entity: finding.entity,
                defect: finding.defect,
                requirement: finding.requirement,
                hard_negative_flags: finding.hard_negative_flags,
                review_label: sem.label,
                semantic_comparison: {
                    entity: sem.entity,
                    defect: sem.defect,
                    requirement: sem.requirement,
                    context: sem.context,
                    temporal: sem.temporal,
                    polarity: sem.polarity,
                    analysis: sem.analysis
                }
            });
        }
        reviewOutput.push(clusterReview);
    }

    fs.writeFileSync('medium_clusters_review.json', JSON.stringify({ summary, clusters: reviewOutput }, null, 2));

    let mdContent = `# Medium Clusters Deep Review\n\n`;
    mdContent += `## Summary\n`;
    mdContent += `- **Medium Clusters Total:** ${summary.cluster_count}\n`;
    mdContent += `- **Findings Reviewed:** ${summary.total_medium_findings}\n`;
    mdContent += `- **LIKELY_SAME_ISSUE:** ${summary.LIKELY_SAME_ISSUE}\n`;
    mdContent += `- **LIKELY_DISTINCT:** ${summary.LIKELY_DISTINCT}\n`;
    mdContent += `- **INSUFFICIENT_EVIDENCE:** ${summary.INSUFFICIENT_EVIDENCE}\n\n`;

    mdContent += `### Candidates For Safe Resolution:\n`;
    if (summary.candidate_for_safe_resolution.length === 0) {
        mdContent += `- *None*\n`;
    }
    for (const c of summary.candidate_for_safe_resolution) {
        mdContent += `- **${c.resolution}**: \`${c.original_text}\` (Target: ${c.target_title})\n`;
    }
    mdContent += `\n---\n\n`;

    for (const cluster of reviewOutput) {
        mdContent += `## Cluster: ${cluster.target_title} [${cluster.cluster_id}]\n`;
        mdContent += `**Count:** ${cluster.count}\n`;
        mdContent += `**Reason for MEDIUM:** ${cluster.reason_for_medium.join(' | ')}\n\n`;

        for (const f of cluster.findings) {
            mdContent += `### Finding: \`${f.original_text}\`\n`;
            mdContent += `- **ID:** ${f.finding_id}\n`;
            mdContent += `- **Review Label:** **${f.review_label}**\n`;
            mdContent += `- **Analysis:** ${f.semantic_comparison.analysis}\n`;
            mdContent += `- **Comparison Details:** Entity: ${f.semantic_comparison.entity}, Defect: ${f.semantic_comparison.defect}, Context: ${f.semantic_comparison.context}\n`;
            if (f.top_5_candidates && f.top_5_candidates.length > 0) {
                 mdContent += `- **Top Candidate:** ${f.top_5_candidates[0].title} (Score: ${f.candidate_score.toFixed(3)}, Gap: ${f.score_gap.toFixed(3)})\n`;
            }
            if (f.hard_negative_flags && f.hard_negative_flags.length > 0) {
                 mdContent += `- **Hard Negatives:** ${f.hard_negative_flags.join(', ')}\n`;
            }
            mdContent += `\n`;
        }
    }

    fs.writeFileSync('medium_clusters_review.md', mdContent);
    console.log("Deep review complete. Output: medium_clusters_review.json, medium_clusters_review.md");
}

runMediumReview().catch(console.error);
