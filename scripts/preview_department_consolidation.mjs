import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createServiceClient } from '../src/lib/supabase.js'

export function getCanonicalDepartment(name) {
  if (!name) return 'عام'
  let clean = name.trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\(\)\/\-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // 1. تذاكر / استقبال
  if (clean.includes('تذاكر العيادات') || clean.includes('تذكره العيادات') || clean.includes('تذكره عيادات')) {
    return 'تذاكر العيادات'
  }
  if (clean.includes('تذكره الاستقبال') || clean.includes('تذاكر الاستقبال')) {
    return 'تذاكر الاستقبال'
  }

  // 2. الصيدلية ومشتقاتها (صيدلية الطوارئ، الاستقبال، النفقة، المجاني، الاقتصادي، الداخلي)
  if ((clean.includes('صيدل') || clean.includes('صيدليه')) && !clean.includes('عنايه') && !clean.includes('دم')) {
    return 'الصيدلية'
  }

  // 3. الجراحة العامة
  if (clean.includes('جراح') && !clean.includes('اطفال') && !clean.includes('جهاز هضمي') && !clean.includes('تدخلات') && !clean.includes('نسا') && !clean.includes('نساء') && !clean.includes('عمليات')) {
    return 'قسم الجراحة'
  }

  // 4. الباطنة (قسم الباطنة، قسم الباطنه)
  if (clean.includes('باطن') && !clean.includes('رعاي')) {
    return 'قسم الباطنة'
  }

  // 5. الطوارئ والاستقبال
  if (['طوارئ', 'الطوارئ', 'طواريء', 'الطواريء', 'طوارىء', 'الاستقبال', 'الاستقبال والطوارئ', 'قسم الطوارئ', 'قسم الاستقبال'].includes(clean)) {
    return 'الطوارئ والاستقبال'
  }

  // 6. العناية المركزة (العناية المركزة، قسم العناية ب، الرعاية المركزة)
  if ((clean.includes('عناي') || clean.includes('رعاي')) && !clean.includes('اطفال') && !clean.includes('قلب') && !clean.includes('قسطره') && !clean.includes('مخ') && !clean.includes('هضمي') && !clean.includes('متوسطه') && (clean.includes('مركزه') || clean.includes('عنايه ب') || clean === 'العنايه' || clean === 'عنايه' || clean === 'قسم الرعايه المركزه')) {
    return 'العناية المركزة'
  }

  // 7. المعمل والتحاليل
  if (clean.includes('معمل') || clean.includes('مختبر')) {
    return 'المعمل'
  }

  // 8. الأشعة والسونار
  if (clean.includes('اشع') || clean === 'السونار' || clean === 'غرفه الاشعه' || clean === 'قسم الاشعه') {
    return 'الأشعة'
  }

  // 9. التعقيم
  if (clean.includes('تعقيم')) {
    return 'التعقيم'
  }

  // 10. العمليات
  if (clean.includes('عمليات')) {
    return 'العمليات'
  }

  // 11. الحضانات
  if (clean.includes('حضان') && !clean.includes('داخلي')) {
    return 'الحضانات'
  }
  if (clean === 'قسم الاطفال' || clean === 'عنايه الاطفال' || clean === 'اطفال') {
    return 'قسم الأطفال'
  }

  // 12. الكلى والغسيل الكلوي
  if (clean.includes('كلي') || clean.includes('كلى') || clean.includes('غسيل كلوي')) {
    return 'وحدة الغسيل الكلوي'
  }

  // 13. الأسنان
  if (clean.includes('اسنان')) {
    return 'عيادة الأسنان'
  }

  // 14. تنظيم الأسرة
  if (clean.includes('تنظيم الاسر')) {
    return 'تنظيم الأسرة'
  }

  // 15. الإدارة وشؤون المستشفى
  if (clean === 'اداره' || clean === 'الاداره' || clean === 'اداره المستشفي' || clean === 'اداره المستشفى' || clean.includes('الشؤون الاداريه')) {
    return 'إدارة المستشفى'
  }

  // 16. عموم المستشفى / عام
  if (clean === 'عام' || clean === 'عموم المستشفي' || clean === 'عموم المستشفى' || clean === 'القسم') {
    return 'عموم المستشفى'
  }

  // 17. السلامة والصحة المهنية
  if (clean.includes('سلامه وصحه مهنيه') || clean.includes('صحه وسلامه') || clean.includes('فريق الصحه والسلامه')) {
    return 'السلامة والصحة المهنية'
  }

  // 18. المغسلة
  if (clean.includes('مغسل')) {
    return 'المغسلة'
  }

  // 19. المطبخ
  if (clean.includes('مطبخ')) {
    return 'المطبخ'
  }

  // 20. القسم الداخلي
  if (clean.includes('داخلي') && !clean.includes('احاله')) {
    return 'القسم الداخلي'
  }

  // 21. السكتة الدماغية
  if (clean.includes('سكته دماغيه')) {
    return 'وحدة السكتة الدماغية'
  }

  // 22. الجهاز الهضمي
  if (clean.includes('جهاز هضمي')) {
    return 'الجهاز الهضمي'
  }

  // 23. الأرشيف وحفظ الملفات
  if (clean.includes('ارشيف') || clean.includes('حفظ ملفات')) {
    return 'الأرشيف وحفظ الملفات'
  }

  // Default: original name cleaned
  return name.trim()
}

async function run() {
  const supabase = createServiceClient()

  const { data: hospitals } = await supabase.from('hospitals').select('id, name')
  const { data: depts } = await supabase.from('departments').select('id, name, hospital_id')
  
  let allFindings = []
  let from = 0
  const limit = 1000
  while (true) {
    const { data, error } = await supabase.from('report_findings').select('id, department_id, hospital_id').range(from, from + limit - 1)
    if (error || !data || data.length === 0) break
    allFindings = allFindings.concat(data)
    if (data.length < limit) break
    from += limit
  }

  const findingCounts = {}
  allFindings.forEach(f => {
    findingCounts[f.department_id] = (findingCounts[f.department_id] || 0) + 1
  })

  let totalMerges = 0
  let affectedFindingsCount = 0

  for (const h of hospitals) {
    const hospDepts = depts.filter(d => d.hospital_id === h.id)
    const canonicalGroups = new Map()

    for (const d of hospDepts) {
      const c = findingCounts[d.id] || 0
      const canonName = getCanonicalDepartment(d.name)
      if (!canonicalGroups.has(canonName)) {
        canonicalGroups.set(canonName, [])
      }
      canonicalGroups.get(canonName).push({ id: d.id, name: d.name, count: c })
    }

    const mergesInHospital = []
    canonicalGroups.forEach((deptList, canonName) => {
      if (deptList.length > 1) {
        const totalCount = deptList.reduce((sum, item) => sum + item.count, 0)
        mergesInHospital.push({ canonName, deptList, totalCount })
      }
    })

    if (mergesInHospital.length > 0) {
      console.log(`\n🏥 ${h.name}:`)
      for (const m of mergesInHospital) {
        totalMerges += (m.deptList.length - 1)
        affectedFindingsCount += m.totalCount
        console.log(`  🔗 دمج في [${m.canonName}] (إجمالي ${m.totalCount} سلبية):`)
        m.deptList.forEach(d => {
          console.log(`     - "${d.name}" (${d.count} سلبية)`)
        })
      }
    }
  }

  console.log(`\n✨ Total duplicate department merges: ${totalMerges}`)
  console.log(`✨ Total findings to be organized: ${affectedFindingsCount}`)
}

run().catch(console.error)
