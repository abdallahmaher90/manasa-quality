# Post-Migration Recurrence Analytics Audit

## Summary
- **Total Findings:** 1366
- **Finalized Assignments Checked:** YES
- **Recurring Groups (>1 finding):** 134
- **Singletons (1 finding or NULL group):** 1035
- **Same-Hospital Recurring:** 19
- **Cross-Hospital Common:** 115
- **Orphan Group Count:** 239

## Assertions (PASS/FAIL)
- **[✅ PASS]** total_report_findings_valid: Found 1366
- **[✅ PASS]** orphan_groups_counted_safely: Found 239 orphans. Left untouched.
- **[✅ PASS]** recurrence_group_id_is_grouping_key: Department ID is ignored for grouping logic
- **[✅ PASS]** test_case_found: الوصفه الدوائيه غير مكتمله: Members: 6, Hospitals: 5
- **[✅ PASS]** test_case_found: لا يوجد قائمه بالاختصارات المسموحه الممنوعه: Members: 12, Hospitals: 8
- **[✅ PASS]** test_case_found: توقيع الاطباء فورمه: Members: 4, Hospitals: 3
- **[✅ PASS]** test_case_found: غرفه الارشيف غير مطابقه للمواصفات: Members: 1, Hospitals: 1
- **[✅ PASS]** ui_api_consistency_canonical_title: Original text is preserved on finding level; canonical title remains on group level.
- **[✅ PASS]** ui_api_consistency_recurrence_count: Total occurrences calculated correctly via group aggregation.

## Test Cases Validation
### `الوصفه الدوائيه غير مكتمله`
- Found: true
- Group ID: 3e78798a-32ee-464c-9b65-46e5074737cf
- Total Occurrences: 6
- Hospitals Involved: 5

### `لا يوجد قائمه بالاختصارات المسموحه الممنوعه`
- Found: true
- Group ID: e863b01a-28f1-4e2b-a330-1996958844a4
- Total Occurrences: 12
- Hospitals Involved: 8

### `توقيع الاطباء فورمه`
- Found: true
- Group ID: 31e6faaa-f311-41e3-9a82-4cf1f27f679a
- Total Occurrences: 4
- Hospitals Involved: 3

### `غرفه الارشيف غير مطابقه للمواصفات`
- Found: true
- Group ID: cd30ccdd-0812-4b5e-a386-ca10d64e4d41
- Total Occurrences: 1
- Hospitals Involved: 1

