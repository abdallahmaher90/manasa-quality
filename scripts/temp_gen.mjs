import fs from 'fs'

const plan = JSON.parse(fs.readFileSync('recurrence_migration_plan.json', 'utf8'));

const valuesStrings = plan.map(p => {
    const oldId = p.current_recurrence_group_id ? `'${p.current_recurrence_group_id}'` : 'NULL';
    const newTitleEscaped = p.new_group_prototype ? p.new_group_prototype.replace(/'/g, "''") : '';
    return `('${p.finding_id}', ${oldId}, '${p.proposed_recurrence_group_id}', '${newTitleEscaped}')`;
});

const sql = `CREATE TEMP TABLE _migration_plan (
    finding_id UUID PRIMARY KEY,
    old_group_id UUID,
    new_group_id UUID,
    new_group_title TEXT
);

INSERT INTO _migration_plan (finding_id, old_group_id, new_group_id, new_group_title) VALUES
` + valuesStrings.join(',\n') + `;

SELECT mp.new_group_id AS missing_target_group_id,
       COUNT(mp.finding_id) AS affected_findings_count,
       ARRAY_AGG(mp.finding_id) AS affected_finding_ids,
       MAX(mp.new_group_title) AS new_group_title,
       ARRAY_AGG(mp.old_group_id) AS old_group_ids
FROM _migration_plan mp
LEFT JOIN recurrence_groups rg ON mp.new_group_id = rg.id
WHERE rg.id IS NULL
GROUP BY mp.new_group_id;
`;

fs.writeFileSync('scripts/diagnose_missing_target_group.sql', sql);
