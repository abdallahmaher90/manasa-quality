import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config({ path: '.env.local' })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function runAudit() {
    console.log("Loading local preparation results...");
    const localResults = JSON.parse(fs.readFileSync('historical_local_preparation_results.json', 'utf8'));
    const plan = JSON.parse(fs.readFileSync('recurrence_migration_plan.json', 'utf8'));

    const uncertain = localResults.filter(f => f.local_decision === 'LOCAL_UNCERTAIN');
    console.log(`Found ${uncertain.length} LOCAL_UNCERTAIN findings.`);

    // Fetch DB snapshot for these specific findings and their current groups to cross check
    const findingIds = uncertain.map(u => u.finding_id);
    const { data: dbFindings } = await supabase.from('report_findings').select('id, recurrence_group_id, original_text').in('id', findingIds);
    const { data: dbGroups } = await supabase.from('recurrence_groups').select('id, title');
    const dbGroupsMap = new Map(dbGroups.map(g => [g.id, g.title]));

    const reportData = [];
    const summary = {
        total_uncertain: uncertain.length,
        safe_same_issue: 0,
        safe_distinct: 0,
        needs_review: 0,
        zero_candidates: 0,
        missing_embeddings: 0,
        suspicious_clusters: 0,
    };

    // Dictionary for specific user edge cases
    function detectEdgeCase(text, candidateText) {
        if (!text || !candidateText) return null;
        const norm = (s) => s.toLowerCase();
        const t1 = norm(text);
        const t2 = norm(candidateText);

        // Missing vs Incomplete
        if ((t1.includes('ناقص') || t1.includes('غير مكتمل')) && (t2.includes('غير موجود') || t2.includes('لا يوجد'))) return 'Missing vs Incomplete';
        if ((t2.includes('ناقص') || t2.includes('غير مكتمل')) && (t1.includes('غير موجود') || t1.includes('لا يوجد'))) return 'Missing vs Incomplete';

        // Broken vs Maintenance
        if ((t1.includes('معطل') || t1.includes('عطل')) && (t2.includes('صيانة') || t2.includes('معايرة'))) return 'Broken vs Maintenance/Calibration';
        if ((t2.includes('معطل') || t2.includes('عطل')) && (t1.includes('صيانة') || t1.includes('معايرة'))) return 'Broken vs Maintenance/Calibration';

        // Critical results list vs delay
        if (t1.includes('نتائج حرجة') && t2.includes('نتائج حرجة')) {
            if (t1.includes('قائمة') && t2.includes('تاخير')) return 'Critical Results: List vs Delay';
            if (t2.includes('قائمة') && t1.includes('تاخير')) return 'Critical Results: List vs Delay';
        }

        // Crash cart content vs lock
        if (t1.includes('كراش') && t2.includes('كراش')) {
            if (t1.includes('محتويات') || t1.includes('ادوية') && (t2.includes('قفل') || t2.includes('مغلق'))) return 'Crash Cart: Content vs Lock';
            if (t2.includes('محتويات') || t2.includes('ادوية') && (t1.includes('قفل') || t1.includes('مغلق'))) return 'Crash Cart: Content vs Lock';
        }

        return null;
    }

    for (const item of uncertain) {
        let classification = 'NEEDS_REVIEW';
        let reason = '';
        
        const isMissingEmbedding = item.embedding_available === false;
        const isZeroCandidates = !isMissingEmbedding && (!item.top_candidates || item.top_candidates.length === 0);
        
        if (isMissingEmbedding) summary.missing_embeddings++;
        if (isZeroCandidates) summary.zero_candidates++;

        const bestCandidate = item.top_candidates && item.top_candidates.length > 0 ? item.top_candidates[0] : null;
        const edgeCase = bestCandidate ? detectEdgeCase(item.original_text, bestCandidate.title) : null;
        
        const hasEntities = item.entity_matches && item.entity_matches.length > 0;
        const hasDefects = item.defect_matches && item.defect_matches.length > 0;
        const hasHardNegatives = item.hard_negative_flags && item.hard_negative_flags.length > 0;
        const score = item.top_candidate_score || 0;

        // Classification Logic
        if (isMissingEmbedding) {
            classification = 'NEEDS_REVIEW';
            reason = 'Missing Embedding - Needs manual fallback or recalculation';
        } else if (isZeroCandidates) {
            // Check if truly no candidate or vocabulary gap
            classification = 'NEEDS_REVIEW';
            reason = 'Zero Candidates - Check for vocabulary gap or truly distinct';
        } else if (edgeCase) {
            classification = 'LOCAL_SAFE_DISTINCT';
            reason = `Edge Case Detected: ${edgeCase}`;
        } else if (hasHardNegatives) {
            classification = 'LOCAL_SAFE_DISTINCT';
            reason = `Hard Negative Flags: ${item.hard_negative_flags.join(', ')}`;
        } else if (bestCandidate && (item.original_text.replace(/\s/g, '') === bestCandidate.title.replace(/\s/g, ''))) {
            classification = 'LOCAL_SAFE_SAME_ISSUE';
            reason = 'Exact Match ignoring spaces';
        } else if (score >= 0.92 && dbGroupsMap.has(bestCandidate.id)) {
            classification = 'LOCAL_SAFE_SAME_ISSUE';
            reason = 'Very High Score (Near Exact Match)';
        } else if (hasEntities && hasDefects && score >= 0.78 && dbGroupsMap.has(bestCandidate.id)) {
            classification = 'LOCAL_SAFE_SAME_ISSUE';
            reason = 'Strong compatible evidence (Entity + Defect + High Score + Target Exists)';
        } else {
            classification = 'NEEDS_REVIEW';
            reason = 'Ambiguous matches or weak evidence';
        }

        if (classification === 'LOCAL_SAFE_SAME_ISSUE') summary.safe_same_issue++;
        else if (classification === 'LOCAL_SAFE_DISTINCT') summary.safe_distinct++;
        else summary.needs_review++;

        const dbRec = dbFindings?.find(f => f.id === item.finding_id);

        reportData.push({
            finding_id: item.finding_id,
            original_text: item.original_text,
            hospital_id: item.hospital_id,
            current_recurrence_group_id: dbRec ? dbRec.recurrence_group_id : null,
            best_candidate_group: bestCandidate ? bestCandidate.id : null,
            best_candidate_title: bestCandidate ? bestCandidate.title : null,
            candidate_score: score,
            entity_match: item.entity_matches || [],
            defect_match: item.defect_matches || [],
            hard_negative_flags: item.hard_negative_flags || [],
            classification,
            reason
        });
    }

    // Group-level Review
    const groupClusters = {};
    for (const r of reportData) {
        if (r.best_candidate_group) {
            if (!groupClusters[r.best_candidate_group]) {
                groupClusters[r.best_candidate_group] = {
                    title: r.best_candidate_title,
                    findings: []
                };
            }
            groupClusters[r.best_candidate_group].findings.push(r);
        }
    }

    // Count suspicious clusters (>1 finding mapping to same candidate in uncertain pool)
    const topClusters = Object.entries(groupClusters)
        .filter(([id, data]) => data.findings.length > 1)
        .sort((a, b) => b[1].findings.length - a[1].findings.length);
    
    summary.suspicious_clusters = topClusters.length;

    // Generate output
    fs.writeFileSync('uncertain_resolution_report.json', JSON.stringify({ summary, reportData, groupClusters: topClusters }, null, 2));

    let mdContent = `# Uncertain Resolution Report\n\n`;
    mdContent += `## Summary\n`;
    mdContent += `- **Total Uncertain:** ${summary.total_uncertain}\n`;
    mdContent += `- **Safe SAME_ISSUE:** ${summary.safe_same_issue}\n`;
    mdContent += `- **Safe DISTINCT:** ${summary.safe_distinct}\n`;
    mdContent += `- **Needs Review:** ${summary.needs_review}\n`;
    mdContent += `- **Zero Candidates:** ${summary.zero_candidates}\n`;
    mdContent += `- **Missing Embeddings:** ${summary.missing_embeddings}\n`;
    mdContent += `- **Suspicious Clusters:** ${summary.suspicious_clusters}\n\n`;

    mdContent += `## Top 50 Cases Requiring Review\n\n`;
    const reviewCases = reportData.filter(r => r.classification === 'NEEDS_REVIEW').slice(0, 50);
    for (const rc of reviewCases) {
        mdContent += `### Finding: ${rc.original_text}\n`;
        mdContent += `- **ID:** ${rc.finding_id}\n`;
        mdContent += `- **Reason:** ${rc.reason}\n`;
        if (rc.best_candidate_title) {
            mdContent += `- **Best Candidate:** ${rc.best_candidate_title} (Score: ${rc.candidate_score})\n`;
        }
        mdContent += `\n`;
    }

    if (topClusters.length > 0) {
        mdContent += `## Group Clusters (Uncertain findings pointing to same target)\n\n`;
        for (const [id, data] of topClusters.slice(0, 10)) {
            mdContent += `### Target: ${data.title}\n`;
            mdContent += `- **Findings Count:** ${data.findings.length}\n`;
            for (const f of data.findings) {
                mdContent += `  - ${f.original_text} (${f.classification})\n`;
            }
            mdContent += `\n`;
        }
    }

    fs.writeFileSync('uncertain_resolution_report.md', mdContent);
    console.log("Reports generated: uncertain_resolution_report.json, uncertain_resolution_report.md");
}

runAudit().catch(console.error);
