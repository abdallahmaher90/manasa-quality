import fs from 'fs'
import crypto from 'crypto'

function normalizeRecurrenceKey(text) {
  if (!text) return ''
  return text
    .replace(/^\[.*?\]\s*/, '')
    .replace(/^[0-9]+[\.\-\)\s]*/, '')
    .replace(/[\u064B-\u065F\u0640]/g, '')
    .replace(/[أإآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/(^|\s)و(?=ال)/g, '$1')
    .replace(/[^\w\s\u0600-\u06FF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function generateDeterministicUuid(seedStr) {
    const hash = crypto.createHash('md5').update(seedStr).digest('hex');
    return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-4${hash.substring(13, 16)}-a${hash.substring(17, 20)}-${hash.substring(20, 32)}`;
}

function runPrepare() {
    console.log("Preparing Safe Distinct Resolutions...");

    const highClustersData = JSON.parse(fs.readFileSync('high_clusters_deep_review.json', 'utf8'));
    const localResults = JSON.parse(fs.readFileSync('historical_local_preparation_results.json', 'utf8'));
    
    // Look up current DB group ids if needed. We can just read them from the deep review clusters data.
    const findingGroupMap = new Map();
    highClustersData.clusters.forEach(c => {
        c.findings.forEach(f => {
            findingGroupMap.set(f.finding_id, f);
        });
    });

    const candidates = highClustersData.summary.candidate_for_safe_resolution.slice(0, 3);
    
    const output = [];

    for (const cand of candidates) {
        const findingInfo = findingGroupMap.get(cand.finding_id) || {};
        const localInfo = localResults.find(l => l.finding_id === cand.finding_id) || {};

        const deterministicId = generateDeterministicUuid("distinct_v4_" + cand.finding_id);
        const normalizedKey = normalizeRecurrenceKey(cand.original_text);

        output.push({
            finding_id: cand.finding_id,
            original_text: cand.original_text,
            old_recurrence_group_id: findingInfo.current_recurrence_group_id || null, // Note: deep review might not have stored old group directly, but we can fetch it if needed.
            previous_local_decision: localInfo.local_decision || 'LOCAL_UNCERTAIN',
            new_proposed_decision: 'DISTINCT',
            proposed_new_recurrence_group_id: deterministicId,
            proposed_title: cand.original_text,
            normalized_key: normalizedKey,
            reason: "Safe distinct override confirmed by Deep Review.",
            evidence: findingInfo.semantic_comparison ? findingInfo.semantic_comparison.analysis : "Entity/Context Conflict",
            confidence: 'HIGH'
        });
    }

    fs.writeFileSync('safe_distinct_resolution.json', JSON.stringify(output, null, 2));

    let mdContent = `# Safe Distinct Resolutions\n\n`;
    mdContent += `## Summary\n`;
    mdContent += `- **Total Cases:** ${output.length}\n\n`;

    mdContent += `## Cases\n\n`;
    for (const res of output) {
        mdContent += `### Finding: \`${res.original_text}\`\n`;
        mdContent += `- **Finding ID:** ${res.finding_id}\n`;
        mdContent += `- **Proposed Decision:** **${res.new_proposed_decision}** (Confidence: ${res.confidence})\n`;
        mdContent += `- **Proposed New Group ID:** ${res.proposed_new_recurrence_group_id}\n`;
        mdContent += `- **Proposed Title:** ${res.proposed_title}\n`;
        mdContent += `- **Normalized Key:** ${res.normalized_key}\n`;
        mdContent += `- **Reason:** ${res.reason}\n`;
        mdContent += `- **Evidence:** ${res.evidence}\n\n`;
    }

    fs.writeFileSync('safe_distinct_resolution.md', mdContent);
    console.log("Completed. Output: safe_distinct_resolution.json, safe_distinct_resolution.md");
}

runPrepare();
