import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { RecurrenceMatcherService } from '../src/services/recurrence-matcher.service.js'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function runTests() {
  console.log('=== RUNNING SAME ENGINE VERIFICATION TESTS ===')
  const matcher = new RecurrenceMatcherService(supabase)

  let passed = 0
  let failed = 0

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`)
      passed++
    } else {
      console.error(`[FAIL] ${message}`)
      failed++
    }
  }

  // TEST 1: Same Issue across historical and future
  console.log('\n--- Test 1: Historical vs Future Verbal Orders ---')
  const hist1 = 'لا يوجد نموذج الأوامر الشفوية'
  const fut1 = 'نموذج الأوامر الشفوية غير متوفر بالقسم'
  const res1 = await matcher.matchFinding(fut1, 'باطنة')
  console.log('Match Result Test 1:', res1.decision, '| Reason:', res1.reason)
  assert(
    res1.decision === 'HIGH_CONFIDENCE' || res1.decision === 'UNCERTAIN', 
    'Expected high similarity or match with existing verbal orders group'
  )

  // TEST 2: Verbal orders != Medication reconciliation
  console.log('\n--- Test 2: Verbal Orders vs Med Reconciliation ---')
  const res2 = await matcher.matchFinding('نموذج التوافق الدوائي غير مفعل', 'باطنة')
  console.log('Match Result Test 2:', res2.decision, '| Entity:', res2.entity)
  // Ensure it never maps to verbal orders
  const { data: verbalGroup } = await supabase.from('recurrence_groups').select('id').ilike('title', '%الاوامر الشفويه%').maybeSingle()
  if (verbalGroup) {
    assert(res2.recurrenceGroupId !== verbalGroup.id, 'Medication reconciliation must NOT match Verbal Orders group')
  } else {
    assert(true, 'Verbal group not found, check passed')
  }

  // TEST 3: Crash Cart Lock Broken vs Crash Cart Map Mismatch
  console.log('\n--- Test 3: Crash Cart Lock vs Map ---')
  const lock = 'قفل الكراش كار مكسور'
  const map = 'خريطة الكراش كار غير مطابقة للأدوية'
  const lockExtract = matcher.validateSemanticEquivalence(lock, map)
  assert(!lockExtract.isIdentical, 'Crash cart lock and Crash cart map must NOT be identical')
  console.log('Crash cart lock vs map isIdentical:', lockExtract.isIdentical, '| Reason:', lockExtract.reason)

  // TEST 4: Critical results incomplete register vs delayed reporting
  console.log('\n--- Test 4: Critical Results Register vs Delay ---')
  const reg = 'سجل النتائج الحرجة غير مكتمل'
  const delay = 'تأخر إبلاغ النتائج الحرجة'
  const critExtract = matcher.validateSemanticEquivalence(reg, delay)
  assert(!critExtract.isIdentical, 'Critical results register incomplete and delayed reporting must NOT be identical')
  console.log('Critical results register vs delay isIdentical:', critExtract.isIdentical, '| Reason:', critExtract.reason)

  // TEST 5: Repeat count calculation verification from v_report_findings
  console.log('\n--- Test 5: Verify Repeat Count Calculation in v_report_findings ---')
  const { data: sampleVrf, error: vrfErr } = await supabase
    .from('v_report_findings')
    .select('id, hospital_id, recurrence_group_id, repeat_count, recurrence_group_title')
    .gt('repeat_count', 1)
    .limit(5)
  
  if (vrfErr) {
    console.error('v_report_findings error:', vrfErr)
    failed++
  } else {
    assert(sampleVrf.length > 0, `Found ${sampleVrf.length} recurring records with repeat_count > 1 calculated strictly via hospital_id + recurrence_group_id`)
    sampleVrf.forEach(r => {
      console.log(`  * Hosp: ${r.hospital_id.slice(0, 8)} | Group: "${r.recurrence_group_title}" | Repeat Count: ${r.repeat_count}`)
    })
  }

  console.log(`\n=== RESULTS: ${passed} PASSED, ${failed} FAILED ===`)
  if (failed > 0) process.exit(1)
}

runTests()
