import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { RecurrenceMatcherService, getCoreTokens, normalizeRecurrenceKey } from '../src/services/recurrence-matcher.service.js'
import { extractSemanticIssueSignature } from '../src/lib/ai-parser.js'

dotenv.config({ path: '.env.local' })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// Mocked search logic for testing isolation.
const testMatcher = new RecurrenceMatcherService(supabase, { useVector: false })

const TESTS = [
  // --- Paraphrase True Positives ---
  {
    id: 'A',
    type: 'TP',
    input: 'لا يوجد نموذج الأوامر الشفوية',
    existingCandidate: 'نموذج الأوامر الشفوية غير متوفر بالقسم',
    expected: 'HIGH_CONFIDENCE'
  },
  {
    id: 'B',
    type: 'TP',
    input: 'عدم وجود كراش كار',
    existingCandidate: 'عربة الإنعاش (الكراش كار) غير موجودة',
    expected: 'HIGH_CONFIDENCE'
  },
  {
    id: 'C',
    type: 'TP',
    input: 'تسجيل الدخول غير محدث',
    existingCandidate: 'لم يتم تحديث سجل الدخول',
    expected: 'HIGH_CONFIDENCE'
  },
  {
    id: 'D',
    type: 'TP',
    input: 'جهاز المونيتور معطل',
    existingCandidate: 'شاشة المراقبة لا تعمل',
    expected: 'HIGH_CONFIDENCE'
  },
  {
    id: 'E',
    type: 'TP',
    input: 'الموظف لا يرتدي البطاقة',
    existingCandidate: 'عدم لبس البطاقة التعريفية',
    expected: 'HIGH_CONFIDENCE'
  },
  
  // --- Hard Negatives (Contradictions) ---
  {
    id: 'F',
    type: 'TN',
    input: 'نموذج التسليم غير متوفر',
    existingCandidate: 'نموذج التسليم غير مكتمل',
    expected: 'DISTINCT' // missing vs incomplete
  },
  {
    id: 'G',
    type: 'TN',
    input: 'جهاز التخطيط غير متوفر',
    existingCandidate: 'جهاز التخطيط معطل',
    expected: 'DISTINCT' // missing vs damaged
  },
  {
    id: 'H',
    type: 'TN',
    input: 'الجهاز تالف',
    existingCandidate: 'الجهاز غير نظيف',
    expected: 'DISTINCT' // damaged vs dirty
  },
  {
    id: 'I',
    type: 'TN',
    input: 'السياسة غير معتمدة',
    existingCandidate: 'السياسة غير محدثة',
    expected: 'DISTINCT' // unapproved vs outdated
  },
  {
    id: 'J',
    type: 'TN',
    input: 'الأدوية منتهية الصلاحية',
    existingCandidate: 'الأدوية غير متوفرة',
    expected: 'DISTINCT' // expired vs missing
  },
  {
    id: 'K',
    type: 'TN',
    input: 'التوثيق الطبي متأخر',
    existingCandidate: 'التوثيق الطبي غير موجود',
    expected: 'DISTINCT' // delayed vs missing
  },
  {
    id: 'L',
    type: 'TN',
    input: 'نقص في كمية الأدوية',
    existingCandidate: 'الدواء غير متوفر',
    expected: 'DISTINCT' // incomplete vs missing
  },
  
  // --- Different Entity, Same Defect ---
  {
    id: 'M',
    type: 'TN',
    input: 'نموذج الإقرار غير متوفر',
    existingCandidate: 'سجل الحرارة غير متوفر',
    expected: 'DISTINCT' 
  },
  
  // --- Same Entity, Different Requirement ---
  {
    id: 'N',
    type: 'TN',
    input: 'عدم الالتزام بسياسة نظافة اليدين',
    existingCandidate: 'عدم الالتزام بسياسة التخلص من النفايات',
    expected: 'DISTINCT'
  },
  
  // More edge cases to reach 26 total
  { id: 'O', type: 'TP', input: 'ملف المريض غير مرتب', existingCandidate: 'عدم ترتيب ملفات المرضى', expected: 'HIGH_CONFIDENCE' },
  { id: 'P', type: 'TN', input: 'ثلاجة الدم معطلة', existingCandidate: 'ثلاجة الأدوية معطلة', expected: 'DISTINCT' },
  { id: 'Q', type: 'TP', input: 'عدم صيانة جهاز الصدمات', existingCandidate: 'جهاز الصدمات الكهربائية بحاجة لصيانة', expected: 'HIGH_CONFIDENCE' },
  { id: 'R', type: 'TN', input: 'السرير غير نظيف', existingCandidate: 'السرير مكسور', expected: 'DISTINCT' },
  { id: 'S', type: 'TP', input: 'نقص مستلزمات العزل', existingCandidate: 'مستلزمات العزل غير مكتملة', expected: 'HIGH_CONFIDENCE' },
  { id: 'T', type: 'TN', input: 'السياسة لم تفعل', existingCandidate: 'السياسة لم تكتب', expected: 'DISTINCT' },
  { id: 'U', type: 'TP', input: 'دواليب التخزين غير مطابقة', existingCandidate: 'تخزين غير مطابق للمعايير في الدواليب', expected: 'HIGH_CONFIDENCE' },
  { id: 'V', type: 'TN', input: 'وجود أدوية عالية الخطورة', existingCandidate: 'أدوية عالية الخطورة غير مميزة', expected: 'DISTINCT' },
  { id: 'W', type: 'TP', input: 'لا يوجد خطة إخلاء', existingCandidate: 'خطة الإخلاء في حالة الطوارئ غير موجودة', expected: 'HIGH_CONFIDENCE' },
  { id: 'X', type: 'TN', input: 'عدم توفر معقم لليدين', existingCandidate: 'معقم اليدين منتهي الصلاحية', expected: 'DISTINCT' },
  { id: 'Y', type: 'TP', input: 'سجل العهدة غير مفعل', existingCandidate: 'عدم تفعيل سجل العهدة', expected: 'HIGH_CONFIDENCE' },
  { id: 'Z', type: 'TN', input: 'تسرب مياه من السقف', existingCandidate: 'تسرب مياه من المغسلة', expected: 'DISTINCT' }
]

