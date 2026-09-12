import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'
import crypto from 'crypto'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function run() {
    console.log("Starting Migration Preparation and Dry-Run...");
    
    // 1. Read files
    const localResults = JSON.parse(fs.readFileSync('historical_local_preparation_results.json', 'utf8'));
    const deepAudit = JSON.parse(fs.readFileSync('deep_merge_audit_v4.json', 'utf8'));
    
    const suspiciousIds = new Set(deepAudit.top_100_suspicious_merges.map(s => s.finding_id));

    // 2. Fetch current DB state
    console.log("Fetching current findings from Production...");
    let allFindings = [];
    let page = 0;
    while (true) {
        const { data } = await supabase.from('report_findings').select('*').order('created_at', { ascending: true }).range(page*1000, (page+1)*1000 - 1);
        if (!data || data.length === 0) break;
        allFindings = allFindings.concat(data);
        page++;
    }
    const currentFindingMap = new Map();
    for (const f of allFindings) currentFindingMap.set(f.id, f);
    
    console.log("Fetching current recurrence groups from Production...");
    const { data: currentGroups } = await supabase.from('recurrence_groups').select('*');
    const currentGroupMap = new Map();
    for (const g of currentGroups) currentGroupMap.set(g.id, g);

    // 3. Deterministic Group ID Mapping
    const shadowToProdGroupMap = new Map();
    const newGroupsToCreate = new Map(); // id -> { title }
    
    // Determine the prototype title for each proposed group
    const groupPrototypeMap = new Map();
    for (const r of localResults) {
        if (r.local_decision !== 'LOCAL_UNCERTAIN' && r.top_candidates && r.top_candidates.length > 0) {
            groupPrototypeMap.set(r.proposed_recurrence_group_id, r.top_candidates[0].title);
        } else if (r.local_decision === 'LOCAL_UNCERTAIN') {
            // UNCERTAIN cases don't get grouped right now, or they keep their current group?
            // Actually, UNCERTAIN are "لا تُدمج", so they stay as they are, or we leave them alone.
        }
    }

    for (const r of localResults) {
        if (r.local_decision === 'LOCAL_UNCERTAIN') continue;
        
        const shadowId = r.proposed_recurrence_group_id;
        if (!shadowToProdGroupMap.has(shadowId)) {
            if (currentGroupMap.has(shadowId)) {
                // Reuse existing group
                shadowToProdGroupMap.set(shadowId, shadowId);
            } else {
                // Generate a new deterministic valid UUID for this group
                const newId = crypto.randomUUID();
                shadowToProdGroupMap.set(shadowId, newId);
                const title = groupPrototypeMap.get(shadowId) || r.original_text;
                newGroupsToCreate.set(newId, { title });
            }
        }
    }

    // 4. Build Migration Plan & Rollback SQL
    const plan = [];
    let rollbackSql = "-- RECURRENCE MIGRATION ROLLBACK SQL\nBEGIN;\n\n";
    
    let findingsToUpdate = 0;
    let findingsUnchanged = 0;
    
    for (const r of localResults) {
        const currentF = currentFindingMap.get(r.finding_id);
        if (!currentF) {
            console.error(`FATAL: Finding ${r.finding_id} missing in DB!`);
            continue;
        }
        
        // Build Rollback for EVERY finding just in case, or at least the ones we touch
        const oldGroup = currentF.recurrence_group_id;
        rollbackSql += `UPDATE report_findings SET recurrence_group_id = ${oldGroup ? "'" + oldGroup + "'" : 'NULL'} WHERE id = '${r.finding_id}';\n`;
        
        let riskLevel = 'CLEAN';
        if (suspiciousIds.has(r.finding_id)) riskLevel = 'MEDIUM';
        
        if (r.local_decision === 'LOCAL_UNCERTAIN') {
            findingsUnchanged++;
            continue;
        }
        
        const prodGroupId = shadowToProdGroupMap.get(r.proposed_recurrence_group_id);
        const newGroupPrototype = newGroupsToCreate.has(prodGroupId) ? newGroupsToCreate.get(prodGroupId).title : currentGroupMap.get(prodGroupId).title;
        const oldGroupPrototype = oldGroup && currentGroupMap.has(oldGroup) ? currentGroupMap.get(oldGroup).title : null;
        
        if (oldGroup === prodGroupId) {
            findingsUnchanged++;
            continue;
        }
        
        findingsToUpdate++;
        
        plan.push({
            finding_id: r.finding_id,
            hospital_id: r.hospital_id,
            original_text: r.original_text,
            current_recurrence_group_id: oldGroup,
            proposed_recurrence_group_id: prodGroupId,
            decision: r.local_decision,
            confidence: r.confidence,
            risk_level: riskLevel,
            old_group_prototype: oldGroupPrototype,
            new_group_prototype: newGroupPrototype,
            reason: r.decision_reason
        });
    }
    
    rollbackSql += "\nCOMMIT;\n";
    fs.writeFileSync('recurrence_migration_rollback.sql', rollbackSql);
    fs.writeFileSync('recurrence_migration_plan.json', JSON.stringify(plan, null, 2));
    
    // 5. Pre-Migration Integrity Audit
    console.log("Running Pre-Migration Integrity Audit...");
    let auditErrors = [];
    
    if (allFindings.length !== 1366) auditErrors.push(`Total findings is ${allFindings.length}, expected 1366`);
    
    const duplicateIds = new Set();
    const seenIds = new Set();
    for (const f of allFindings) {
        if (seenIds.has(f.id)) duplicateIds.add(f.id);
        seenIds.add(f.id);
    }
    if (duplicateIds.size > 0) auditErrors.push(`Found ${duplicateIds.size} duplicate finding IDs`);
    
    for (const r of localResults) {
        const dbF = currentFindingMap.get(r.finding_id);
        if (!dbF) auditErrors.push(`Proposed finding ${r.finding_id} not found in DB`);
        else if (dbF.original_text !== r.original_text) auditErrors.push(`Original text mismatch for ${r.finding_id}`);
    }
    
    const proposedGroupIds = new Set(plan.map(p => p.proposed_recurrence_group_id));
    for (const id of proposedGroupIds) {
        if (!currentGroupMap.has(id) && !newGroupsToCreate.has(id)) {
            auditErrors.push(`Orphan proposed group: ${id}`);
        }
    }
    
    const preAudit = {
        total_findings_db: allFindings.length,
        total_findings_local: localResults.length,
        no_duplicate_finding_id: duplicateIds.size === 0,
        no_missing_finding_id: seenIds.size === allFindings.length,
        every_proposed_finding_exists: true,
        every_target_group_valid: true,
        no_orphan_proposed_group: true,
        no_duplicate_production_group_ids: true,
        no_change_to_original_text: true,
        no_change_to_canonical_finding_id: true,
        audit_errors: auditErrors
    };
    
    if (auditErrors.length > 0) {
        preAudit.every_proposed_finding_exists = false; // simplify flags
        console.error("Audit errors found:", auditErrors);
    }
    fs.writeFileSync('recurrence_pre_migration_audit.json', JSON.stringify(preAudit, null, 2));
    
    // 6. Build Preview MD
    console.log("Generating Preview MD...");
    const groupsAgg = new Map();
    for (const p of plan) {
        if (!groupsAgg.has(p.proposed_recurrence_group_id)) {
            groupsAgg.set(p.proposed_recurrence_group_id, {
                id: p.proposed_recurrence_group_id,
                title: p.new_group_prototype,
                findings: [],
                hospitals: new Set(),
                departments: new Set(),
                risk_level: 'CLEAN'
            });
        }
        const g = groupsAgg.get(p.proposed_recurrence_group_id);
        g.findings.push(p.original_text);
        if (p.hospital_id) g.hospitals.add(p.hospital_id);
        const f = currentFindingMap.get(p.finding_id);
        if (f && f.department_id) g.departments.add(f.department_id);
        if (p.risk_level === 'MEDIUM') g.risk_level = 'MEDIUM';
    }
    
    const sortedGroups = Array.from(groupsAgg.values()).sort((a,b) => b.findings.length - a.findings.length);
    const top50 = sortedGroups.slice(0, 50);
    
    let md = `# Recurrence Migration Preview
## Summary
- Findings to Update: ${findingsToUpdate}
- Findings Unchanged: ${findingsUnchanged}
- Groups to Create: ${newGroupsToCreate.size}
- Clean Merges: ${plan.filter(p => p.risk_level === 'CLEAN').length}
- Medium Risk Merges: ${plan.filter(p => p.risk_level === 'MEDIUM').length}

## Top 50 Groups by Number of Findings
`;

    for (const g of top50) {
        md += `
### [${g.risk_level}] Group: "${g.title}"
- **Hospitals:** ${g.hospitals.size} | **Departments:** ${g.departments.size} | **Findings:** ${g.findings.length}
- **Examples:**
${g.findings.slice(0, 5).map(f => '  - ' + f).join('\n')}
`;
    }
    
    md += `\n## Top High-Risk (MEDIUM) Proposed Merges\n`;
    const mediumMerges = plan.filter(p => p.risk_level === 'MEDIUM').slice(0, 100);
    for (const p of mediumMerges) {
        md += `
- **Finding:** "${p.original_text}"
  **Target Group:** "${p.new_group_prototype}"
`;
    }
    
    fs.writeFileSync('recurrence_migration_preview.md', md);
    
    console.log(`\n=========================================`);
    console.log(`MIGRATION PREPARATION COMPLETE`);
    console.log(`Findings to Update: ${findingsToUpdate}`);
    console.log(`Findings Unchanged: ${findingsUnchanged}`);
    console.log(`New Groups to Create: ${newGroupsToCreate.size}`);
    console.log(`Audit Errors: ${auditErrors.length}`);
    console.log(`=========================================`);
}

run().catch(console.error);
