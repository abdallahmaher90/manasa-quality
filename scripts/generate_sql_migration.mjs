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

function run() {
    console.log("Generating SQL scripts from migration plan...");
    
    // Read the plan
    const plan = JSON.parse(fs.readFileSync('recurrence_migration_plan.json', 'utf8'));
    const totalPlanned = plan.length;
    
    console.log(`Loaded ${totalPlanned} planned updates.`);
    
    // 1. Build INSERT values for the temp table
    const valuesStrings = plan.map(p => {
        const oldId = p.current_recurrence_group_id ? `'${p.current_recurrence_group_id}'` : 'NULL';
        const newTitleEscaped = p.new_group_prototype ? p.new_group_prototype.replace(/'/g, "''") : '';
        const newNormalizedKey = p.new_group_prototype ? normalizeRecurrenceKey(p.new_group_prototype) : '';
        const newNormalizedKeyEscaped = newNormalizedKey.replace(/'/g, "''");
        return `('${p.finding_id}', ${oldId}, '${p.proposed_recurrence_group_id}', '${newTitleEscaped}', '${newNormalizedKeyEscaped}')`;
    });
    
    // Split into chunks if needed, but 125 is small enough for a single INSERT
    const insertStatement = `INSERT INTO _migration_plan (finding_id, old_group_id, new_group_id, new_group_title, new_group_normalized_key) VALUES\n` + valuesStrings.join(',\n') + ';';
    
    // Template for the core transaction body
    const transactionBody = `
-- Preflight setup
CREATE TEMP TABLE _migration_plan (
    finding_id UUID PRIMARY KEY,
    old_group_id UUID,
    new_group_id UUID,
    new_group_title TEXT,
    new_group_normalized_key TEXT
);

${insertStatement}

DO $$
DECLARE
    v_total_planned INT;
    v_missing_findings INT;
    v_mismatched_old_groups INT;
    v_missing_target_groups INT;
    v_updated_rows INT;
    v_mismatch_fields INT;
    v_total_findings INT;
BEGIN
    -- Assert planned count
    SELECT COUNT(*) INTO v_total_planned FROM _migration_plan;
    IF v_total_planned <> ${totalPlanned} THEN 
        RAISE EXCEPTION 'Planned updates mismatch. Expected ${totalPlanned}, got %', v_total_planned; 
    END IF;
    
    -- Assert finding existence and old group matching
    SELECT COUNT(*) INTO v_mismatched_old_groups
    FROM _migration_plan mp
    LEFT JOIN report_findings rf ON mp.finding_id = rf.id
    WHERE rf.id IS NULL OR rf.recurrence_group_id IS DISTINCT FROM mp.old_group_id;
    
    IF v_mismatched_old_groups > 0 THEN
        RAISE EXCEPTION 'Preflight failed: % findings missing or have altered recurrence_group_id', v_mismatched_old_groups;
    END IF;

    -- Identify missing target groups
    CREATE TEMP TABLE _missing_targets AS
    SELECT DISTINCT mp.new_group_id, mp.new_group_title, mp.new_group_normalized_key
    FROM _migration_plan mp
    LEFT JOIN recurrence_groups rg ON mp.new_group_id = rg.id
    WHERE rg.id IS NULL;

    -- Assert exactly 1 missing target group
    SELECT COUNT(*) INTO v_missing_target_groups FROM _missing_targets;
    IF v_missing_target_groups <> 1 THEN
        RAISE EXCEPTION 'Preflight failed: Expected exactly 1 new target group to insert, but found %', v_missing_target_groups;
    END IF;

    -- Insert the new target group
    INSERT INTO recurrence_groups (id, title, normalized_key)
    SELECT new_group_id, new_group_title, new_group_normalized_key
    FROM _missing_targets
    ON CONFLICT (id) DO NOTHING;

    -- Pre-Migration Snapshot
    CREATE TEMP TABLE _migration_snapshot AS
    SELECT id, recurrence_group_id, original_text, canonical_finding_id, report_id, hospital_id, department_id, status, priority, corrective_action, responsible, deadline, created_at
    FROM report_findings
    WHERE id IN (SELECT finding_id FROM _migration_plan);

    -- Guarded UPDATEs
    WITH updated AS (
        UPDATE report_findings rf
        SET recurrence_group_id = mp.new_group_id
        FROM _migration_plan mp
        WHERE rf.id = mp.finding_id 
          AND rf.recurrence_group_id IS NOT DISTINCT FROM mp.old_group_id
        RETURNING rf.id
    )
    SELECT COUNT(*) INTO v_updated_rows FROM updated;

    IF v_updated_rows <> ${totalPlanned} THEN
        RAISE EXCEPTION 'Update failed: expected ${totalPlanned} rows updated, got %', v_updated_rows;
    END IF;

    -- Post-migration Assertions
    
    -- Check business fields integrity
    SELECT COUNT(*) INTO v_mismatch_fields
    FROM report_findings curr
    JOIN _migration_snapshot snap ON curr.id = snap.id
    WHERE curr.original_text IS DISTINCT FROM snap.original_text
       OR curr.canonical_finding_id IS DISTINCT FROM snap.canonical_finding_id
       OR curr.hospital_id IS DISTINCT FROM snap.hospital_id
       OR curr.report_id IS DISTINCT FROM snap.report_id
       OR curr.department_id IS DISTINCT FROM snap.department_id
       OR curr.status IS DISTINCT FROM snap.status
       OR curr.priority IS DISTINCT FROM snap.priority
       OR curr.corrective_action IS DISTINCT FROM snap.corrective_action
       OR curr.responsible IS DISTINCT FROM snap.responsible
       OR curr.deadline IS DISTINCT FROM snap.deadline
       OR curr.created_at IS DISTINCT FROM snap.created_at;
       
    IF v_mismatch_fields > 0 THEN
        RAISE EXCEPTION 'Post-migration assertion failed: Business fields unexpectedly mutated for % rows', v_mismatch_fields;
    END IF;
    
    -- Total count check
    SELECT COUNT(*) INTO v_total_findings FROM report_findings;
    IF v_total_findings <> 1366 THEN
        RAISE EXCEPTION 'Post-migration assertion failed: Total findings count is % instead of 1366', v_total_findings;
    END IF;
    
    RAISE NOTICE 'Transaction logic completed successfully. All assertions passed.';
END $$;
`;

    // 1. recurrence_migration_transaction.sql
    const sqlTransaction = `BEGIN;\n${transactionBody}\nCOMMIT;\n`;
    fs.writeFileSync('recurrence_migration_transaction.sql', sqlTransaction);

    // 2. recurrence_migration_transaction_dryrun.sql
    const sqlDryrun = `BEGIN;\n${transactionBody}\nROLLBACK;\n`;
    fs.writeFileSync('recurrence_migration_transaction_dryrun.sql', sqlDryrun);

    // 3. recurrence_post_migration_audit.sql
    const sqlAudit = `-- POST MIGRATION READ-ONLY AUDIT

-- 1. Total findings
SELECT COUNT(*) AS total_findings FROM report_findings;

-- 2. Recurrence Group member counts (Top 50)
SELECT rg.title, rg.id, COUNT(rf.id) as member_count, COUNT(DISTINCT rf.hospital_id) as hospital_count
FROM recurrence_groups rg
LEFT JOIN report_findings rf ON rg.id = rf.recurrence_group_id
GROUP BY rg.id, rg.title
ORDER BY member_count DESC
LIMIT 50;

-- 3. Orphan Groups check (Groups with 0 members)
SELECT COUNT(*) AS orphan_groups
FROM recurrence_groups rg
LEFT JOIN report_findings rf ON rg.id = rf.recurrence_group_id
WHERE rf.id IS NULL;

-- 4. Verify original_text and canonical integrity (Sample check)
SELECT id, original_text, canonical_finding_id, recurrence_group_id 
FROM report_findings 
LIMIT 10;
`;
    fs.writeFileSync('recurrence_post_migration_audit.sql', sqlAudit);

    // 4. Update recurrence_migration_rollback.sql
    // Guarded WHERE includes old group IS target, to prevent reverting something modified AFTER migration
    let sqlRollback = "BEGIN;\n\n";
    for (const p of plan) {
        const oldId = p.current_recurrence_group_id ? `'${p.current_recurrence_group_id}'` : 'NULL';
        sqlRollback += `UPDATE report_findings SET recurrence_group_id = ${oldId} WHERE id = '${p.finding_id}' AND recurrence_group_id = '${p.proposed_recurrence_group_id}';\n`;
    }
    sqlRollback += "\nCOMMIT;\n";
    fs.writeFileSync('recurrence_migration_rollback.sql', sqlRollback);

    console.log("SQL Generation Complete.");
    
    // Calculate stats
    console.log(`recurrence_migration_transaction.sql generated`);
    console.log(`recurrence_migration_transaction_dryrun.sql generated`);
    console.log(`recurrence_post_migration_audit.sql generated`);
    console.log(`recurrence_migration_rollback.sql generated`);
}

run();
