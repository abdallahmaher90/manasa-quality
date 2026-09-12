# FUTURE RECURRENCE FLOW - E2E TEST PLAN
**Baseline:** RECURRENCE_ENGINE_STABLE_BASELINE (v4)
**Objective:** Verify that new reports uploaded through `/api/save-report` correctly apply the V4 recurrence engine policy (SEPARATE > MERGE) without false positives and safely persist all required tracking fields.

---

## 1. Test Scenarios

### Scenario A: Clear Existing Match (SAME_ISSUE)
- **Input Finding:** `"توقيع الاطباء غير مكتمل فورمه"`
- **Target Recurrence Group:** `"توقيع الاطباء فورمه"`
- **Expected Outcome:** 
  - Engine automatically assigns the existing `recurrence_group_id`.
  - `review_status` = `AUTO_MERGED` (or similar successful status depending on exact policy string).
  - No new recurrence group is created.

### Scenario B: Clear Distinct Issue (DISTINCT)
- **Input Finding:** `"تسرب مياه في سقف غرفة العمليات الكبرى"`
- **Expected Outcome:** 
  - Engine fails to find a high-confidence match.
  - A **new** recurrence group is created with title `"تسرب مياه في سقف غرفه العمليات الكبري"`.
  - The finding is assigned the new `recurrence_group_id`.

### Scenario C: Ambiguous / Uncertain Match (UNCERTAIN)
- **Input Finding:** `"لا يوجد سجل اعطال"` *(A known ambiguous case that matches multiple specific breakdown logs)*
- **Expected Outcome:**
  - Engine detects lexical overlap but semantic ambiguity.
  - Automatic merge is **rejected**.
  - A **new** recurrence group is created.
  - `review_status` is flagged as `PENDING_SEMANTIC_ADJUDICATION` or `MANUAL_REVIEW_REQUIRED`.

### Scenario D: Hard Negative Flag (False Merge Prevention)
- **Input Finding:** `"جهاز الصدمات الكهربائية DC يعمل بكفاءة ولكن لم يتم تفريغ الشحنة"`
- **Target Counterpart:** `"بطارية جهاز الصدمات الكهربية معطلة"`
- **Expected Outcome:**
  - Engine detects same entity (DC Shock Device) but contradictory defect (not discharging vs. broken battery).
  - Hard negative flag is triggered.
  - Automatic merge is **rejected**.
  - A **new** independent recurrence group is created.

---

## 2. Verification Checklist (Post-Submission Audit)

For every finding processed in the test report, verify the following database invariants in `report_findings`:

1. **`original_text` Preservation:** Must perfectly match the raw input string exactly as typed by the inspector.
2. **Key Separation:** 
   - `canonical_finding_id` is populated (via Layer 3 Broad Canonical Matcher) but is **not** used to group recurrences.
   - `recurrence_group_id` is populated and serves as the sole identifier for recurrence linking.
3. **Hospital Partitioning:** 
   - Repeat counts and cross-hospital metrics correctly differentiate based on `hospital_id`.
4. **Metadata Tracking:**
   - `matching_policy_version` = `v4`
   - `review_status` is explicitly defined.
   - `match_reason` contains the engine's justification for the decision.
5. **Analytics Integrity:** 
   - `repeat_count` accurately increments for Scenario A.

---

## 3. Recommended Execution Strategy (Safe E2E Real Test)

Since writing to Production is required for a true E2E API test, use the following **Sandboxed Deletion Strategy** to avoid corrupting analytics:

1. **Create an Isolated Test Hospital:**
   - Pre-insert a dummy hospital: `name = "مستشفى الاختبارات المعزول (E2E-DO-NOT-USE)"`.
2. **Submit Test Payload:**
   - POST to `/api/save-report` simulating a Directorate Admin uploading a report containing the 4 test scenarios to the dummy hospital.
3. **Execute Read-Only Validation:**
   - Query `report_findings` where `hospital_id` = [Dummy Hospital ID].
   - Validate against the 4 Scenarios and Checklist above.
4. **Hard Cleanup (Housekeeping):**
   - Delete `report_findings` belonging to the dummy report.
   - Delete the `reports` row.
   - Delete any newly created `recurrence_groups` that became orphans due to this test.
   - Delete the dummy `hospitals` row.

**Warning:** Do not run this on Production until the explicit Housekeeping rollback script is ready to execute immediately after the assertions pass/fail.
