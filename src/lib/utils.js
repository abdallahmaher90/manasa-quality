export const getCategory = (name) => {
  if (!name) return 'أخرى'
  const n = name.toLowerCase()
  if (n.includes('صيدل')) return 'الصيدلة'
  if (n.includes('كلى') || n.includes('كلي') || n.includes('كلو')) return 'الكلى'
  if (n.includes('عناي') || n.includes('رعاي')) return 'العناية المركزة'
  if (n.includes('معمل') || n.includes('معامل') || n.includes('دم')) return 'المعامل'
  if (n.includes('اشع') || n.includes('أشع') || n.includes('إشع')) return 'الأشعة'
  if (n.includes('استقبال') || n.includes('طوار')) return 'الاستقبال والطوارئ'
  if (n.includes('عمليات') || n.includes('افاق') || n.includes('إفاق')) return 'العمليات'
  if (n.includes('حضان') || n.includes('مبتسر')) return 'الحضانات'
  if (n.includes('سلامة') || n.includes('حريق') || n.includes('دفاع مدني') || n.includes('مهني')) return 'السلامة والصحة المهنية'
  if (n.includes('عدوى') || n.includes('عدوي')) return 'مكافحة العدوى'
  if (n.includes('أجهز') || n.includes('اجهز') || n.includes('صيان') || n.includes('مرافق') || n.includes('هندس') || n.includes('غاز') || n.includes('اكسجين') || n.includes('أكسجين') || n.includes('ديزل') || n.includes('طلمب')) return 'الإدارة الهندسية والصيانة'
  if (n.includes('ملف') || n.includes('ارشيف') || n.includes('أرشيف') || n.includes('توثيق')) return 'التوثيق الطبي والملفات'
  if (n.includes('موارد بشري') || n.includes('عاملين') || n.includes('إدار') || n.includes('ادار')) return 'الشؤون الإدارية والموارد البشرية'
  if (n.includes('داخلي') || n.includes('داخلى') || n.includes('اقام') || n.includes('إقام') || n.includes('باطن') || n.includes('جراح') || n.includes('اطفال') || n.includes('أطفال') || n.includes('عظام') || n.includes('حريم')) return 'القسم الداخلي'
  if (n.includes('عياد') || n.includes('خارجي')) return 'العيادات الخارجية'
  if (n.includes('اسنان') || n.includes('أسنان')) return 'الأسنان'
  if (n.includes('مخزن') || n.includes('مخازن') || n.includes('مستلزم')) return 'المخازن'
  if (n.includes('تذاكر') || n.includes('دخول') || n.includes('تسجيل')) return 'التذاكر والدخول'
  if (n.includes('مطبخ') || n.includes('تغذي')) return 'التغذية والمطبخ'
  if (n.includes('مغسل') || n.includes('مفروش')) return 'المغسلة'
  if (n.includes('نفاي') || n.includes('محرق')) return 'النفايات الطبية'
  if (n.includes('تعقيم')) return 'التعقيم'
  if (n.includes('طبيع')) return 'العلاج الطبيعي'
  return 'عام وسلامة المرضى'
}

const ARABIC_MONTHS = {
  'يناير': '01',
  'فبراير': '02',
  'مارس': '03',
  'ابريل': '04',
  'أبريل': '04',
  'مايو': '05',
  'يونيو': '06',
  'يونيه': '06',
  'يوليو': '07',
  'يوليه': '07',
  'اغسطس': '08',
  'أغسطس': '08',
  'سبتمبر': '09',
  'اكتوبر': '10',
  'أكتوبر': '10',
  'نوفمبر': '11',
  'ديسمبر': '12',
}

/**
 * Normalizes inspection dates, especially multi-day inspections (e.g. "23 و 24 يونيو 2026"),
 * returning a single valid ISO date YYYY-MM-DD representing the conclusion of the inspection.
 */
