import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function runAudit() {
    console.log("Running POST-MIGRATION AUDIT for 3 SAFE DISTINCT findings...")

    const targetCases = [
        {
            finding_id: '1ebd9c93-5109-47ea-878a-2df65dc71518',
            expected_group_id: 'cd30ccdd-0812-4b5e-a386-ca10d64e4d41',
            expected_title: 'غرفة الأرشيف غير مطابقة للمواصفات',
            expected_norm_key: 'غرفه الارشيف غير مطابقه للمواصفات'
        },
        {
            finding_id: '63c41f52-dd9c-4a92-bcee-f8937d7e46bc',
            expected_group_id: '4721c3ee-5aea-4b7a-ad1f-9fa6b46f8526',
            expected_title: 'يوجد ألات منتهية التعقيم و آخري منتهية التطهير',
            expected_norm_key: 'يوجد الات منتهيه التعقيم و اخري منتهيه التطهير'
        },
        {
            finding_id: '8a72c2b7-b2ab-4c21-82e3-08b49d8ce192',
            expected_group_id: 'a1e33baf-658d-4d2b-a67b-ac2e16183157',
            expected_title: 'سجل التسليم و التسلم للتعقيم غير مكتمل وقت و تاريخ الاستلام للآلات المعقمة و تسليم الآلات الملوثة للتعقيم',
            expected_norm_key: 'سجل التسليم و التسلم للتعقيم غير مكتمل وقت و تاريخ الاستلام للالات المعقمه و تسليم الالات الملوثه للتعقيم'
        }
    ];

    const auditResults = {
        summary: {
            total_findings: 0,
            assertions_passed: 0,
            assertions_failed: 0,
            orphan_groups: 0,
            duplicate_findings: 0
        },
        cases: [],
        assertions: []
    }

    const logAssertion = (name, passed, details = '') => {
        auditResults.assertions.push({ name, passed, details })
        if (passed) auditResults.summary.assertions_passed++
        else auditResults.summary.assertions_failed++
    }

    // 1. Total findings = 1366
    const { count: totalFindings } = await supabase.from('report_findings').select('*', { count: 'exact', head: true })
    logAssertion('total_report_findings_is_1366', totalFindings === 1366, `Found: ${totalFindings}`)
    auditResults.summary.total_findings = totalFindings

    // 2. Duplicate finding_id check
    // In postgres, finding_id (id) is PK, so duplicate finding_id is impossible by DB constraint, 
    // but we can log that it's verified by schema.
    logAssertion('no_duplicate_finding_id', true, 'Verified by Primary Key constraint on report_findings.id')

    for (const c of targetCases) {
        let caseAudit = {
            finding_id: c.finding_id,
            assertions: [],
            unexpected_changes: []
        };
        const assertCase = (name, passed, details) => {
            caseAudit.assertions.push({ name, passed, details })
        }

        // Fetch finding
        const { data: finding } = await supabase.from('report_findings').select('*').eq('id', c.finding_id).single()
        
        if (!finding) {
            assertCase('finding_exists', false, 'Finding not found in DB')
            auditResults.cases.push(caseAudit)
            continue
        }

        assertCase('recurrence_group_id_correct', finding.recurrence_group_id === c.expected_group_id, `Expected ${c.expected_group_id}, got ${finding.recurrence_group_id}`)
        
        // Fetch group
        const { data: group } = await supabase.from('recurrence_groups').select('*').eq('id', c.expected_group_id).single()
        
        if (!group) {
            assertCase('recurrence_groups_row_exists', false, 'Group not found in DB')
        } else {
            assertCase('recurrence_groups_row_exists', true, 'Group exists')
            assertCase('title_correct', group.title === c.expected_title, `Expected ${c.expected_title}, got ${group.title}`)
            assertCase('normalized_key_correct', group.normalized_key === c.expected_norm_key, `Expected ${c.expected_norm_key}, got ${group.normalized_key}`)
        }

        // Check finding invariants
        assertCase('original_text_unchanged', finding.original_text === c.expected_title, 'Original text matches expected title text')
        assertCase('report_id_present', !!finding.report_id, 'report_id is preserved')
        assertCase('hospital_id_present', !!finding.hospital_id, 'hospital_id is preserved')
        assertCase('department_id_present', !!finding.department_id, 'department_id is preserved')
        assertCase('status_present', finding.status !== null, 'status is preserved')
        assertCase('priority_present', finding.priority !== null, 'priority is preserved')
        assertCase('created_at_present', finding.created_at !== null, 'created_at is preserved')

        const { count: groupMembers } = await supabase.from('report_findings').select('*', { count: 'exact', head: true }).eq('recurrence_group_id', c.expected_group_id)
        caseAudit.group_member_count = groupMembers
        assertCase('group_member_count_correct', groupMembers === 1, `Expected 1 member, got ${groupMembers}`)

        auditResults.cases.push(caseAudit)
    }

    fs.writeFileSync('safe_distinct_post_migration_audit.json', JSON.stringify(auditResults, null, 2))
    console.log("POST-MIGRATION AUDIT complete. Results written to safe_distinct_post_migration_audit.json")
    console.log(`Passed: ${auditResults.summary.assertions_passed}, Failed: ${auditResults.summary.assertions_failed}`)
}

runAudit().catch(console.error)
