import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createServiceClient } from '../src/lib/supabase.js'

async function run() {
  const sb = createServiceClient()

  const pseudoNames = [
    'الطبيب', 'التمريض', 'البيئة', 'الطبيب المسؤل', 'التمريض المسؤل',
    'الفريق الطبي', 'الهيئة الطبية', 'سلامة المرضى', 'مسؤل سلامه المرضي',
    'تعريف هوية المرضى', 'مسئول الاحالة', 'مسؤل الاجهزة الطبية',
    'مسؤل الصيلنه', 'الطبيعة', 'الفرز', 'BASEMENT', 'control room',
    'طلمبات المياه', 'المستلزمات', 'المستلزمات الطبية'
  ]

  const { data: hospitals } = await sb.from('hospitals').select('id, name')
  const { data: allDepts } = await sb.from('departments').select('id, name, hospital_id')

  function findBestDept(hospDepts, text) {
    const clean = text.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')

    const has = (name) => hospDepts.find(d => d.name === name)
    const hasIncludes = (sub) => hospDepts.find(d => d.name.includes(sub))

    // 1. سونار / أشعة
    if (clean.includes('سونار') || clean.includes('اشع')) {
      const match = has('الأشعة') || hasIncludes('اشع')
      if (match) return match
    }

    // 2. تنظيم الأسرة
    if (clean.includes('تنظيم الاسر') || clean.includes('تركيب / ازاله الوسائل') || clean.includes('وسائل الخاصه بتنظيم')) {
      const match = has('تنظيم الأسرة')
      if (match) return match
    }

    // 3. جراحة / تداخلي
    if (clean.includes('جراح') || clean.includes('تداخلي') || clean.includes('عمليات')) {
      const match = has('قسم الجراحة') || has('العمليات') || hasIncludes('جراح')
      if (match) return match
    }

    // 4. طوارئ / استقبال / فرز
    if (clean.includes('طوارئ') || clean.includes('طواري') || clean.includes('استقبال') || clean.includes('فرز')) {
      const match = has('الطوارئ والاستقبال') || has('تذاكر الاستقبال') || hasIncludes('طوار') || hasIncludes('استقبال')
      if (match) return match
    }

    // 5. صيدلية / أدوية / ملائمة دوائية / مواد كيميائية / دولاب مستلزمات
    if (clean.includes('صيدل') || clean.includes('دواء') || clean.includes('ادوي') || clean.includes('دوائي') || clean.includes('روشت') || clean.includes('وصفه طبي') || clean.includes('تشغيل') || clean.includes('تربو ادوي') || clean.includes('متشابهه في الشكل') || clean.includes('الماسه') || clean.includes('دولاب المستلزمات') || clean.includes('مواد كيميائي')) {
      const match = has('الصيدلية') || has('مخزن المستلزمات') || hasIncludes('صيدل')
      if (match) return match
    }

    // 6. معمل / تحاليل / نتائج حرجة / انذارات حرجة
    if (clean.includes('معمل') || clean.includes('مختبر') || clean.includes('نتائج حرج') || clean.includes('انذارات حرج')) {
      const match = has('المعمل') || hasIncludes('معمل')
      if (match) return match
    }

    // 7. تعقيم / اوتوكلاف
    if (clean.includes('تعقيم') || clean.includes('اوتوكلاف') || clean.includes('ادوات معقم')) {
      const match = has('التعقيم') || hasIncludes('تعقيم')
      if (match) return match
    }

    // 8. مطبخ / ثلاجات وفريزرات المطبخ
    if (clean.includes('مطبخ')) {
      const match = has('المطبخ') || hasIncludes('مطبخ')
      if (match) return match
    }

    // 9. صيانة / كهرباء / طلمبات / سولار / حساسات / انذار حريق
    if (clean.includes('كهرباء') || clean.includes('مفاتيح الكهرباء') || clean.includes('طلمب') || clean.includes('سولار') || clean.includes('حساسات') || clean.includes('كروت صيانه') || clean.includes('شركه الصيان') || clean.includes('اعطال') || clean.includes('detector')) {
      const match = has('الصيانة') || has('خدمات عامة ومرافق المستشفى') || has('السلامة والصحة المهنية') || has('إدارة المستشفى')
      if (match) return match
    }

    // 10. سلامة وصحة مهنية / بيئة / طفايات / انسكابات / نفايات / sds / واقيات / رطوبة وحرارة
    if (clean.includes('حرار') || clean.includes('رطوب') || clean.includes('بيئ') || clean.includes('سلام') || clean.includes('طفاي') || clean.includes('انسكاب') || clean.includes('نفاي') || clean.includes('sds') || clean.includes('واقيات') || clean.includes('كهن')) {
      const match = has('السلامة والصحة المهنية') || has('الصحة والسلامة') || has('خدمات عامة ومرافق المستشفى') || has('النفايات الخطرة') || has('إدارة المستشفى')
      if (match) return match
    }

    // 11. چراكن كلى
    if (clean.includes('كلي') || clean.includes('كلى')) {
      const match = has('وحدة الغسيل الكلوي') || hasIncludes('كلي') || hasIncludes('كلى')
      if (match) return match
    }

    // 12. تذاكر
    if (clean.includes('تذاكر') || clean.includes('تذكره')) {
      const match = has('تذاكر العيادات') || has('تذاكر الاستقبال') || has('الطوارئ والاستقبال')
      if (match) return match
    }

    // 13. إحالة / جودة / سياسات / ovr / downtime / أوامر تكليف / توصيف وظيفي
    if (clean.includes('احال') || clean.includes('ovr') || clean.includes('downtime') || clean.includes('سياسات') || clean.includes('اوامر تكليف') || clean.includes('توصيف وظيفي') || clean.includes('qr code') || clean.includes('شابتر')) {
      const match = has('إدارة المستشفى') || has('السلامة والصحة المهنية') || has('عموم المستشفى')
      if (match) return match
    }

    // 14. ملف / ملفات / إقرارات / اسم المريض رباعي / اختصارات / ملاحظات إكلينيكية
    if (clean.includes('ملف') || clean.includes('اقرار') || clean.includes('اختصار') || clean.includes('ملاحظات اكلينيكي') || clean.includes('توقيع الاطباء') || clean.includes('توقيع طبيب') || clean.includes('اسم المريض رباعي')) {
      const match = has('الملف الطبي') || has('الأرشيف') || has('عموم المستشفى')
      if (match) return match
    }

    // 15. نقل داخلي / تسليم وتسلم / vte / تقييم الم / سقوط
    if (clean.includes('نقل داخلي') || clean.includes('تسليم وتسلم') || clean.includes('vte') || clean.includes('الم') || clean.includes('سقوط')) {
      const match = has('القسم الداخلي') || has('عموم المستشفى')
      if (match) return match
    }

    // 16. مستلزمات
    if (clean.includes('مستلزم')) {
      const match = has('مخزن المستلزمات') || has('الصيدلية') || has('عموم المستشفى')
      if (match) return match
    }

    // Fallback
    return has('عموم المستشفى') || has('عام') || hospDepts[0]
  }

  for (const h of hospitals) {
    const hospDepts = allDepts.filter(d => d.hospital_id === h.id)
    const validDepts = hospDepts.filter(d => !pseudoNames.includes(d.name))
    const pseudoDepts = hospDepts.filter(d => pseudoNames.includes(d.name))

    if (pseudoDepts.length === 0) continue

    for (const pd of pseudoDepts) {
      const { data: findings } = await sb.from('report_findings').select('id, original_text').eq('department_id', pd.id)
      if (findings && findings.length > 0) {
        console.log(`\n🏥 [${h.name}] من قسم وهمي "${pd.name}" (${findings.length} سلبية):`)
        for (const f of findings) {
          const target = findBestDept(validDepts, f.original_text)
          console.log(`   ➡️ تنقل إلى [${target.name}]: "${f.original_text.replace(/\n/g, ' ')}"`)
        }
      }
    }
  }
}

run().catch(console.error)