// Perfect AI Extractor Mock for 26 Test Cases
function mockAISignature(text) {
  const map = {
    'لا يوجد نموذج الأوامر الشفوية': { entity: 'نموذج الأوامر الشفوية', defect: 'غير متوفر', polarity: 'missing', requirement: 'الالتزام' },
    'نموذج الأوامر الشفوية غير متوفر بالقسم': { entity: 'نموذج الأوامر الشفوية', defect: 'غير متوفر', polarity: 'missing', requirement: 'الالتزام' },
    'عدم وجود كراش كار': { entity: 'عربة الإنعاش (كراش كار)', defect: 'غير موجودة', polarity: 'missing', requirement: 'الالتزام' },
    'عربة الإنعاش (الكراش كار) غير موجودة': { entity: 'عربة الإنعاش (كراش كار)', defect: 'غير موجودة', polarity: 'missing', requirement: 'الالتزام' },
    'تسجيل الدخول غير محدث': { entity: 'سجل الدخول', defect: 'غير محدث', polarity: 'incorrect', requirement: 'الالتزام' },
    'لم يتم تحديث سجل الدخول': { entity: 'سجل الدخول', defect: 'غير محدث', polarity: 'incorrect', requirement: 'الالتزام' },
    'جهاز المونيتور معطل': { entity: 'جهاز المراقبة (المونيتور)', defect: 'معطل', polarity: 'damaged', requirement: 'الالتزام' },
    'شاشة المراقبة لا تعمل': { entity: 'جهاز المراقبة (المونيتور)', defect: 'لا تعمل', polarity: 'damaged', requirement: 'الالتزام' },
    'الموظف لا يرتدي البطاقة': { entity: 'البطاقة التعريفية', defect: 'لا يرتديها', polarity: 'other', requirement: 'الالتزام' },
    'عدم لبس البطاقة التعريفية': { entity: 'البطاقة التعريفية', defect: 'عدم اللبس', polarity: 'other', requirement: 'الالتزام' },
    'نموذج التسليم غير متوفر': { entity: 'نموذج التسليم', defect: 'غير متوفر', polarity: 'missing', requirement: 'الالتزام' },
    'نموذج التسليم غير مكتمل': { entity: 'نموذج التسليم', defect: 'غير مكتمل', polarity: 'incomplete', requirement: 'الالتزام' },
    'جهاز التخطيط غير متوفر': { entity: 'جهاز التخطيط', defect: 'غير متوفر', polarity: 'missing', requirement: 'الالتزام' },
    'جهاز التخطيط معطل': { entity: 'جهاز التخطيط', defect: 'معطل', polarity: 'damaged', requirement: 'الالتزام' },
    'الجهاز تالف': { entity: 'جهاز طبي', defect: 'تالف', polarity: 'damaged', requirement: 'الالتزام' },
    'الجهاز غير نظيف': { entity: 'جهاز طبي', defect: 'غير نظيف', polarity: 'incorrect', requirement: 'الالتزام' },
    'السياسة غير معتمدة': { entity: 'سياسة القسم', defect: 'غير معتمدة', polarity: 'unapproved', requirement: 'الالتزام' },
    'السياسة غير محدثة': { entity: 'سياسة القسم', defect: 'غير محدثة', polarity: 'incorrect', requirement: 'الالتزام' },
    'الأدوية منتهية الصلاحية': { entity: 'الأدوية', defect: 'منتهية الصلاحية', polarity: 'expired', requirement: 'الالتزام' },
    'الأدوية غير متوفرة': { entity: 'الأدوية', defect: 'غير متوفرة', polarity: 'missing', requirement: 'الالتزام' },
    'التوثيق الطبي متأخر': { entity: 'التوثيق الطبي', defect: 'متأخر', polarity: 'delayed', requirement: 'الالتزام' },
    'التوثيق الطبي غير موجود': { entity: 'التوثيق الطبي', defect: 'غير موجود', polarity: 'missing', requirement: 'الالتزام' },
    'نقص في كمية الأدوية': { entity: 'الأدوية', defect: 'نقص', polarity: 'incomplete', requirement: 'الالتزام' },
    'الدواء غير متوفر': { entity: 'الأدوية', defect: 'غير متوفر', polarity: 'missing', requirement: 'الالتزام' },
    'نموذج الإقرار غير متوفر': { entity: 'نموذج الإقرار', defect: 'غير متوفر', polarity: 'missing', requirement: 'الالتزام' },
    'سجل الحرارة غير متوفر': { entity: 'سجل الحرارة', defect: 'غير متوفر', polarity: 'missing', requirement: 'الالتزام' },
    'عدم الالتزام بسياسة نظافة اليدين': { entity: 'سياسة نظافة اليدين', defect: 'عدم الالتزام', polarity: 'other', requirement: 'الالتزام' },
    'عدم الالتزام بسياسة التخلص من النفايات': { entity: 'سياسة التخلص من النفايات', defect: 'عدم الالتزام', polarity: 'other', requirement: 'الالتزام' },
    'ملف المريض غير مرتب': { entity: 'ملف المريض', defect: 'غير مرتب', polarity: 'incomplete', requirement: 'الالتزام' },
    'عدم ترتيب ملفات المرضى': { entity: 'ملف المريض', defect: 'عدم ترتيب', polarity: 'incomplete', requirement: 'الالتزام' },
    'ثلاجة الدم معطلة': { entity: 'ثلاجة الدم', defect: 'معطلة', polarity: 'damaged', requirement: 'الالتزام' },
    'ثلاجة الأدوية معطلة': { entity: 'ثلاجة الأدوية', defect: 'معطلة', polarity: 'damaged', requirement: 'الالتزام' },
    'عدم صيانة جهاز الصدمات': { entity: 'جهاز الصدمات', defect: 'عدم صيانة', polarity: 'other', requirement: 'صيانة دورية' },
    'جهاز الصدمات الكهربائية بحاجة لصيانة': { entity: 'جهاز الصدمات', defect: 'بحاجة لصيانة', polarity: 'other', requirement: 'صيانة دورية' },
    'السرير غير نظيف': { entity: 'السرير', defect: 'غير نظيف', polarity: 'incorrect', requirement: 'الالتزام' },
    'السرير مكسور': { entity: 'السرير', defect: 'مكسور', polarity: 'damaged', requirement: 'الالتزام' },
    'نقص مستلزمات العزل': { entity: 'مستلزمات العزل', defect: 'نقص', polarity: 'incomplete', requirement: 'الالتزام' },
    'مستلزمات العزل غير مكتملة': { entity: 'مستلزمات العزل', defect: 'غير مكتملة', polarity: 'incomplete', requirement: 'الالتزام' },
    'السياسة لم تفعل': { entity: 'السياسة', defect: 'لم تفعل', polarity: 'inactive', requirement: 'الالتزام' },
    'السياسة لم تكتب': { entity: 'السياسة', defect: 'لم تكتب', polarity: 'missing', requirement: 'الالتزام' },
    'دواليب التخزين غير مطابقة': { entity: 'دواليب التخزين', defect: 'غير مطابقة', polarity: 'incorrect', requirement: 'الالتزام' },
    'تخزين غير مطابق للمعايير في الدواليب': { entity: 'دواليب التخزين', defect: 'غير مطابق', polarity: 'incorrect', requirement: 'الالتزام' },
    'وجود أدوية عالية الخطورة': { entity: 'أدوية عالية الخطورة', defect: 'موجودة بدون قفل', polarity: 'incorrect', requirement: 'الالتزام' },
    'أدوية عالية الخطورة غير مميزة': { entity: 'أدوية عالية الخطورة', defect: 'غير مميزة', polarity: 'unlabeled', requirement: 'الالتزام' },
    'لا يوجد خطة إخلاء': { entity: 'خطة إخلاء', defect: 'لا يوجد', polarity: 'missing', requirement: 'الالتزام' },
    'خطة الإخلاء في حالة الطوارئ غير موجودة': { entity: 'خطة إخلاء', defect: 'غير موجودة', polarity: 'missing', requirement: 'الالتزام' },
    'عدم توفر معقم لليدين': { entity: 'معقم يدين', defect: 'عدم توفر', polarity: 'missing', requirement: 'الالتزام' },
    'معقم اليدين منتهي الصلاحية': { entity: 'معقم يدين', defect: 'منتهي الصلاحية', polarity: 'expired', requirement: 'الالتزام' },
    'سجل العهدة غير مفعل': { entity: 'سجل العهدة', defect: 'غير مفعل', polarity: 'inactive', requirement: 'الالتزام' },
    'عدم تفعيل سجل العهدة': { entity: 'سجل العهدة', defect: 'عدم تفعيل', polarity: 'inactive', requirement: 'الالتزام' },
    'تسرب مياه من السقف': { entity: 'السقف', defect: 'تسرب مياه', polarity: 'damaged', requirement: 'الالتزام' },
    'تسرب مياه من المغسلة': { entity: 'المغسلة', defect: 'تسرب مياه', polarity: 'damaged', requirement: 'الالتزام' }
  }
  return map[text] || null
}

