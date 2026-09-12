import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function testRegression() {
  console.log('=== RUNNING REGRESSION TESTS ===')

  // Test Case 1: False Negative (Reversed words)
  // We expect them to have the SAME recurrence_group_id
  const texts = [
    'عدم وجود قائمه بالاختصارات المسموحه والممنوعه بالقسم',
    'قائمه بالاختصارات الممنوعه والمسموحه بالقسم غير متوفره'
  ]

  const ids = []
  for (const t of texts) {
    const { data } = await supabase
      .from('report_findings')
      .select('recurrence_group_id, original_text')
      .ilike('original_text', '%' + t.substring(5, 30) + '%')
      .limit(1)
    
    if (data && data.length > 0) {
      ids.push({ text: data[0].original_text, groupId: data[0].recurrence_group_id })
    }
  }

  console.log('--- Test Case 1: Word Reversal (False Negative fix) ---')
  if (ids.length >= 2) {
    console.log(ids[0])
    console.log(ids[1])
    if (ids[0].groupId === ids[1].groupId && ids[0].groupId !== null) {
      console.log('✅ PASSED: Both have the same recurrence group ID')
    } else {
      console.log('❌ FAILED: Different recurrence group IDs')
    }
  } else {
    console.log('⚠️ Could not find both texts in the DB to compare.')
  }

  // Test Case 2: False Positive (Incomplete vs Missing)
  // 'غير مكتمل' vs 'لا يوجد'
  console.log('\n--- Test Case 2: Incomplete vs Missing (False Positive fix) ---')
  const fpTexts = [
    'محتويات طقم الانسكاب الكيميائي غير مكتمل',
    'لا يوجد طقم الانسكاب الكيميائي بالقسم'
  ]

  const fpIds = []
  for (const t of fpTexts) {
    const { data } = await supabase
      .from('report_findings')
      .select('recurrence_group_id, original_text')
      .ilike('original_text', '%' + t.substring(5, 30) + '%')
      .limit(1)
    
    if (data && data.length > 0) {
      fpIds.push({ text: data[0].original_text, groupId: data[0].recurrence_group_id })
    }
  }

  if (fpIds.length >= 2) {
    console.log(fpIds[0])
    console.log(fpIds[1])
    if (fpIds[0].groupId !== fpIds[1].groupId) {
      console.log('✅ PASSED: They have DIFFERENT recurrence group IDs (Hard Negative applied)')
    } else {
      console.log('❌ FAILED: They incorrectly grouped together')
    }
  } else {
    console.log('⚠️ Could not find both texts in the DB to compare.')
  }

  process.exit(0)
}

testRegression()
