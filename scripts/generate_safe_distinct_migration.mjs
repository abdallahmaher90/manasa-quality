import fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function generateMigration() {
    const data = JSON.parse(fs.readFileSync('safe_distinct_resolution.json', 'utf8'))
    
    // Fetch current recurrence_group_id from DB to ensure guarded update is accurate
    const findingIds = data.map(d => d.finding_id)
    const { data: dbFindings } = await supabase.from('report_findings').select('id, recurrence_group_id').in('id', findingIds)
    const dbMap = new Map(dbFindings.map(f => [f.id, f.recurrence_group_id]))

    data.forEach(d => {
        d.old_recurrence_group_id = dbMap.get(d.finding_id)
    })

    const generateSql = (isDryRun) => {
        let sql = `-- SAFE DISTINCT MIGRATION${isDryRun ? ' (DRY RUN)' : ''}\n`
        sql += `-- Generated at: ${new Date().toISOString()}\n\n`
        
        sql += `BEGIN;\n\n`

        // Temporary table for migration plan
        sql += `CREATE TEMP TABLE _safe_distinct_migration_plan (\n`
        sql += `    finding_id UUID PRIMARY KEY,\n`
        sql += `    old_group_id UUID,\n`
        sql += `    new_group_id UUID\n`
        sql += `) ON COMMIT DROP;\n\n`

        for (const item of data) {
            sql += `INSERT INTO _safe_distinct_migration_plan (finding_id, old_group_id, new_group_id)\n`
            sql += `VALUES ('${item.finding_id}', ${item.old_recurrence_group_id ? `'${item.old_recurrence_group_id}'` : 'NULL'}, '${item.proposed_new_recurrence_group_id}');\n\n`
        }

        sql += `-- 1. INSERT NEW GROUPS\n`
        for (const item of data) {
            const titleEscaped = item.proposed_title.replace(/'/g, "''")
            const normalizedEscaped = item.normalized_key.replace(/'/g, "''")
            // Assuming required fields include normalized_key, confidence, review_status, matching_policy_version based on prompt
            sql += `INSERT INTO recurrence_groups (id, title, normalized_key, confidence, review_status, matching_policy_version)\n`
            sql += `VALUES ('${item.proposed_new_recurrence_group_id}', '${titleEscaped}', '${normalizedEscaped}', 'HIGH', 'REVIEWED_SAFE', 'v4')\n`
            sql += `ON CONFLICT (id) DO NOTHING;\n\n`
        }

        sql += `-- 2. GUARDED UPDATES\n`
        for (const item of data) {
            sql += `UPDATE report_findings\n`
            sql += `SET recurrence_group_id = '${item.proposed_new_recurrence_group_id}', updated_at = NOW()\n`
            sql += `WHERE id = '${item.finding_id}'\n`
            sql += `AND recurrence_group_id IS NOT DISTINCT FROM ${item.old_recurrence_group_id ? `'${item.old_recurrence_group_id}'` : 'NULL'};\n\n`
        }

        sql += `-- 3. ASSERTIONS\n`
        sql += `DO $$\n`
        sql += `DECLARE\n`
        sql += `    v_total_findings INT;\n`
        sql += `    v_updated_findings INT;\n`
        sql += `BEGIN\n`
        sql += `    SELECT COUNT(*) INTO v_total_findings FROM report_findings;\n`
        sql += `    IF v_total_findings != 1366 THEN\n`
        sql += `        RAISE EXCEPTION 'Total findings changed! Expected 1366, got %', v_total_findings;\n`
        sql += `    END IF;\n\n`

        sql += `    SELECT COUNT(*) INTO v_updated_findings\n`
        sql += `    FROM report_findings f\n`
        sql += `    JOIN _safe_distinct_migration_plan p ON f.id = p.finding_id\n`
        sql += `    WHERE f.recurrence_group_id = p.new_group_id;\n\n`

        sql += `    IF v_updated_findings != 3 THEN\n`
        sql += `        RAISE EXCEPTION 'Expected 3 updated findings, got %', v_updated_findings;\n`
        sql += `    END IF;\n`
        sql += `END $$;\n\n`

        if (isDryRun) {
            sql += `ROLLBACK;\n`
        } else {
            sql += `COMMIT;\n`
        }

        return sql
    }

    const dryRunSql = generateSql(true)
    const execSql = generateSql(false)

    // Rollback script
    let rollbackSql = `-- SAFE DISTINCT ROLLBACK\n`
    rollbackSql += `BEGIN;\n\n`
    for (const item of data) {
        rollbackSql += `UPDATE report_findings\n`
        rollbackSql += `SET recurrence_group_id = ${item.old_recurrence_group_id ? `'${item.old_recurrence_group_id}'` : 'NULL'}, updated_at = NOW()\n`
        rollbackSql += `WHERE id = '${item.finding_id}' AND recurrence_group_id = '${item.proposed_new_recurrence_group_id}';\n\n`
    }
    rollbackSql += `-- Note: We do not delete the new groups to avoid cascade issues. They will remain as orphans temporarily.\n\n`
    rollbackSql += `COMMIT;\n`

    fs.writeFileSync('safe_distinct_migration_dryrun.sql', dryRunSql)
    fs.writeFileSync('safe_distinct_migration.sql', execSql)
    fs.writeFileSync('safe_distinct_migration_rollback.sql', rollbackSql)

    console.log("Migration Generation Complete:")
    console.log(`- INSERTs: ${data.length}`)
    console.log(`- UPDATEs: ${data.length}\n`)
    data.forEach((d, i) => {
        console.log(`[Item ${i+1}]`)
        console.log(`Finding ID: ${d.finding_id}`)
        console.log(`Old Group:  ${d.old_recurrence_group_id}`)
        console.log(`New Group:  ${d.proposed_new_recurrence_group_id}`)
        console.log(`Norm Key:   ${d.normalized_key}\n`)
    })
}

generateMigration().catch(console.error)