async function runTests() {
  console.log('=== 26-CASE SEMANTIC ENGINE TEST SUITE ===\n')

  let tp = 0, tn = 0, fp = 0, fn = 0

  for (const test of TESTS) {
    const sigA = await extractSemanticIssueSignature(test.input)
    const sigB = await extractSemanticIssueSignature(test.existingCandidate)
    
    const candidateMock = {
      title: test.existingCandidate,
      normalized_key: test.existingCandidate,
      semantic_signature: sigB
    }

    const result = await testMatcher.evaluateSemanticEquivalence(sigA, candidateMock, test.input, test.existingCandidate)

    let isPass = false
    let decision = result?.decision || 'UNCERTAIN'
    // If it's SAME_ISSUE, translate it to HIGH_CONFIDENCE to match test expectations
    if (decision === 'SAME_ISSUE') decision = 'HIGH_CONFIDENCE'
    if (decision === 'DIFFERENT_ISSUE') decision = 'DISTINCT'

    if (decision === test.expected) {
      isPass = true
      if (test.type === 'TP') tp++
      if (test.type === 'TN') tn++
    } else {
      if (test.type === 'TP') fn++ // False Negative (should have matched but didn't)
      if (test.type === 'TN') fp++ // False Positive (should NOT have matched but did)
    }

    console.log(`[TEST ${test.id}] - ${test.type}`)
    console.log(`Input:    ${test.input}`)
    console.log(`Existing: ${test.existingCandidate}`)
    console.log(`Expected: ${test.expected} | Actual: ${decision}`)
    console.log(`Status:   ${isPass ? '✅ PASS' : '❌ FAIL'}`)
    const reasonLog = result?.reasonLog || result?.reason || 'No reason provided'
    console.log(`Reason:   ${reasonLog}`)
    console.log('----------------------------------------------------')
    
    // Add delay to respect free tier quotas (15 RPM -> 4s)
    await new Promise(r => setTimeout(r, 4000))
  }

  const total = tp + tn + fp + fn
  const accuracy = ((tp + tn) / total * 100).toFixed(2)
  const precision = tp + fp === 0 ? 0 : (tp / (tp + fp) * 100).toFixed(2)
  const recall = tp + fn === 0 ? 0 : (tp / (tp + fn) * 100).toFixed(2)
  const f1 = precision + recall === 0 ? 0 : (2 * (precision * recall) / (parseFloat(precision) + parseFloat(recall))).toFixed(2)

  console.log('\n=== FINAL METRICS ===')
  console.log(`Total:     ${total}`)
  console.log(`TP:        ${tp}`)
  console.log(`TN:        ${tn}`)
  console.log(`FP:        ${fp} (False Merges - HIGH RISK)`)
  console.log(`FN:        ${fn} (Missed Merges)`)
  console.log(`Accuracy:  ${accuracy}%`)
  console.log(`Precision: ${precision}%`)
  console.log(`Recall:    ${recall}%`)
  console.log(`F1 Score:  ${f1}%`)
}

runTests().catch(console.error)
