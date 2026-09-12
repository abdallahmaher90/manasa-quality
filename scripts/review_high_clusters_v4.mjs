import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function runHighReview() {
    console.log("Starting HIGH-CLUSTER DEEP REVIEW...");

    const reviewData = JSON.parse(fs.readFileSync('uncertain_review_clusters.json', 'utf8'));
    const highClusters = reviewData.clusters.filter(c => c.priority === 'HIGH');

    // Fetch department_id and hospital_id for findings in HIGH clusters
    let findingIds = [];
    highClusters.forEach(c => {
        c.all_findings.forEach(f => findingIds.push(f.finding_id));
    });

    const { data: dbFindings } = await supabase.from('report_findings').select('id, department_id, hospital_id').in('id', findingIds);
    const dbMap = new Map(dbFindings.map(f => [f.id, f]));

    const summary = {
        high_clusters_total: highClusters.length,
        findings_reviewed: findingIds.length,
        LIKELY_SAME_ISSUE: 0,
        LIKELY_DISTINCT: 0,
        INSUFFICIENT_EVIDENCE: 0,
        zero_candidate_causes: {},
        embedding_gap_cases: 0,
        critical_ambiguities: 0,
        candidate_for_safe_resolution: []
    };

    const reviewOutput = [];

    for (const cluster of highClusters) {
        const clusterReview = {
            cluster_id: cluster.cluster_id,
            target_title: cluster.target_title,
            count: cluster.count,
            reason_for_high: cluster.conflicts,
            findings: []
        };

        for (const finding of cluster.all_findings) {
            const dbRecord = dbMap.get(finding.finding_id);
            const department_id = dbRecord ? dbRecord.department_id : null;
            const original_text = finding.original_text;

            let reviewLabel = 'INSUFFICIENT_EVIDENCE';
            let semantic_comparison = {
                entity: 'N/A',
                defect: 'N/A',
                requirement: 'N/A',
                context: 'N/A',
                temporal: 'N/A',
                polarity: 'N/A',
                analysis: ''
            };

            if (cluster.cluster_id === 'ZERO_CANDIDATES') {
                reviewLabel = 'LIKELY_DISTINCT'; // Generally if it found 0 candidates it's distinct
                let cause = 'Vocabulary Gap';
                if (original_text.length < 15) cause = 'Too short / Ambiguous';
                if (original_text.includes('جهاز') || original_text.includes('ماكينة')) cause = 'Specific Equipment Issue';

                semantic_comparison.analysis = `Zero candidates found. Cause analyzed as: ${cause}`;
                summary.zero_candidate_causes[cause] = (summary.zero_candidate_causes[cause] || 0) + 1;
            
            } else if (cluster.cluster_id === 'MISSING_EMBEDDING') {
                reviewLabel = 'INSUFFICIENT_EVIDENCE';
                semantic_comparison.analysis = 'Cannot perform retrieval. Retrieval confidence is 0. Manual map required.';
                summary.embedding_gap_cases++;
                summary.critical_ambiguities++;

            } else {
                const targetText = cluster.target_title;
                
                // Deep Review Rules as requested by User
                if (original_text.includes('تسليم') && original_text.includes('تعقيم') && targetText.includes('تمريض')) {
                    semantic_comparison.entity = 'DIFFERENT (Sterilization vs Nursing)';
                    semantic_comparison.defect = 'SAME (Handover incomplete)';
                    semantic_comparison.context = 'DIFFERENT SCOPE';
                    semantic_comparison.analysis = 'Same defect but applies to completely different entities (departments).';
                    reviewLabel = 'LIKELY_DISTINCT';
                }
                else if (original_text.includes('أرشيف') && targetText.includes('الغرفه')) {
                    semantic_comparison.entity = 'DIFFERENT (Archive Room vs General Room)';
                    semantic_comparison.defect = 'SAME (Non-compliant)';
                    semantic_comparison.context = 'DIFFERENT SCOPE';
                    semantic_comparison.analysis = 'General room compliance vs specific archive room compliance. Distinct contexts.';
                    reviewLabel = 'LIKELY_DISTINCT';
                }
                else if (original_text.includes('ألات منتهية التعقيم') && targetText.includes('قسم التعقيم')) {
                    semantic_comparison.entity = 'SAME/OVERLAPPING (Sterilization equipment/process)';
                    semantic_comparison.defect = 'DIFFERENT (Clean/Dirty mixing vs Autoclave routing)';
                    semantic_comparison.analysis = 'Both relate to CSSD sterilization, but one is about mixing clean/dirty instruments and the other is about autoclave physical placement.';
                    reviewLabel = 'LIKELY_DISTINCT';
                }
                else {
                    semantic_comparison.analysis = 'Defaulting to INSUFFICIENT_EVIDENCE due to lack of strict distinct rule.';
                    reviewLabel = 'INSUFFICIENT_EVIDENCE';
                    summary.critical_ambiguities++;
                }
            }

            if (reviewLabel === 'LIKELY_SAME_ISSUE') summary.LIKELY_SAME_ISSUE++;
            else if (reviewLabel === 'LIKELY_DISTINCT') summary.LIKELY_DISTINCT++;
            else summary.INSUFFICIENT_EVIDENCE++;

            if (reviewLabel === 'LIKELY_DISTINCT' && cluster.cluster_id !== 'ZERO_CANDIDATES' && cluster.cluster_id !== 'MISSING_EMBEDDING') {
                 summary.candidate_for_safe_resolution.push({
                     finding_id: finding.finding_id,
                     original_text,
                     target_title: cluster.target_title,
                     resolution: 'DISTINCT'
                 });
            }

            clusterReview.findings.push({
                finding_id: finding.finding_id,
                original_text,
                hospital_id: finding.hospital_id,
                department_id,
                top_5_candidates: finding.top_5_candidates,
                candidate_score: finding.score,
                score_gap: finding.score_gap,
                entity: finding.entity,
                defect: finding.defect,
                requirement: finding.requirement,
                hard_negative_flags: finding.hard_negative_flags,
                review_label: reviewLabel,
                semantic_comparison
            });
        }
        reviewOutput.push(clusterReview);
    }

    fs.writeFileSync('high_clusters_deep_review.json', JSON.stringify({ summary, clusters: reviewOutput }, null, 2));

    let mdContent = `# High Clusters Deep Review\n\n`;
    mdContent += `## Summary\n`;
    mdContent += `- **High Clusters Total:** ${summary.high_clusters_total}\n`;
    mdContent += `- **Findings Reviewed:** ${summary.findings_reviewed}\n`;
    mdContent += `- **LIKELY_SAME_ISSUE:** ${summary.LIKELY_SAME_ISSUE}\n`;
    mdContent += `- **LIKELY_DISTINCT:** ${summary.LIKELY_DISTINCT}\n`;
    mdContent += `- **INSUFFICIENT_EVIDENCE:** ${summary.INSUFFICIENT_EVIDENCE}\n`;
    mdContent += `- **Embedding Gap Cases:** ${summary.embedding_gap_cases}\n`;
    mdContent += `- **Critical Ambiguities:** ${summary.critical_ambiguities}\n\n`;

    mdContent += `### Candidates For Safe Resolution (DISTINCT):\n`;
    for (const c of summary.candidate_for_safe_resolution) {
        mdContent += `- **${c.resolution}**: \`${c.original_text}\` (Target: ${c.target_title})\n`;
    }
    mdContent += `\n---\n\n`;

    for (const cluster of reviewOutput) {
        mdContent += `## Cluster: ${cluster.target_title} [${cluster.cluster_id}]\n`;
        mdContent += `**Count:** ${cluster.count}\n`;
        mdContent += `**Reason for HIGH:** ${cluster.reason_for_high.join(' | ')}\n\n`;

        for (const f of cluster.findings) {
            mdContent += `### Finding: \`${f.original_text}\`\n`;
            mdContent += `- **ID:** ${f.finding_id}\n`;
            mdContent += `- **Review Label:** **${f.review_label}**\n`;
            mdContent += `- **Analysis:** ${f.semantic_comparison.analysis}\n`;
            mdContent += `- **Comparison Details:** Entity: ${f.semantic_comparison.entity}, Defect: ${f.semantic_comparison.defect}, Context: ${f.semantic_comparison.context}\n`;
            if (f.top_5_candidates && f.top_5_candidates.length > 0) {
                 mdContent += `- **Top Candidate:** ${f.top_5_candidates[0].title} (Score: ${f.candidate_score.toFixed(3)})\n`;
            }
            mdContent += `\n`;
        }
    }

    fs.writeFileSync('high_clusters_deep_review.md', mdContent);
    console.log("Deep review complete. Output: high_clusters_deep_review.json, .md");
}

runHighReview().catch(console.error);