export function sanitizeInspectionDate(input) {
  if (!input || typeof input !== 'string') {
    return new Date().toISOString().split('T')[0]
  }

  // 1. Convert Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) to Latin digits (0-9)
  let clean = input
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[\u200e\u200f]/g, '') // remove directional marks
    .trim()

  // 2. If it's already exactly YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return clean
  }

  // 3. Match any YYYY/MM/DD or YYYY-MM-DD dates (e.g. "2026-06-23 و 2026-06-24" or "2026/6/23 و 2026/6/24")
  const ymdMatches = [...clean.matchAll(/\b(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/g)]
  if (ymdMatches.length > 0) {
    const last = ymdMatches[ymdMatches.length - 1]
    const year = last[1]
    const month = last[2].padStart(2, '0')
    const day = last[3].padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  // 4. Check for Arabic month names (e.g. "23 و 24 يونيو 2026", "23-24 يونيو 2026", "24 يونيو 2026")
  for (const [mName, mNum] of Object.entries(ARABIC_MONTHS)) {
    if (clean.includes(mName)) {
      // Look for year (4 digits)
      const yearMatch = clean.match(/\b(20\d{2}|19\d{2})\b/)
      const year = yearMatch ? yearMatch[1] : new Date().getFullYear().toString()

      // Look for all day numbers before the month name
      const beforeMonth = clean.split(mName)[0]
      const dayMatches = beforeMonth.match(/\b([1-9]|[12]\d|3[01])\b/g)
      if (dayMatches && dayMatches.length > 0) {
        // Take the last day mentioned in range (e.g., in "23 و 24", 24 is the conclusion day)
        const day = parseInt(dayMatches[dayMatches.length - 1], 10)
        return `${year}-${mNum}-${String(day).padStart(2, '0')}`
      }
    }
  }

  // 5. Look for multi-day slash/dash dates (e.g., "23 و 24 / 06 / 2026" or "23-24/06/2026" or "23 / 6 / 2026 و 24 / 6 / 2026")
  const fullSlashMatches = clean.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/g)
  if (fullSlashMatches && fullSlashMatches.length > 0) {
    const lastFull = fullSlashMatches[fullSlashMatches.length - 1]
    const parts = lastFull.split(/[\/\-]/)
    const day = parts[0].padStart(2, '0')
    const month = parts[1].padStart(2, '0')
    const year = parts[2]
    return `${year}-${month}-${day}`
  }

  // Multi-day pattern like: "23 و 24 / 06 / 2026" or "23-24 / 6 / 2026" or "23, 24/6/2026"
  const multiDayPattern = /(\d{1,2})\s*(?:و|،|-|,|\s+إلى\s+)\s*(\d{1,2})\s*[\/\-]\s*(\d{1,2})\s*(?:[\/\-]\s*(\d{2,4}))?/
  const multiMatch = clean.match(multiDayPattern)
  if (multiMatch) {
    const endDay = parseInt(multiMatch[2], 10)
    const month = parseInt(multiMatch[3], 10)
    let year = multiMatch[4] || new Date().getFullYear().toString()
    if (year.length === 2) year = '20' + year
    return `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`
  }

  // 6. Check single slash/dash date: DD/MM/YYYY or DD-MM-YYYY
  const singleDateMatch = clean.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
  if (singleDateMatch) {
    const day = singleDateMatch[1].padStart(2, '0')
    const month = singleDateMatch[2].padStart(2, '0')
    let year = singleDateMatch[3]
    if (year.length === 2) year = '20' + year
    return `${year}-${month}-${day}`
  }

  // 7. Check if standard Date parser can handle it
  const parsedTimestamp = Date.parse(clean)
  if (!isNaN(parsedTimestamp)) {
    const d = new Date(parsedTimestamp)
    return d.toISOString().split('T')[0]
  }

  // Fallback to today's date
  return new Date().toISOString().split('T')[0]
}

/**
 * Resolves hospital department variations into clean, canonical department names.
 * Ensures consistent groupings across reports and prevents fragmentation.
 */
export function getCanonicalDepartment(name) {
  if (!name || typeof name !== 'string') return 'عموم المستشفى'
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
  if ((clean.includes('معمل') || clean.includes('مختبر')) && !clean.includes('متوطن')) {
    return 'المعمل'
  }

  // 8. الأشعة والسونار
  if (clean.includes('اشع') || clean === 'السونار' || clean.includes('سونار') || clean === 'غرفه الاشعه' || clean === 'قسم الاشعه') {
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
  if (clean.includes('كلي') || clean.includes('كلى') || clean.includes('كلو')) {
    if (clean.includes('سنديون')) return 'وحدة غسيل الكلى بسنديون'
    if (clean.includes('زعفران')) return 'وحدة كلى الزعفران'
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
  if (clean.includes('سلامه وصحه') || clean.includes('صحه وسلامه') || clean.includes('حمايه مدنيه')) {
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
    return 'الأرشيف'
  }

  // 24. استبعاد واستيعاب المسميات غير القسمية (الأدوار الوظيفية، الفريق الطبي، البيئة، سلامة المرضى، إلخ)
  const pseudoList = [
    'طبيب', 'الطبيب', 'تمريض', 'التمريض', 'فريق طبي', 'الفريق الطبي',
    'هيئه طبي', 'الهيئة الطبية', 'بيئ', 'البيئة', 'سلامه مرضي', 'سلامة المرضى',
    'تعريف هويه المرضي', 'احال', 'طبيع', 'طلمبات', 'basement', 'control room',
    'فرز', 'الفرز'
  ]
  if (pseudoList.some(p => clean === p || clean.includes(p))) {
    return 'عموم المستشفى'
  }

  return name.trim()
}


