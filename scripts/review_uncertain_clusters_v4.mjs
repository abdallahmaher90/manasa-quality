import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function runReview() {
    console.log("Loading data for UNCERTAIN review...");
    const localResults = JSON.parse(fs.readFileSync('historical_local_preparation_results.json', 'utf8'));

    // The user mentioned 177 in the prompt, but it's 179 in the json. The user excluded 2 safe ones from earlier experiment, 
    // but requested to not use the new rules. So we will take all 179 from the file that are LOCAL_UNCERTAIN.
    const uncertain = localResults.filter(f => f.local_decision === 'LOCAL_UNCERTAIN');
    console.log(`Processing ${uncertain.length} LOCAL_UNCERTAIN findings.`);

    const findingIds = uncertain.map(u => u.finding_id);
    const { data: dbFindings } = await supabase.from('report_findings').select('id, recurrence_group_id').in('id', findingIds);
    const dbFindingsMap = new Map(dbFindings.map(f => [f.id, f.recurrence_group_id]));

    const clusters = new Map();
    let zeroCandidateCount = 0;
    let missingEmbeddingsCount = 0;

    const findingsData = uncertain.map(item => {
        const isMissingEmbedding = item.embedding_available === false;
        const topCandidates = item.top_candidates || [];
        const isZeroCandidates = !isMissingEmbedding && topCandidates.length === 0;

        if (isMissingEmbedding) missingEmbeddingsCount++;
        if (isZeroCandidates) zeroCandidateCount++;

        const bestCandidate = topCandidates.length > 0 ? topCandidates[0] : null;
        const candidate2 = topCandidates.length > 1 ? topCandidates[1] : null;

        const score1 = bestCandidate ? bestCandidate.score : 0;
        const score2 = candidate2 ? candidate2.score : 0;
        const scoreGap = score1 - score2;

        const clusterId = bestCandidate ? bestCandidate.id : (isMissingEmbedding ? 'MISSING_EMBEDDING' : 'ZERO_CANDIDATES');
        const clusterTitle = bestCandidate ? bestCandidate.title : (isMissingEmbedding ? 'Missing Embeddings' : 'Zero Candidates');

        const entity = item.entity_matches || [];
        const defect = item.defect_matches || [];
        const requirement = item.context_match || []; // assuming requirement is under context_match or similar, else empty
        const hardNegatives = item.hard_negative_flags || [];

        const obj = {
            finding_id: item.finding_id,
            original_text: item.original_text,
            hospital_id: item.hospital_id,
            current_recurrence_group_id: dbFindingsMap.get(item.finding_id),
            cluster_id: clusterId,
            cluster_title: clusterTitle,
            top_5_candidates: topCandidates.slice(0, 5).map(c => ({ title: c.title, id: c.id, score: c.score })),
            score: score1,
            score_gap: scoreGap,
            entity,
            defect,
            requirement,
            hard_negative_flags: hardNegatives
        };

        if (!clusters.has(clusterId)) {
            clusters.set(clusterId, {
                cluster_id: clusterId,
                target_title: clusterTitle,
                findings: [],
                unique_entities: new Set(),
                unique_defects: new Set(),
                all_hard_negatives: new Set(),
                priority: 'LOW',
                reasoning: ''
            });
        }

        const cluster = clusters.get(clusterId);
        cluster.findings.push(obj);
        entity.forEach(e => cluster.unique_entities.add(e));
        defect.forEach(d => cluster.unique_defects.add(d));
        hardNegatives.forEach(h => cluster.all_hard_negatives.add(h));

        return obj;
    });

    // Evaluate Review Priority for Clusters
    const clusterResults = Array.from(clusters.values()).map(c => {
        let priority = 'LOW';
        let conflicts = [];

        // Condition for HIGH priority:
        // 1. Multiple entities mapped to the same group
        // 2. Contains specific hard negatives (CONFLICT)
        // 3. Known problematic examples (الأرشيف vs غرفة, تسليم التمريض vs التعقيم)

        if (c.all_hard_negatives.size > 0) {
            conflicts.push(`Hard negative flags present: ${Array.from(c.all_hard_negatives).join(', ')}`);
        }

        if (c.unique_entities.size > 1 && c.findings.length > 1) {
            conflicts.push(`Entity overlap conflict: multiple distinct entities mapped here: ${Array.from(c.unique_entities).join(', ')}`);
        }

        // Catch specific examples requested by the user
        const sampleTexts = c.findings.map(f => f.original_text).join(' | ');
        if (sampleTexts.includes('تسليم') && sampleTexts.includes('تعقيم') && c.target_title.includes('تمريض')) {
            conflicts.push('Specific Conflict: Nursing Handover vs Sterilization Handover');
        }
        if (sampleTexts.includes('أرشيف') && c.target_title.includes('الغرفه')) {
            conflicts.push('Specific Conflict: Archive Room vs General Room');
        }
        if (sampleTexts.includes('ألات منتهية التعقيم') && c.target_title.includes('خط سير قسم التعقيم')) {
            conflicts.push('Specific Conflict: Sterilized instruments mixed with dirty ones vs CSSD routing');
        }

        if (conflicts.length > 0 || c.cluster_id === 'MISSING_EMBEDDING' || c.cluster_id === 'ZERO_CANDIDATES') {
            priority = 'HIGH';
        } else if (c.findings.length >= 3) {
            // Suspicious cluster sizes (14 suspicious clusters from before)
            priority = 'MEDIUM';
            conflicts.push(`Cluster attracted ${c.findings.length} uncertain findings. Requires review.`);
        } else {
            // Check average score gap
            const avgGap = c.findings.reduce((acc, f) => acc + f.score_gap, 0) / c.findings.length;
            if (avgGap < 0.05 && c.findings.length > 1) {
                priority = 'MEDIUM';
                conflicts.push(`Very narrow score gap to next candidate (avg ${avgGap.toFixed(3)}). Ambiguous.`);
            }
        }

        return {
            cluster_id: c.cluster_id,
            target_title: c.target_title,
            count: c.findings.length,
            priority,
            conflicts,
            common_entities: Array.from(c.unique_entities),
            common_defects: Array.from(c.unique_defects),
            samples: c.findings.slice(0, 5).map(f => ({
                id: f.finding_id,
                text: f.original_text,
                score: f.score,
                score_gap: f.score_gap,
                hard_negatives: f.hard_negative_flags
            })),
            all_findings: c.findings // For JSON only
        };
    });

    clusterResults.sort((a, b) => {
        const pMap = { 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };
        if (pMap[b.priority] !== pMap[a.priority]) return pMap[b.priority] - pMap[a.priority];
        return b.count - a.count;
    });

    let highCount = 0;
    let mediumCount = 0;
    let lowCount = 0;
    let multiGroups = 0;

    clusterResults.forEach(c => {
        if (c.priority === 'HIGH') highCount++;
        else if (c.priority === 'MEDIUM') mediumCount++;
        else lowCount++;

        if (c.count > 1 && c.cluster_id !== 'MISSING_EMBEDDING' && c.cluster_id !== 'ZERO_CANDIDATES') {
            multiGroups++;
        }
    });

    const summary = {
        total_uncertain: uncertain.length,
        review_high: highCount,
        review_medium: mediumCount,
        review_low: lowCount,
        number_of_candidate_groups: clusters.size,
        number_of_groups_attracting_multiple: multiGroups,
        zero_candidates: zeroCandidateCount,
        missing_embeddings: missingEmbeddingsCount
    };

    // Output JSON
    fs.writeFileSync('uncertain_review_clusters.json', JSON.stringify({ summary, clusters: clusterResults }, null, 2));

    // Output MD
    let mdContent = `# Uncertain Findings - Review Clusters\n\n`;
    mdContent += `## Summary\n`;
    mdContent += `- **Total Uncertain Findings:** ${summary.total_uncertain}\n`;
    mdContent += `- **Clusters to Review (HIGH):** ${summary.review_high}\n`;
    mdContent += `- **Clusters to Review (MEDIUM):** ${summary.review_medium}\n`;
    mdContent += `- **Clusters to Review (LOW):** ${summary.review_low}\n`;
    mdContent += `- **Number of Target Candidate Groups:** ${summary.number_of_candidate_groups}\n`;
    mdContent += `- **Groups Attracting Multiple Uncertain Findings:** ${summary.number_of_groups_attracting_multiple}\n`;
    mdContent += `- **Zero Candidates Findings:** ${summary.zero_candidates}\n`;
    mdContent += `- **Missing Embeddings:** ${summary.missing_embeddings}\n\n`;

    mdContent += `## Top Clusters By Review Priority\n\n`;
    
    // Top 30 clusters
    for (const c of clusterResults.slice(0, 30)) {
        mdContent += `### [${c.priority}] Target: ${c.target_title}\n`;
        mdContent += `- **Count:** ${c.count}\n`;
        if (c.conflicts.length > 0) {
            mdContent += `- **Conflicts / Warnings:** ${c.conflicts.join(' | ')}\n`;
        }
        if (c.common_entities.length > 0) {
            mdContent += `- **Entities Detected in this Cluster:** ${c.common_entities.join(', ')}\n`;
        }
        mdContent += `- **Sample Findings (up to 5):**\n`;
        for (const s of c.samples) {
            mdContent += `  - \`${s.text}\` (Score: ${s.score.toFixed(3)}, Gap: ${s.score_gap.toFixed(3)})\n`;
            if (s.hard_negatives.length > 0) {
                mdContent += `    *Hard Negatives: ${s.hard_negatives.join(', ')}*\n`;
            }
        }
        mdContent += `\n---\n\n`;
    }

    fs.writeFileSync('uncertain_review_clusters.md', mdContent);
    console.log("Review clusters successfully generated: uncertain_review_clusters.json, uncertain_review_clusters.md");
}

runReview().catch(console.error);
