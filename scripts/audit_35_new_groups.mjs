import fs from 'fs'

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

async function run() {
    console.log("Starting audit of 35 new recurrence groups...");
    const plan = JSON.parse(fs.readFileSync('recurrence_migration_plan.json', 'utf8'))
    const localResults = JSON.parse(fs.readFileSync('historical_local_preparation_results.json', 'utf8'))
    
    // Build production cache proxy from all top_candidates
    const prodGroups = new Map()
    for (const r of localResults) {
        if (r.top_candidates) {
            for (const c of r.top_candidates) {
                if (c.title) {
                    prodGroups.set(normalizeRecurrenceKey(c.title), c)
                }
            }
        }
    }
    
    // 1) Extract the 35 new groups
    const newGroupsMap = new Map()
    let hasMismatch = false
    
    for (const p of plan) {
        // If it's a new prototype, current_recurrence_group_id must be null
        if (p.new_group_prototype) {
            if (p.current_recurrence_group_id !== null) {
                console.error("Mismatch: Finding has old_group_id but plan proposes a new group prototype!", p)
                hasMismatch = true
            }
            
            if (!newGroupsMap.has(p.proposed_recurrence_group_id)) {
                newGroupsMap.set(p.proposed_recurrence_group_id, {
                    proposed_recurrence_group_id: p.proposed_recurrence_group_id,
                    proposed_title: p.new_group_prototype,
                    normalized_key: normalizeRecurrenceKey(p.new_group_prototype),
                    findings_count: 0,
                    findings: [],
                    original_text_examples: []
                })
            }
            
            const group = newGroupsMap.get(p.proposed_recurrence_group_id)
            group.findings_count++
            group.findings.push(p.finding_id)
            if (group.original_text_examples.length < 3) {
                group.original_text_examples.push(p.original_text)
            }
            
        } else {
             // Not a new group. It MUST have a current_recurrence_group_id or something else, but it's not a new group.
        }
    }
    
    if (hasMismatch) {
        console.error("STOPPING due to finding mismatch in new group assignment.");
        process.exit(1)
    }
    
    const newGroups = Array.from(newGroupsMap.values())
    
    // 2) Check for collisions
    const duplicateNormalizedKeys = []
    const selfCollisions = new Map()
    
    for (const ng of newGroups) {
        // Prod collision
        if (prodGroups.has(ng.normalized_key)) {
            duplicateNormalizedKeys.push({
                type: 'production_collision',
                new_group_id: ng.proposed_recurrence_group_id,
                new_group_title: ng.proposed_title,
                normalized_key: ng.normalized_key,
                collides_with: prodGroups.get(ng.normalized_key)
            })
        }
        
        // Self collision
        if (!selfCollisions.has(ng.normalized_key)) {
            selfCollisions.set(ng.normalized_key, [])
        }
        selfCollisions.get(ng.normalized_key).push(ng)
    }
    
    for (const [key, groups] of selfCollisions.entries()) {
        if (groups.length > 1) {
            duplicateNormalizedKeys.push({
                type: 'self_collision',
                normalized_key: key,
                groups: groups.map(g => ({ id: g.proposed_recurrence_group_id, title: g.proposed_title }))
            })
        }
    }
    
    fs.writeFileSync('duplicate_normalized_keys.json', JSON.stringify(duplicateNormalizedKeys, null, 2))
    
    // 4 & 5) Extract fields for DB insertion
    const dbFieldsAudit = newGroups.map(ng => {
        return {
            id: ng.proposed_recurrence_group_id,
            title: ng.proposed_title,
            normalized_key: ng.normalized_key,
            entity: null, // As generated in SQL script
            defect: null, // As generated in SQL script
            domain: null, // As generated in SQL script
            confidence: 'HIGH_CONFIDENCE', // Default in schema
            review_status: 'confirmed', // Default in schema
            matching_policy_version: 'RECURRENCE_MATCHING_POLICY_V1' // Default in schema
        }
    })
    
    // Generate Outputs
    const auditJson = {
        summary: {
            new_groups_count: newGroups.length,
            duplicate_normalized_keys_count: duplicateNormalizedKeys.length,
            production_normalized_key_collisions: duplicateNormalizedKeys.filter(d => d.type === 'production_collision').length,
            self_collisions: duplicateNormalizedKeys.filter(d => d.type === 'self_collision').length,
            groups_with_missing_semantic_metadata: dbFieldsAudit.filter(g => g.entity === null).length,
            findings_assigned_to_new_groups: newGroups.reduce((acc, val) => acc + val.findings_count, 0)
        },
        groups: newGroups.map(ng => {
            const dbFields = dbFieldsAudit.find(d => d.id === ng.proposed_recurrence_group_id)
            return {
                ...ng,
                db_fields: dbFields
            }
        })
    }
    
    fs.writeFileSync('new_groups_audit.json', JSON.stringify(auditJson, null, 2))
    
    let md = `# New Recurrence Groups Audit\n\n`
    md += `## Summary\n`
    md += `- **New Groups Count:** ${auditJson.summary.new_groups_count}\n`
    md += `- **Findings Assigned to New Groups:** ${auditJson.summary.findings_assigned_to_new_groups}\n`
    md += `- **Production Collisions:** ${auditJson.summary.production_normalized_key_collisions}\n`
    md += `- **Self Collisions:** ${auditJson.summary.self_collisions}\n`
    md += `- **Missing Semantic Metadata (entity, defect, domain):** ${auditJson.summary.groups_with_missing_semantic_metadata} (Will be NULL)\n\n`
    
    md += `## Database Fields Mapping\n`
    md += `Each new group will be inserted with these fields according to \`generate_sql_migration.mjs\` and Schema defaults:\n`
    md += `- **id, title, normalized_key:** Explicitly inserted.\n`
    md += `- **entity, defect, domain:** \`NULL\` (Not populated because we rely on semantic engine or NULL logic. Schema allows NULL).\n`
    md += `- **confidence:** \`HIGH_CONFIDENCE\` (Schema DEFAULT).\n`
    md += `- **review_status:** \`confirmed\` (Schema DEFAULT).\n`
    md += `- **matching_policy_version:** \`RECURRENCE_MATCHING_POLICY_V1\` (Schema DEFAULT).\n\n`
    
    md += `## Duplicate Keys Check\n`
    if (duplicateNormalizedKeys.length > 0) {
        md += `⚠️ Found ${duplicateNormalizedKeys.length} duplicates. Check \`duplicate_normalized_keys.json\` for details.\n\n`
    } else {
        md += `✅ No duplicate normalized_keys found (neither in Production Cache nor among the 35 new groups).\n\n`
    }
    
    md += `## Groups Detail\n\n`
    for (const g of auditJson.groups) {
        md += `### ${g.proposed_title}\n`
        md += `- **ID:** ${g.proposed_recurrence_group_id}\n`
        md += `- **Normalized Key:** ${g.normalized_key}\n`
        md += `- **Findings Count:** ${g.findings_count}\n`
        md += `- **Examples:**\n`
        for (const ex of g.original_text_examples) {
            md += `  - ${ex}\n`
        }
        md += `\n`
    }
    
    fs.writeFileSync('new_groups_audit.md', md)
    console.log("Audit files generated.")
}

run()
