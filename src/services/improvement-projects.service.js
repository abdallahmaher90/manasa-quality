import { createServiceClient } from '../lib/supabase.js'
import { fetchGoogleSheetData } from '../lib/google-sheets.js'
import { findMatchingSheetHospital } from '../lib/hospital-matcher.js'
import { ovrService } from './ovr.service.js'
import crypto from 'crypto'

let hasTableCache = null

export async function checkHasTable(supabase) {
  if (hasTableCache !== null) return hasTableCache
  try {
    const { error } = await supabase.from('improvement_projects').select('id').limit(1)
    hasTableCache = !error
  } catch (e) {
    hasTableCache = false
  }
  return hasTableCache
}

export function getGroqKeys() {
  const keysStr = process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || ''
  return keysStr.split(',').map(k => k.trim()).filter(Boolean)
}

let currentGroqKeyIndex = 0

export async function callGroqWithRetry(payload, maxRetries = 5) {
  const keys = getGroqKeys()
  if (keys.length === 0) {
    throw new Error('لم يتم العثور على أي مفتاح GROQ_API_KEY أو GROQ_API_KEYS في ملف الإعدادات.')
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const activeKey = keys[currentGroqKeyIndex % keys.length]
    currentGroqKeyIndex = (currentGroqKeyIndex + 1) % keys.length

    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${activeKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      if (res.ok) {
        return await res.json()
      }

      if (res.status === 429) {
        if (keys.length > 1 && attempt < maxRetries) {
          console.log(`[Groq Multi-Key] Rate limit hit on key ending with ...${activeKey.slice(-6)}. Switching to next available key...`)
          continue
        }

        const errText = await res.text()
        let waitTime = 8000
        const match = errText.match(/try again in ([0-9.]+)s/)
        if (match && match[1]) {
          waitTime = Math.ceil(parseFloat(match[1]) * 1000) + 1500
        }
        console.log(`[ImprovementProjectsService] Rate limit 429 hit. Waiting ${(waitTime / 1000).toFixed(1)}s before retry ${attempt + 1}...`)
        await new Promise(r => setTimeout(r, waitTime))
        continue
      }

      const errText = await res.text()
      throw new Error(`Groq API Error (${res.status}): ${errText}`)
    } catch (err) {
      if (attempt >= maxRetries) throw err
      if (!err.message.includes('Groq API Error')) {
        await new Promise(r => setTimeout(r, 2000))
      }
    }
  }
}

// -------------------------------------------------------------
// KPI Units, Delimiters and Ground Truth Extractors
// -------------------------------------------------------------
export function extractKpiUnit(indicatorName = '') {
  const norm = (indicatorName || '').toLowerCase()
  if (norm.includes('أيام') || norm.includes('ايام') || norm.includes('بالأيام') || norm.includes('يوم')) {
    return 'أيام'
  }
  if (norm.includes('ساعات') || norm.includes('ساعة')) {
    return 'ساعات'
  }
  if (norm.includes('دقائق') || norm.includes('دقيقة')) {
    return 'دقيقة'
  }
  if (norm.includes('(عدد )') || norm.includes('(عدد)') || norm.includes('عدد الحالات') || norm.includes('عدد البلاغات')) {
    return 'عدد'
  }
  if (norm.includes('نسبة') || norm.includes('نسبه') || norm.includes('%') || norm.includes('معدل') || norm.includes('الالتزام') || norm.includes('إشغال') || norm.includes('اشغال')) {
    return '%'
  }
  return ''
}

export function formatKpiDisplay(indicator, value) {
  const unit = extractKpiUnit(indicator)
  const val = typeof value === 'number' ? value : (parseFloat(value) ?? value)
  if (unit === '%') return `${val}%`
  if (unit === 'أيام') return `${val} أيام`
  if (unit === 'ساعات') return `${val} ساعة`
  if (unit === 'دقيقة') return `${val} دقيقة`
  if (unit === 'عدد') return `${val}`
  return unit ? `${val} ${unit}`.trim() : `${val}`
}

export function getKpiPolarity(indicatorName = '') {
  const norm = (indicatorName || '').toLowerCase()
  // Negative indicators: 0 is target achieved / desirable, higher values are harmful
  const negativePatterns = [
    'وفيات', 'وفاة', 'عدوى', 'وخز', 'أخطاء', 'اخطاء', 'سقوط', 'قرح', 'جلطات',
    'توصيل خاطئ', 'انتهاكات', 'أعطال', 'اعطال', 'معطلة', 'معطله', 'شكاوى', 'شكاوي',
    'إعادة دخول', 'اعادة دخول', 'انتظار', 'اختصارات ممنوعة', 'اختصارات الممنوعة'
  ]
  if (negativePatterns.some(p => norm.includes(p))) {
    return 'LOWER_IS_BETTER'
  }
  return 'HIGHER_IS_BETTER'
}

export function isDeficientKpi(k) {
  if (!k || !k.Indicator) return false
  const alert = (k.Alert_Level || '').trim().toLowerCase()
  const status = (k.Status || '').trim().toLowerCase()
  const val = parseFloat(k.Value || 0)
  const polarity = getKpiPolarity(k.Indicator)

  // Explicit normal or OK
  if (alert === 'normal' || status === 'normal' || status === 'good' || status === 'ok' || status === 'target_achieved') {
    return false
  }

  // If LOWER_IS_BETTER and value is 0, it is TARGET ACHIEVED / EXCELLENT (not a deficiency)
  if (polarity === 'LOWER_IS_BETTER' && val === 0) {
    return false
  }

  // If HIGHER_IS_BETTER and value is 0, it IS A SEVERE DEFICIENCY (e.g. 0% reporting, 0% verbal orders, 0% repair)
  if (polarity === 'HIGHER_IS_BETTER' && val === 0) {
    return true
  }

  // For non-zero values, check alert levels and risk status
  if (alert === 'critical' || alert === 'alert' || status === 'risk') {
    return true
  }

  return false
}

// -------------------------------------------------------------
// Noise & Safety Hazard Filter (Context-Aware)
// -------------------------------------------------------------
export function isTrivialNoise(finding) {
  const text = typeof finding === 'string' ? finding : (finding?.original_text || '')
  if (!text) return true
  const lower = text.toLowerCase()

  // 1. High priority or recurring findings are NEVER noise
  if (typeof finding === 'object') {
    if (finding.priority === 'high' || finding.status === 'recurring') {
      return false
    }
  }

  // 2. Critical Safety, Hazard, Infection & Medication terms are NEVER noise
  const criticalHazardTerms = [
    'انسكاب', 'كيماو', 'مواد كيميائية', 'طفاية', 'طفايه', 'طفايات', 'حريق', 'حماية مدنية',
    'واقيات شخصية', 'قفازات', 'كمامة', 'كمامه', 'مريلة', 'جاون', 'وخز', 'إبر', 'ابر',
    'كراش كارت', 'كراش كار', 'عالية الخطورة', 'عاليه الخطوره', 'ثلاجة أدوية', 'سلسلة تبريد',
    'تطعيم', 'تطعيمات', 'غازات', 'أكسجين', 'اسطوانات', 'أسلاك مكشوفة', 'اسلاك مكشوفه', 'كهرباء',
    'نقل دم', 'مشتقات دم', 'فصائل دم', 'عزل', 'تعقيم', 'حقن آمن', 'محاليل', 'محطة مياه', 'كلور'
  ]
  if (criticalHazardTerms.some(t => lower.includes(t))) {
    return false
  }

  // 3. Genuine trivial janitorial / cosmetic / non-clinical noise
  const trivialPatterns = [
    'جرس استدعاء', 'جرس التمريض', 'لمبة', 'لمبه', 'بوابة', 'بوابه', 'كالون', 'صنبور', 'سباكة', 'سباكه',
    'كرسي مكسور', 'توفير كراسي', 'دهان الحائط', 'تربيزة', 'بلاط مكسور', 'أرضيات غير مستوية', 'حشائش',
    'بلاعة مسدودة', 'شفاط به غبار', 'لوحة اعلانات', 'لوحة بالخدمات', 'لوحات حقوق وواجبات',
    'دولاب غير منظم', 'أرفف خشبية', 'ترتيب المخزن', 'سلة مهملات بدون كيس',
    'مفتاح كهرباء مخلوع', 'كارنيه', 'شطب وكشط في دفتر الحضور', 'سجل المشورة غير معتمد',
    'حنفية بحوض', 'تسريب طفيف بالحنفية'
  ]
  return trivialPatterns.some(p => lower.includes(p))
}

// -------------------------------------------------------------
// Standardized Hospital Clinical Leadership & Multidisciplinary Roles
// -------------------------------------------------------------
export function getStandardClinicalRoles(departmentName = '', category = '') {
  const text = `${departmentName} ${category}`.toLowerCase()

  if (text.includes('مختبر') || text.includes('معمل') || text.includes('دم') || text.includes('نقل الدم') || text.includes('lab')) {
    return {
      lead: 'رئيس قسم المختبرات وبنك الدم بالمستشفى',
      team: [
        'أخصائي سلامة المرضى وتوكيد الجودة',
        'مشرفة تمريض بنك الدم وسحب العينات',
        'صيدلي إكلينيكي أول',
        'كيميائي وفني تحاليل طبية أول'
      ]
    }
  }

  if (text.includes('صيدل') || text.includes('دواء') || text.includes('علاج') || text.includes('pharm')) {
    return {
      lead: 'رئيس قسم الصيدلة بالمستشفى',
      team: [
        'صيدلي إكلينيكي أول',
        'مشرفة تمريض الأقسام الداخلية',
        'أخصائي سلامة المرضى وتوكيد الجودة',
        'طبيب مقيم بالقسم'
      ]
    }
  }

  if (text.includes('عناية') || text.includes('حرجة') || text.includes('icu') || text.includes('مركزة')) {
    return {
      lead: 'استشاري ورئيس قسم الرعاية المركزة بالمستشفى',
      team: [
        'مشرفة تمريض العناية المركزة',
        'صيدلي إكلينيكي عناية حرجة',
        'أخصائي سلامة المرضى وتوكيد الجودة',
        'طبيب مقيم رعاية مركزة'
      ]
    }
  }

  if (text.includes('طوارئ') || text.includes('استقبال') || text.includes('فرز') || text.includes('triage') || text.includes('er')) {
    return {
      lead: 'رئيس قسم الاستقبال والطوارئ بالمستشفى',
      team: [
        'مشرفة تمريض قسم الطوارئ',
        'أخصائي طب الطوارئ والحالات الحرجة',
        'أخصائي سلامة المرضى وتوكيد الجودة',
        'مشرف الخدمات المعاونة ونقل المرضى'
      ]
    }
  }

  if (text.includes('عمليات') || text.includes('تخدير') || text.includes('جراح') || text.includes('or')) {
    return {
      lead: 'رئيس قسم العمليات والتخدير بالمستشفى',
      team: [
        'مشرفة تمريض العمليات الجراحية',
        'طبيب مقيم تخدير ورعاية ما بعد الجراحة',
        'أخصائي سلامة المرضى وتوكيد الجودة',
        'صيدلي إكلينيكي جراحة وتخدير'
      ]
    }
  }

  if (text.includes('مبتسر') || text.includes('حضّان') || text.includes('حضان') || text.includes('أطفال') || text.includes('nicu')) {
    return {
      lead: 'رئيس قسم المبتسرين وحديثي الولادة بالمستشفى',
      team: [
        'مشرفة تمريض وحدة المبتسرين',
        'طبيب مقيم أطفال وحديثي ولادة',
        'أخصائي سلامة المرضى وتوكيد الجودة',
        'صيدلي إكلينيكي أطفال'
      ]
    }
  }

  if (text.includes('كلى') || text.includes('غسيل') || text.includes('dialysis')) {
    return {
      lead: 'رئيس وحدة الغسيل الكلوي بالمستشفى',
      team: [
        'مشرفة تمريض وحدة الغسيل الكلوي',
        'طبيب مقيم أمراض كلى',
        'أخصائي سلامة المرضى وتوكيد الجودة',
        'مهندس صيانة الأجهزة الطبية بالمستشفى'
      ]
    }
  }

  if (text.includes('مكافحة') || text.includes('عدوى') || text.includes('تعقيم') || text.includes('cssd')) {
    return {
      lead: 'رئيس فريق مكافحة العدوى بالمستشفى',
      team: [
        'مشرفة التعقيم المركزي (CSSD)',
        'مشرفة تمريض مكافحة العدوى',
        'أخصائي سلامة المرضى وتوكيد الجودة',
        'صيدلي إكلينيكي'
      ]
    }
  }

  if (text.includes('سجل') || text.includes('ملف') || text.includes('تذاكر') || text.includes('توثيق')) {
    return {
      lead: 'مدير الإدارة الطبية ورئيس لجنة السجلات الطبية',
      team: [
        'مشرفة التمريض العام بالمستشفى',
        'أخصائي توكيد الجودة وسلامة المرضى',
        'مسؤول قسم السجلات والملفات الطبية',
        'طبيب مقيم باطنة وجراحة'
      ]
    }
  }

  if (text.includes('حريق') || text.includes('إخلاء') || text.includes('حماية مدنية') || text.includes('fire')) {
    return {
      lead: 'مدير إدارة السلامة والصحة المهنية والحماية المدنية',
      team: [
        'مسؤول الحماية المدنية والسلامة البيئية',
        'مشرف الأمن والسلامة بالمستشفى',
        'أخصائي سلامة المرضى وتوكيد الجودة',
        'مشرف التمريض العام'
      ]
    }
  }

  if (text.includes('أجهزة') || text.includes('اجهزة') || text.includes('هندسة طبية') || text.includes('صيانة أجهزة') || text.includes('bme')) {
    return {
      lead: 'رئيس قسم الهندسة الطبية وصيانة الأجهزة بالمستشفى',
      team: [
        'مهندس صيانة الأجهزة الطبية بالمستشفى',
        'مسؤول الصيانة الوقائية والمعايرة',
        'مشرفة تمريض الأقسام الحرجة',
        'أخصائي سلامة المرضى وتوكيد الجودة'
      ]
    }
  }

  if (text.includes('بيئ') || text.includes('كهرباء') || text.includes('أسلاك') || text.includes('مرافق') || text.includes('env')) {
    return {
      lead: 'رئيس قسم الأشعة والمرافق بالتنسيق مع الإدارة الهندسية',
      team: [
        'مهندس صيانة الكهرباء والمرافق بالمستشفى',
        'فني أشعة أول',
        'مشرف السلامة والصحة المهنية',
        'أخصائي سلامة المرضى وتوكيد الجودة'
      ]
    }
  }

  const dept = departmentName && departmentName !== 'عام' ? departmentName : 'القسم المعني'
  return {
    lead: `رئيس قسم ${dept} بالمستشفى`,
    team: [
      `مشرفة تمريض قسم ${dept}`,
      'أخصائي سلامة المرضى وتوكيد الجودة',
      'صيدلي إكلينيكي أول',
      `طبيب مقيم بقسم ${dept}`
    ]
  }
}

export function sanitizeClinicalLead(rawLead, departmentName, category) {
  const standard = getStandardClinicalRoles(departmentName, category)
  if (!rawLead || typeof rawLead !== 'string') {
    return standard.lead
  }

  let text = rawLead.trim()

  const bannedKeywords = [
    'مهندس نظم', 'محلل نظم', 'مبرمج', 'مطور', 'it', 'برمجيات', 'software',
    'أحمد', 'محمد', 'محمود', 'علي', 'حسن', 'حسين', 'إبراهيم', 'مصطفى',
    'ليلى', 'سارة', 'فاطمة', 'مريم', 'منى', 'هدى', 'عبدالعزيز', 'الخالدي', 'السالم', 'عمر', 'خالد'
  ]

  const hasHumanPrefix = /^(د\.|دكتور|دكتورة|أ\.|أستاذ|أستاذة|السيد|السيدة)\s+/i.test(text) || text.includes(' د.') || text.includes(' دكتور ')
  const roleKeywords = ['رئيس', 'مدير', 'استشاري', 'أخصائي', 'مشرف', 'مشرفة', 'منسق', 'مسؤول']
  const hasRoleKeyword = roleKeywords.some(rk => text.includes(rk))

  if (hasHumanPrefix || !hasRoleKeyword || bannedKeywords.some(bk => text.toLowerCase().includes(bk))) {
    return standard.lead
  }

  return text
}

export function sanitizeClinicalTeamMembers(rawMembers, departmentName, category) {
  const standard = getStandardClinicalRoles(departmentName, category)
  if (!Array.isArray(rawMembers) || rawMembers.length === 0) {
    return standard.team
  }

  const bannedKeywords = [
    'مهندس نظم', 'محلل نظم', 'مبرمج', 'مطور', 'it', 'برمجيات', 'software',
    'نظم ومعلومات', 'قواعد بيانات', 'أمن سيبراني', 'د.', 'دكتور', 'دكتورة', 'أ.', 'أستاذ',
    'ليلى', 'سارة', 'فاطمة', 'محمد', 'أحمد', 'السالم', 'الخالدي', 'عبدالعزيز', 'عمر'
  ]

  const validMembers = []
  for (const m of rawMembers) {
    if (typeof m !== 'string') continue
    const cleaned = m.trim()
    if (cleaned.length < 3 || cleaned.length > 50) continue
    
    const isBanned = bannedKeywords.some(bk => cleaned.toLowerCase().includes(bk))
    if (isBanned) continue

    const validClinicalTerms = ['طبيب', 'صيدلي', 'تمريض', 'ممرض', 'مشرف', 'مشرفة', 'أخصائي', 'استشاري', 'منسق', 'فني', 'كيميائي', 'مراقب', 'مسؤول', 'كادر', 'مهندس']
    const isValidRole = validClinicalTerms.some(term => cleaned.includes(term))
    if (isValidRole) {
      validMembers.push(cleaned)
    }
  }

  const finalSet = [...validMembers]
  for (const stdMember of standard.team) {
    if (finalSet.length >= 4) break
    if (!finalSet.some(existing => existing.includes(stdMember.slice(0, 7)))) {
      finalSet.push(stdMember)
    }
  }

  return finalSet.slice(0, 4)
}

export function sanitizeResponsibleRole(rawResp, departmentName, category) {
  if (!rawResp || typeof rawResp !== 'string') return `رئيس قسم ${departmentName || 'القسم'} ومشرفة التمريض`
  let text = rawResp.trim()
  const techBanned = ['تقنية', 'برمج', 'مبرمج', 'سيبراني', 'it', 'نظم', 'تطوير', 'د.', 'دكتور', 'ليلى', 'أحمد', 'عبدالعزيز']
  if (techBanned.some(b => text.toLowerCase().includes(b))) {
    return `رئيس قسم ${departmentName || 'القسم'} بالتعاون مع فريق الجودة`
  }
  return text
}

// -------------------------------------------------------------
// Comprehensive Clinical & Operational Domains for Evidence Clustering
// Unbundled into Distinct Focused Pathways (No Frankenstein Mergers)
// -------------------------------------------------------------
const CLINICAL_DOMAINS = [
  {
    id: 'MEDICATION_SAFETY_MANAGEMENT',
    name: 'مأمونية الدواء وإدارة الأدوية عالية الخطورة وسلسلة التبريد',
    category: 'إدارة واستخدام الدواء (MMU)',
    findingKeywords: [
      'دواء', 'دوائ', 'صيدل', 'روشت', 'وصفات', 'وصفه', 'كراش كارت', 'كراش كار', 'عاليه الخطور',
      'عالية الخطورة', 'lasa', 'متشابهه', 'متشابهة', 'ترياق', 'antidote', 'ثلاجه الادويه', 'ثلاجة الادوية',
      'تكدس بالادويه', 'كراتين في الثلاجه', 'سلسلة التبريد', 'سلسله التبريد', 'توافق دوائ',
      'تطعيمات بعد الفتح', 'تاريخ الانتهاء بعد الفتح', 'فايلات التطعيمات'
    ],
    deptKeywords: ['صيدل', 'علاج', 'كشك الادوية'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('وصفات') || ind.includes('أدوية عالية') || ind.includes('ادوية عالية') ||
             ind.includes('المتشابهة في الشكل') || ind.includes('النتائج الدوائية العكسية') ||
             ind.includes('تطعيمات فيروس b')
    },
    ovrMatch: o => {
      const txt = o.toLowerCase()
      return txt.includes('دواء') || txt.includes('جرعة') || txt.includes('صيدل') || txt.includes('medication')
    },
    gaharStandard: 'معايير إدارة واستخدام الدواء (GAHAR MMU.01 - MMU.08)'
  },
  {
    id: 'MEDICAL_RECORDS_CLINICAL_DOCUMENTATION',
    name: 'حوكمة السجلات والملفات الطبية والتوثيق السريري والإقرارات',
    category: 'إدارة المعلومات والسجلات الطبية (MRM)',
    findingKeywords: [
      'ملف طبي', 'سجل طبي', 'سجلات', 'تذكر', 'تذكرة', 'توثيق', 'اختصارات', 'اختصار',
      'توقيع الاطباء', 'توقيع الطبيب', 'توقيع ثنائي', 'فورمه', 'اقرار', 'إقرار', 'موافقه مستنيرة',
      'نموذج دخول', 'نموذج خروج', 'غير مكتملة البيانات', 'physical assessment', 'شارت'
    ],
    deptKeywords: ['سجلات', 'ارشيف', 'تذاكر'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('الملف الطبي المفتوح') || ind.includes('الملف الطبي المغلق') ||
             ind.includes('الاختصارات الطبية الممنوعة') || ind.includes('الأوامر الشفهية') ||
             ind.includes('الاوامر الشفهية')
    },
    ovrMatch: o => {
      const txt = o.toLowerCase()
      return txt.includes('سجل') || txt.includes('تذكرة') || txt.includes('ملف') || txt.includes('documentation')
    },
    gaharStandard: 'معايير إدارة المعلومات والسجلات الطبية (GAHAR MRM.01 - MRM.05)'
  },
  {
    id: 'INFECTION_PREVENTION_CONTROL',
    name: 'مكافحة العدوى وممارسات الحقن الآمن والواقيات الشخصية والتعقيم',
    category: 'مكافحة ومنع انتشار العدوى (IPC)',
    findingKeywords: [
      'عدو', 'عزل', 'تعقيم', 'اوتوكلاف', 'واقيات شخص', 'واقيات', 'ppe', 'قفازات', 'كمامة', 'كمامه',
      'غسيل ايدي', 'تطهير ايدي', 'حقن امن', 'حقن آمن', 'وخز', 'ابره', 'ابر', 'صندوق امان', 'صندوق أمان',
      'نفايات خطره', 'نفايات طبية', 'مطهرات', 'مسحات', 'cauti', 'clabsi', 'vap', 'ssi'
    ],
    deptKeywords: ['مكافحة العدوى', 'التعقيم', 'العزل'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('الحقن الآمن') || ind.includes('الواقيات الشخصية') || ind.includes('غسيل الأيدي') ||
             ind.includes('الوخز بالإبر') || ind.includes('العدوى المصاحبة')
    },
    ovrMatch: o => {
      const txt = o.toLowerCase()
      return txt.includes('infection') || txt.includes('عدوى') || txt.includes('وخز') || txt.includes('واقيات')
    },
    gaharStandard: 'معايير مكافحة ومنع انتشار العدوى (GAHAR IPC.01 - IPC.09)'
  },
  {
    id: 'PATIENT_SAFETY_GOVERNANCE_CRITICAL_RESULTS',
    name: 'الأهداف الوطنية لسلامة المرضى والإنذارات والنتائج الحرجة',
    category: 'سلامة المرضى والأهداف الوطنية (NPSG)',
    findingKeywords: [
      'تعريف المريض', 'اسوره', 'اساور', 'هويه المريض', 'بدون تعريف', 'نتائج حرجه', 'نتائج حرجة',
      'قائمه بالنتائج الحرجه', 'دفتر النتائج الحرجه', 'انذارات حرجه', 'إنذارات حرجة',
      'سقوط', 'قرح فراش', 'تسليم وتسلم', 'handover', 'sbar', 'توصيل خاطئ'
    ],
    deptKeywords: ['جودة', 'سلامة'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('التعريف الصحيح للمريض') || ind.includes('أخطاء في عناصر الرعاية المرتبطة بالتعريف') ||
             ind.includes('الإنذارات الحرجة') || ind.includes('النتائج الحرجة') ||
             ind.includes('سقوط المرضى') || ind.includes('قرح الفراش') || ind.includes('الجلطات الوريدية')
    },
    ovrMatch: o => {
      const txt = o.toLowerCase()
      return txt.includes('fall') || txt.includes('سقوط') || txt.includes('هوية') || txt.includes('إنذار') || txt.includes('critical result')
    },
    gaharStandard: 'معايير الأهداف الوطنية لسلامة المرضى (GAHAR NPSG.01 - NPSG.06)'
  },
  {
    id: 'CRITICAL_EMERGENCY_CARE_RESUSCITATION',
    name: 'جاهزية إنعاش القلب والرعاية الحرجة وحالات التدهور السريري',
    category: 'الرعاية الحرجة والطارئة (ECC)',
    findingKeywords: [
      'انعاش', 'إنعاش', 'cpr', 'كود بلو', 'code blue', 'dc shock', 'جهاز صدمات', 'تفريغ جهاز dc',
      'علامات حيوية في محضر cpr', 'تدهور', 'استجابة سريعة', 'rrt', 'تنفس صناعي', 'ريسفنت', 'وفيات العناية'
    ],
    deptKeywords: ['طوارئ', 'استقبال', 'عناية مركزه', 'عنايه مركزه', 'icu'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      const val = parseFloat(k.Value || 0)
      return (ind.includes('وفيات العناية') || ind.includes('وفيات الرعاية')) && val > 0
    },
    ovrMatch: o => {
      const txt = o.toLowerCase()
      return txt.includes('cpr') || txt.includes('code blue') || txt.includes('صدمات') || txt.includes('resuscitation')
    },
    gaharStandard: 'معايير الرعاية الحرجة والطوارئ (GAHAR ECC.01 - ECC.07)'
  },
  {
    id: 'PATIENT_FLOW_CAPACITY_MANAGEMENT',
    name: 'إدارة التدفق السريري والخروج المعياري وكفاءة دوران الأسرة',
    category: 'إدارة السعة والتدفق السريري (FLOW)',
    findingKeywords: [
      'تكدس', 'ازدحام', 'خروج مبكر', 'تاخر خروج', 'تحويل حالات الطوارئ الي الاقسام الداخليه',
      'حجز بالقسم الداخلي', 'اشغال الاسرة'
    ],
    deptKeywords: ['داخلي', 'اقسام داخلية', 'تذاكر'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('دوران السرير') || ind.includes('اشغال الأسرة') || ind.includes('إشغال الأسرة')
    },
    ovrMatch: o => {
      const txt = o.toLowerCase()
      return txt.includes('تكدس') || txt.includes('ازدحام') || txt.includes('bed delay')
    },
    gaharStandard: 'معايير إدارة تدفق المرضى وسعة المنشأة (GAHAR ACC.01 - ACC.04)'
  },
  // Distinct Unbundled Domain 1: Life & Fire Safety
  {
    id: 'LIFE_AND_FIRE_SAFETY',
    name: 'السلامة وحماية الأرواح والجاهزية لمكافحة الحريق وخطط الإخلاء',
    category: 'السلامة وحماية الأرواح (FMS - Life Safety)',
    findingKeywords: [
      'طفايه', 'طفاية', 'طفايات', 'حريق', 'حماية مدنية', 'اخلاء', 'إخلاء', 'مخارج طوارئ',
      'كواشف دخان', 'كاشف دخان', 'معدات إطفاء', 'معدات الاطفاء', 'race & pass', 'race&pass'
    ],
    deptKeywords: ['السلامة والصحة المهنية والحماية المدنية', 'الحماية المدنية', 'الأمن والسلامة'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('حريق') || ind.includes('إخلاء') || ind.includes('اخلاء') ||
             ind.includes('معدات الإطفاء') || ind.includes('كواشف الدخان')
    },
    ovrMatch: o => {
      const txt = o.toLowerCase()
      return txt.includes('fire') || txt.includes('حريق') || txt.includes('إخلاء') || txt.includes('طفاية')
    },
    gaharStandard: 'معايير حماية الأرواح والسلامة من الحريق (GAHAR FMS.04 - FMS.06)'
  },
  // Distinct Unbundled Domain 2: Biomedical Engineering & Medical Equipment
  {
    id: 'BIOMEDICAL_EQUIPMENT_MAINTENANCE',
    name: 'الجاهزية التشغيلية وصيانة ومعايرة الأجهزة الطبية الحيوية',
    category: 'تكنولوجيا وسلامة الأجهزة الطبية (BME)',
    findingKeywords: [
      'أجهزة طبية', 'اجهزة طبية', 'صيانة أجهزة', 'معايرة', 'عطل جهاز', 'أعطال الأجهزة الطبية',
      'عقود الصيانة', 'ترخيص أجهزة'
    ],
    deptKeywords: ['الأجهزة الطبية', 'الهندسة الطبية', 'الصيانة الطبية'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('الأجهزة الطبية') || ind.includes('الاجهزة والاقسام المرخصة') ||
             ind.includes('الأجهزة والأقسام المغطاة بعقود الصيانة')
    },
    ovrMatch: o => {
      const txt = o.toLowerCase()
      return txt.includes('عطل جهاز') || txt.includes('أجهزة طبية') || txt.includes('biomedical')
    },
    gaharStandard: 'معايير إدارة وصيانة الأجهزة الطبية (GAHAR FMS.07 - FMS.08)'
  },
  // Distinct Unbundled Domain 3: Environmental & Electrical Safety
  {
    id: 'FACILITY_ENVIRONMENTAL_ELECTRICAL_SAFETY',
    name: 'السلامة البيئية وإدارة المخاطر الكهربائية وتأمين بيئة العمل',
    category: 'السلامة البيئية والمخاطر الهندسية (ENV)',
    findingKeywords: [
      'اسلاك مكشوفه', 'أسلاك مكشوفة', 'كهرباء', 'غازات طبية', 'اكسجين', 'أكسجين', 'اسطوانات',
      'ماسة المواد الكيميائية', 'ماسه المواد الكيميائيه', 'غاسله اعين', 'غاسلة أعين', 'انسكاب',
      'تسريب غاز', 'مياه ملوثة'
    ],
    deptKeywords: ['الأشعة', 'المرافق', 'الإدارة الهندسية', 'السلامة البيئية'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('انسكابات كيميائية') || ind.includes('ملصقات المواد الكيميائية')
    },
    ovrMatch: o => {
      const txt = o.toLowerCase()
      return txt.includes('electrical') || txt.includes('كهرباء') || txt.includes('أسلاك') || txt.includes('spill') || txt.includes('انسكاب')
    },
    gaharStandard: 'معايير السلامة البيئية والمخاطر الفيزيائية (GAHAR FMS.01 - FMS.03)'
  },
  {
    id: 'SURGICAL_SAFETY_ANESTHESIA',
    name: 'الأمان الجراحي وقائمة التحقق والتخدير المأمون',
    category: 'الخدمات الجراحية والتخدير (SAC)',
    findingKeywords: [
      'عمليات', 'جراح', 'تخدير', 'وقت مستقطع', 'time out', 'تحديد موضع', 'جراحة تفقدية'
    ],
    deptKeywords: ['عمليات', 'جراحة', 'تخدير'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('الجراحة التفقدية') || ind.includes('تحديد موضع الإجراء الجراحي')
    },
    ovrMatch: o => {
      const txt = o.toLowerCase()
      return txt.includes('surgery') || txt.includes('جراحة') || txt.includes('anesthesia') || txt.includes('تخدير')
    },
    gaharStandard: 'معايير الرعاية الجراحية والتخدير (GAHAR SAC.01 - SAC.05)'
  },
  {
    id: 'SPECIALIZED_DIALYSIS_RENAL',
    name: 'مأمونية الغسيل الكلوي ومحطة المياه وتفادي مضاعفات الجلسات',
    category: 'الخدمات التخصصية - الغسيل الكلوي',
    findingKeywords: [
      'غسيل كلوي', 'ماكينات الغسيل', 'محطة المياه', 'محطه المياه', 'فلتر الغسيل', 'وصلات وريدية كلوية'
    ],
    deptKeywords: ['غسيل كلوي', 'كلى'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('غسيل كلوي') || ind.includes('الكلى')
    },
    ovrMatch: o => {
      const txt = o.toLowerCase()
      return txt.includes('dialysis') || txt.includes('غسيل كلوي')
    },
    gaharStandard: 'المعايير التخصصية لوحدات الغسيل الكلوي (GAHAR DLS.01)'
  },
  {
    id: 'SPECIALIZED_NICU_NEONATAL',
    name: 'رعاية حديثي الولادة والمبتسرين وخفض مضاعفات الحضانات',
    category: 'الخدمات التخصصية - الحضانات والأطفال',
    findingKeywords: [
      'حضان', 'مبتسر', 'سيباب', 'ضائقة تنفسية', 'انعاش مبتسر', 'وفيات الحضان'
    ],
    deptKeywords: ['حضان', 'مبتسر'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      const val = parseFloat(k.Value || 0)
      return (ind.includes('وفيات الحضان') && val > 0) || ind.includes('دوران السرير في الحضان') || ind.includes('الاشغال في الحضان')
    },
    ovrMatch: o => {
      const txt = o.toLowerCase()
      return txt.includes('nicu') || txt.includes('حضان') || txt.includes('مبتسر')
    },
    gaharStandard: 'المعايير التخصصية لرعاية الأطفال وحديثي الولادة (GAHAR PED.01)'
  },
  {
    id: 'SPECIALIZED_LAB_BLOOD_TRANSFUSION',
    name: 'سلامة نقل الدم ومطابقة الفصائل وجودة الفحوصات التشخيصية',
    category: 'الخدمات التشخيصية وبنك الدم (DBS)',
    findingKeywords: [
      'نقل دم', 'مشتقات الدم', 'فصيلة الدم', 'تطابق فصائل', 'كيس دم', 'بنك الدم'
    ],
    deptKeywords: ['بنك الدم'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return !ind.includes('الكشف الدوري') && (ind.includes('نقل الدم') || ind.includes('بنك الدم'))
    },
    ovrMatch: o => {
      const txt = o.toLowerCase()
      return txt.includes('blood transfusion') || txt.includes('نقل دم') || txt.includes('كيس دم')
    },
    gaharStandard: 'معايير خدمات نقل الدم والمختبرات (GAHAR DBS.01 - DBS.06)'
  }
]

export class ImprovementProjectsService {
  constructor() {
    this.supabase = createServiceClient()
  }

  // 1. Get all projects with optional filters
  async getProjects({ hospitalId = null, status = null, priority = null } = {}) {
    const hasTable = await checkHasTable(this.supabase)

    if (hasTable) {
      let query = this.supabase.from('improvement_projects').select('*').order('created_at', { ascending: false })
      if (hospitalId) query = query.eq('hospital_id', hospitalId)
      if (status && status !== 'all') query = query.eq('status', status)
      if (priority && priority !== 'all') query = query.eq('priority', priority)

      const { data, error } = await query
      if (error) throw error
      return data || []
    }

    // Fallback: Read from settings table
    const { data: rows, error } = await this.supabase
      .from('settings')
      .select('*')
      .like('key', 'improvement_project:%')

    if (error) throw error
    if (!rows || rows.length === 0) return []

    let projects = rows.map(r => {
      try {
        return JSON.parse(r.value)
      } catch (e) {
        return null
      }
    }).filter(Boolean)

    if (hospitalId) projects = projects.filter(p => p.hospital_id === hospitalId)
    if (status && status !== 'all') projects = projects.filter(p => p.status === status)
    if (priority && priority !== 'all') projects = projects.filter(p => p.priority === priority)

    return projects.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }

  // 2. Get Single Project
  async getProjectById(id) {
    const hasTable = await checkHasTable(this.supabase)
    if (hasTable) {
      const { data, error } = await this.supabase
        .from('improvement_projects')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error
      return data
    }

    const { data, error } = await this.supabase
      .from('settings')
      .select('value')
      .eq('key', `improvement_project:${id}`)
      .single()

    if (error || !data) return null
    try {
      return JSON.parse(data.value)
    } catch (e) {
      return null
    }
  }

  // 3. Save Project
  async saveProject(projectData) {
    const now = new Date().toISOString()
    const id = projectData.id || crypto.randomUUID()
    const project = {
      ...projectData,
      id,
      status: projectData.status || 'draft',
      priority: projectData.priority || 'high',
      created_at: projectData.created_at || now,
      updated_at: now
    }

    const hasTable = await checkHasTable(this.supabase)
    if (hasTable) {
      const { data, error } = await this.supabase
        .from('improvement_projects')
        .insert(project)
        .select()
        .single()
      if (error) throw error
      return data
    }

    const { error } = await this.supabase.from('settings').upsert({
      key: `improvement_project:${id}`,
      value: JSON.stringify(project)
    }, { onConflict: 'key' })

    if (error) throw error
    return project
  }

  // 4. Update Project
  async updateProject(id, updates) {
    const now = new Date().toISOString()
    const hasTable = await checkHasTable(this.supabase)

    if (hasTable) {
      const { data, error } = await this.supabase
        .from('improvement_projects')
        .update({ ...updates, updated_at: now })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    }

    const existing = await this.getProjectById(id)
    if (!existing) throw new Error('المشروع غير موجود')

    const updated = {
      ...existing,
      ...updates,
      updated_at: now
    }

    const { error } = await this.supabase.from('settings').upsert({
      key: `improvement_project:${id}`,
      value: JSON.stringify(updated)
    }, { onConflict: 'key' })

    if (error) throw error
    return updated
  }

  // 5. Delete Project
  async deleteProject(id) {
    const hasTable = await checkHasTable(this.supabase)
    if (hasTable) {
      const { error } = await this.supabase.from('improvement_projects').delete().eq('id', id)
      if (error) throw error
      return true
    }

    const { error } = await this.supabase.from('settings').delete().eq('key', `improvement_project:${id}`)
    if (error) throw error
    return true
  }

  // 6. Fetch Real Hospital KPIs from Google Sheet
  async fetchHospitalKpisFromSheet(hospitalName) {
    try {
      const { data: settingData } = await this.supabase
        .from('settings')
        .select('value')
        .eq('key', 'google_sheet_url')
        .single()

      if (!settingData?.value) return { matchedName: null, kpis: [] }

      const allSheetRows = await fetchGoogleSheetData(settingData.value)
      if (!allSheetRows || allSheetRows.length === 0) return { matchedName: null, kpis: [] }

      const sheetHospitals = [...new Set(allSheetRows.map(r => r.Hospital).filter(Boolean))]
      const matchedName = findMatchingSheetHospital(hospitalName, sheetHospitals)
      if (!matchedName) return { matchedName: null, kpis: [] }

      const hospitalRows = allSheetRows.filter(r => r.Hospital === matchedName)

      // Group by indicator and keep the latest record
      const latestMap = new Map()
      for (const r of hospitalRows) {
        if (!r.Indicator) continue
        const indName = String(r.Indicator).trim()
        const existing = latestMap.get(indName)
        if (!existing) {
          latestMap.set(indName, r)
        } else {
          const rYear = Number(r.Year) || 0
          const rMonth = Number(r.Month) || 0
          const exYear = Number(existing.Year) || 0
          const exMonth = Number(existing.Month) || 0
          if (rYear > exYear || (rYear === exYear && rMonth > exMonth)) {
            latestMap.set(indName, r)
          }
        }
      }

      const deduplicated = Array.from(latestMap.values())
      return { matchedName, kpis: deduplicated }
    } catch (err) {
      console.error('Error fetching hospital KPIs from Google Sheet:', err)
      return { matchedName: null, kpis: [] }
    }
  }

  // 7. Clinical Domain Classification
  classifyDomain(text, deptName = '') {
    const normalize = (t) => {
      if (!t) return ''
      return t
        .toLowerCase()
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/[\u064B-\u065F]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    }

    const normText = normalize(text)
    const normDept = normalize(deptName)

    for (const domain of CLINICAL_DOMAINS) {
      const matchInText = domain.findingKeywords.some(kw => normText.includes(normalize(kw)))
      if (matchInText) return domain.id
    }

    for (const domain of CLINICAL_DOMAINS) {
      const matchInDept = domain.deptKeywords.some(kw => normDept.includes(normalize(kw)))
      if (matchInDept) return domain.id
    }

    return 'OTHER_GENERAL'
  }

  // 8. Analyze Hospital Crisis (Data-First Bottom-Up Evidence Clustering)
  async analyzeHospitalCrisis(hospitalId) {
    // 1. Fetch Hospital Details
    const { data: hospital, error: hospErr } = await this.supabase
      .from('hospitals')
      .select('*')
      .eq('id', hospitalId)
      .single()

    if (hospErr || !hospital) throw new Error('المستشفى غير موجود')

    // 2. Fetch Findings: STRICTLY EXCLUDE RESOLVED / CLOSED FINDINGS!
    const { data: findings } = await this.supabase
      .from('v_report_findings')
      .select('id, department_id, original_text, priority, status, repeat_count, canonical_finding_id, departments(name)')
      .eq('hospital_id', hospitalId)
      .not('status', 'in', '("resolved_confirmed","resolved_by_hospital","resolved")')

    const eligibleFindings = (findings || []).filter(f => !isTrivialNoise(f))

    // 3. Fetch Google Sheet KPIs
    const { matchedName: matchedSheetName, kpis: sheetKpis } = await this.fetchHospitalKpisFromSheet(hospital.name)
    const activeDeficientKpis = sheetKpis.filter(k => isDeficientKpi(k))

    // 4. Fetch Hospital OVR Incidents
    const rawOvrRecords = await ovrService.getHospitalOVR(hospitalId)
    const eligibleOvrRecords = (rawOvrRecords || []).filter(o => !isTrivialNoise(o.description) && !isTrivialNoise(o.subcategory))

    // 5. Dynamic Bottom-Up Thematic Clustering
    const normalize = (t) => {
      if (!t) return ''
      return t
        .toLowerCase()
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/[\u064B-\u065F]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    }

    const clusters = []

    for (const domain of CLINICAL_DOMAINS) {
      // Semantic matching on finding text (Department is secondary context, NOT standalone evidence!)
      const domainFindings = eligibleFindings.filter(f => {
        const normF = normalize(f.original_text || '')
        const normD = normalize(f.departments?.name || '')
        const textMatched = domain.findingKeywords.some(kw => normF.includes(normalize(kw)))
        if (textMatched) return true
        
        // If department matches, require at least generic clinical keyword, never blind assignment
        const deptMatched = domain.deptKeywords.some(kw => normD.includes(normalize(kw)))
        if (deptMatched) {
          const genericClinical = ['غير مطابق', 'غير مكتمل', 'لا يوجد', 'عدم توفر', 'نقص', 'خلل', 'تاخر', 'تأخر']
          return genericClinical.some(g => normF.includes(g))
        }
        return false
      })

      // Deficient KPIs matching this domain
      const domainKpis = activeDeficientKpis.filter(k => domain.kpiMatch(k))

      // OVR incidents matching this domain
      const domainOvrs = eligibleOvrRecords.filter(o => {
        const full = `${o.subcategory || ''} ${o.category || ''} ${o.description || ''}`
        return domain.ovrMatch(full)
      })

      const hasFinding = domainFindings.length > 0
      const hasKpi = domainKpis.length > 0
      const hasOvr = domainOvrs.length > 0
      const sourceCount = (hasFinding ? 1 : 0) + (hasKpi ? 1 : 0) + (hasOvr ? 1 : 0)

      // Strict Evidence-First Rule: A quality project MUST have active field inspection findings!
      // Loose sheet numbers or distant OVRs without any field inspection finding cannot manufacture an improvement project.
      if (domainFindings.length === 0) {
        continue
      }

      // Minimum evidence threshold: At least 2 active findings OR cross-source corroboration (1 finding + KPI/OVR)
      if (domainFindings.length < 2 && sourceCount < 2) {
        continue
      }

      let corroborationLevel = ''
      if (sourceCount === 3) {
        corroborationLevel = 'تطابق ثلاثي الأركان (مرور ميداني + مؤشرات أداء رقمية + بلاغات OVR)'
      } else if (sourceCount === 2) {
        if (hasFinding && hasKpi) {
          corroborationLevel = 'تطابق ثنائي الأركان (مرور ميداني موثق + مؤشرات أداء رقمية)'
        } else if (hasFinding && hasOvr) {
          corroborationLevel = 'تطابق ثنائي الأركان (مرور ميداني موثق + بلاغات OVR)'
        } else {
          corroborationLevel = 'تطابق ثنائي الأركان (مؤشرات أداء رقمية + بلاغات OVR)'
        }
      } else {
        if (hasFinding) {
          corroborationLevel = 'مبني على المرور الميداني وسلبيات التفتيش الموثقة فقط'
        } else {
          corroborationLevel = 'مبني على تحليل مؤشرات الأداء الرقمية بالشيت فقط'
        }
      }

      const critKpis = domainKpis.filter(k => k.Alert_Level === 'Critical')
      const alertKpis = domainKpis.filter(k => k.Alert_Level === 'Alert' || k.Status === 'Risk')
      const recurringFindings = domainFindings.filter(f => f.status === 'recurring')
      const highFindings = domainFindings.filter(f => f.priority === 'high' && f.status !== 'recurring')
      const normalFindings = domainFindings.filter(f => f.priority !== 'high' && f.status !== 'recurring')

      // Rigorous Evidence-First Scoring Formula
      const rawScore = (critKpis.length * 40) +
                       (alertKpis.length * 20) +
                       (recurringFindings.length * 25) +
                       (highFindings.length * 20) +
                       (normalFindings.length * 10) +
                       (Math.min(domainOvrs.length, 5) * 5)

      const multiplier = sourceCount === 3 ? 1.25 : (sourceCount === 2 ? 1.1 : 1.0)
      const totalScore = Math.round(rawScore * multiplier)

      if (totalScore <= 0) continue

      // Scale Determination: Institutional Flagship vs Focused Targeted Improvement
      const projectScale = (sourceCount >= 2 && (critKpis.length > 0 || highFindings.length >= 3))
        ? 'FLAGSHIP_INSTITUTIONAL'
        : 'FOCUSED_TARGETED'

      // Clean Structured KPIs with exact units
      const structuredKpis = domainKpis.map(k => {
        const unit = extractKpiUnit(k.Indicator)
        return {
          Indicator: k.Indicator,
          Value: k.Value,
          unit,
          Alert_Level: k.Alert_Level,
          Status: k.Status,
          Year: k.Year || null,
          Month: k.Month || null,
          formatted: formatKpiDisplay(k.Indicator, k.Value)
        }
      })

      // Evidence summary strings
      const critKpisEvidence = structuredKpis
        .map(k => {
          const dateStr = (k.Year && k.Month) ? ` [تاريخ: ${k.Year}/${k.Month}]` : ''
          return `• ${k.Indicator}: ${k.formatted} (حالة الخطر: ${k.Alert_Level || k.Status})${dateStr}`
        })
        .slice(0, 8)

      const findingsEvidence = domainFindings
        .sort((a, b) => (b.priority === 'high' ? 1 : 0) - (a.priority === 'high' ? 1 : 0))
        .map(f => {
          const recurringLabel = f.status === 'recurring' ? ' [سلبية متكررة في أكثر من مرور]' : ''
          return `• [${f.departments?.name || 'عام'}]: ${f.original_text} (معرف: ${f.id})${recurringLabel}`
        })
        .slice(0, 8)

      const ovrsEvidence = domainOvrs
        .slice(0, 5)
        .map(o => `• [${o.date || 'بلاغ'} - ${o.subcategory || 'حدث'}]: ${o.description.length > 130 ? o.description.slice(0, 130) + '...' : o.description}`)

      // Distinct primary department for this cluster
      const deptCounts = {}
      for (const f of domainFindings) {
        const dName = f.departments?.name || 'عام'
        deptCounts[dName] = (deptCounts[dName] || 0) + 1
      }
      const primaryDept = Object.keys(deptCounts).sort((a, b) => deptCounts[b] - deptCounts[a])[0] || 'القسم المعني'

      const problemId = `prob-${hospital.code || 'hosp'}-${domain.id.toLowerCase().replace(/_/g, '-')}`

      clusters.push({
        problem_id: problemId,
        domain_id: domain.id,
        domain_name: domain.name,
        category: domain.category,
        primary_department: primaryDept,
        gahar_standard: domain.gaharStandard,
        score: totalScore,
        source_count: sourceCount,
        is_triple_corroborated: sourceCount === 3,
        corroboration_level: corroborationLevel,
        project_scale: projectScale,
        findings_count: domainFindings.length,
        kpis_count: domainKpis.length,
        ovr_count: domainOvrs.length,
        findings: domainFindings,
        deficient_kpis: structuredKpis,
        ovrs: domainOvrs,
        critical_kpis_evidence: critKpisEvidence,
        correlating_findings_evidence: findingsEvidence,
        ovr_incidents_evidence: ovrsEvidence
      })
    }

    // Sort by evidence score descending
    clusters.sort((a, b) => b.score - a.score)
    const primaryCrisis = clusters[0] || null

    return {
      hospital: {
        id: hospital.id,
        name: hospital.name,
        code: hospital.code,
        matchedSheetName
      },
      stats: {
        totalFindings: findings?.length || 0,
        eligibleFindings: eligibleFindings.length,
        totalSheetKpis: sheetKpis.length,
        criticalSheetKpis: activeDeficientKpis.length,
        totalOvrRecords: eligibleOvrRecords.length
      },
      eligible_crises: clusters,
      primary_crisis: primaryCrisis,
      all_domains_ranked: clusters
    }
  }

  // 9. AI Generation: Single-Pass Structured Engine Backed by Code Verification & Anchoring
  async generateProjectsForHospital(hospitalId, options = {}) {
    const isDryRun = Boolean(options.dryRun)

    // Step A: Perform full integrated evidence clustering
    const crisisAnalysis = await this.analyzeHospitalCrisis(hospitalId)
    const hospital = crisisAnalysis.hospital
    const eligibleCrises = crisisAnalysis.eligible_crises || []

    if (eligibleCrises.length === 0) {
      throw new Error('لا توجد أدلة سريرية أو رقمية كافية حالياً لتبرير مشروع تحسين مؤسسي بالمستشفى. يُكتفى بالإجراءات التصحيحية الفورية (CAPA) وتحديث مؤشرات الأداء.')
    }

    // Strictly generate up to 3 major projects, 1 per distinct problem cluster
    const count = Math.min(options.count || 3, eligibleCrises.length)
    const selectedCrises = eligibleCrises.slice(0, count)

    // Step B: Build verified ground-truth dossier with auditable IDs and genuine units
    const groundTruthDossier = selectedCrises.map((c, idx) => {
      const kpiLines = (c.critical_kpis_evidence || []).map(k => `  ${k}`)
      const ovrLines = c.ovr_count > 0
        ? `  • إجمالي ${c.ovr_count} بلاغ فعلي مسجل لهذا المسار:\n${(c.ovr_incidents_evidence || []).join('\n')}`
        : '  • لا توجد بلاغات OVR مسجلة لهذا المسار'
      const findingLines = c.findings_count > 0
        ? `  • إجمالي ${c.findings_count} ملاحظة وسلبية ميدانية مرصودة:\n${(c.correlating_findings_evidence || []).join('\n')}`
        : '  • لا توجد سلبيات ميدانية مرصودة'

      return `
======================================================================
المشكلة رقم (${idx + 1}): [${c.domain_name}]
- المعرف الثابت (problem_id): "${c.problem_id}"
- التصنيف: ${c.category}
- القسم الأساسي: ${c.primary_department}
- معيار الاعتماد: ${c.gahar_standard}
- حجم ونطاق المشروع: ${c.project_scale === 'FLAGSHIP_INSTITUTIONAL' ? 'مشروع تحسين مؤسسي كبرى (Flagship QIP)' : 'مشروع تحسين مركّز ومحدد (Focused QIP)'}
- مستوى الإثبات: ${c.corroboration_level} (مجموع النقاط: ${c.score})

أرقام ومؤشرات الأداء الثابتة (Ground Truth - احتفظ بالوحدة الحقيقية كما هي):
${kpiLines.length > 0 ? kpiLines.join('\n') : '  • لا توجد مؤشرات رقمية بالشيت لهذا المسار'}

الأدلة الميدانية وبلاغات الطاقم الموثقة:
${findingLines}
${ovrLines}
======================================================================`
    }).join('\n')

    console.log(`[ImprovementProjectsService] Generating grounded quality projects for: ${hospital.name} (${selectedCrises.length} problems, dryRun=${isDryRun})...`)

    // Step C: Single High-Fidelity Structured LLM Prompt
    const systemPrompt = `أنت خبير معتمد في جودة الرعاية الصحية وإدارة الأداء وفق معايير الاعتماد الوطنية (GAHAR) ومعهد تحسين الرعاية الصحية (IHI).
مهمتك صياغة ميثاق مشاريع تحسين جودة واقعية لمستشفى (${hospital.name}) استناداً بدقة إلى ملف الأدلة الحقيقي المرفق.

قواعد إلزامية حاسمة:
1. المطابقة الصارمة لكل مشكلة:
   - يجب إرجاع مشروع واحد لكل مشكلة محددة في ملف الأدلة.
   - يجب ربط كل مشروع بـ problem_id المطابق للمشكلة في ملف الأدلة بالضبط.
   - يُمنع منعاً باتاً دمج مسارين متباينين في نفس المشروع.
2. عدم اختلاق أدلة أو خطوط أساس (Ground-Truth Integrity):
   - يُمنع اختلاق بلاغات OVR أو مؤشرات شيت إذا لم تكن موجودة للمسار.
   - إذا توفرت السلبيات الميدانية فقط، صرّح بأن المشروع مبني على المرور الميداني وسلبيات التفتيش فقط.
   - احتفظ بالقيم الحقيقية للـ KPIs ووحداتها الصحيحة (أيام، %، عدد). لا تحول الأيام إلى نسبة مئوية أبداً.
3. التمييز بين CAPA ومشاريع الجودة:
   - لا تصنع مشروعاً لإصلاح سلبية ورقية واحدة تافهة.
   - اجعل المشروع إعادة هندسة لمسار العمل وتطبيق آليات فيزيائية وإجرائية مانعة للخطأ (Checklists, Independent Dual Verification, Visual Controls).
4. حظر الحلول البرمجية الخيالية (No IT Fantasies):
   - المستشفيات الحكومية لا تملك أنظمة ربط API أو برمجيات مخصصة LIMS. التدخلات يجب أن تكون مسارات عمل إكلينيكية وتمريضية وإدارية قابلة للتنفيذ غداً.
5. المسمى الوظيفي فقط (Job Roles Only - NO Human Names):
   - ممنوع كتابة أسماء أشخاص حقيقيين أو وهميين (مثل د. فلان).
   - اكتب المسمى الوظيفي الإكلينيكي أو التمريضي الرسمي فقط (مثلاً: رئيس قسم الصيدلة بالمستشفى، رئيس قسم الاستقبال والطوارئ، مشرفة تمريض القسم).
6. صيغة الإخراج: JSON فقط ومصفوفة "projects" تحتوي على المشاريع المقترحة.`

    const userPrompt = `ملف الأدلة المعتمد لمستشفى (${hospital.name}):
${groundTruthDossier}

صغ ميثاق المشاريع بصيغة JSON التالية بدقة:
{
  "projects": [
    {
      "problem_id": "نفس المعرف الثابت المذكور للمشكلة في الملف",
      "title": "عنوان المشروع السريري الرصين والمحدد",
      "department_name": "القسم المعني",
      "category": "تصنيف المشروع",
      "priority": "high",
      "why_hard_to_solve": "شرح لماذا المشكلة مستعصية ولا تُحل بالتدريب البسيط وما هي عوائق مسار العمل",
      "root_cause_analysis": "تحليل الأسباب الجذرية النظامية للخلل في مسار العمل",
      "problem_statement": "بيان المشكلة يربط الأدلة الحقيقية دون اختلاق",
      "smart_goal": "الهدف الذكي القابل للقياس وموعد الإنجاز المستهدف",
      "evidence_reference": "اسم معيار GAHAR المعني",
      "target_duration_weeks": 12,
      "interventions": [
        {
          "step": "خطوة إجرائية فيزيائية أو إكلينيكية محددة",
          "responsible": "المسمى الوظيفي الرسمي المسؤول",
          "duration": "أسبوعان"
        }
      ],
      "project_lead": "المسمى الوظيفي الرسمي لقائد المشروع فقط",
      "team_members": ["مسمى وظيفي 1", "مسمى وظيفي 2", "مسمى وظيفي 3", "مسمى وظيفي 4"]
    }
  ]
}`

    const completion = await callGroqWithRetry({
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.15,
      max_tokens: 3500
    })

    const rawContent = completion.choices?.[0]?.message?.content || '{}'
    let parsed
    try {
      parsed = JSON.parse(rawContent)
    } catch (e) {
      throw new Error(`فشل استلام تنسيق JSON صحيح من نموذج الذكاء الاصطناعي: ${e.message}`)
    }

    const generatedProjects = Array.isArray(parsed.projects) ? parsed.projects : []
    if (generatedProjects.length === 0) {
      throw new Error('لم يقم الذكاء الاصطناعي بتوليد أي مشروع تحسين مطابق لملف الأدلة.')
    }

    console.log(`[ImprovementProjectsService] Generation successful. Anchoring ${generatedProjects.length} projects to ground-truth evidence...`)

    // Step D: Deterministic Post-Processing Anchor (Match by explicit problem_id, NEVER by index [idx])
    const anchoredProjects = []

    for (const genProj of generatedProjects) {
      // Find matching cluster by problem_id first, then by domain_id
      const cluster = selectedCrises.find(c => c.problem_id === genProj.problem_id) ||
                      selectedCrises.find(c => c.domain_id === genProj.category || c.domain_name === genProj.title) ||
                      selectedCrises[0]

      if (!cluster) continue

      const deptName = genProj.department_name || cluster.primary_department || 'عام'
      const category = genProj.category || cluster.category || 'سلامة المرضى'

      // 1. Anchor auditable evidence references
      const evidenceReferences = {
        problem_id: cluster.problem_id,
        domain_id: cluster.domain_id,
        finding_ids: cluster.findings.map(f => f.id),
        sheet_kpis: cluster.deficient_kpis.map(k => ({
          indicator: k.Indicator,
          value: k.Value,
          unit: k.unit,
          alert_level: k.Alert_Level,
          status: k.Status,
          year: k.Year,
          month: k.Month,
          display: k.formatted
        })),
        ovr_ids: cluster.ovrs.map(o => o.id || o.ovr_id).filter(Boolean)
      }

      // 2. Anchor baseline_metrics text from genuine sources only
      const baselineSnippets = []
      if (cluster.deficient_kpis.length > 0) {
        baselineSnippets.push(`مؤشرات شيت جوجل: ${cluster.deficient_kpis.map(k => {
          const dateStr = (k.Year && k.Month) ? ` (${k.Year}/${k.Month})` : ''
          return `${k.Indicator}: ${k.formatted}${dateStr}`
        }).join(' | ')}`)
      }
      if (cluster.ovrs.length > 0) {
        baselineSnippets.push(`بلاغات OVR: ${cluster.ovrs.length} بلاغ فعلي مسجل`)
      }
      if (cluster.findings.length > 0) {
        baselineSnippets.push(`المرور الميداني: ${cluster.findings.length} سلبية مرصودة`)
      }
      const baselineMetricsText = baselineSnippets.join(' • ') || 'مبني على المرور الميداني وسلبيات التفتيش الموثقة'

      // 3. Anchor KPIs with genuine values and realistic targets (No blind 95%!)
      const anchoredKpis = cluster.deficient_kpis.map(k => {
        let realisticTarget = 'تحسين ملحوظ'
        const val = parseFloat(k.Value) || 0
        if (k.unit === '%') {
          if (k.Indicator.includes('وفيات') || k.Indicator.includes('عدوى') || k.Indicator.includes('أخطاء') || k.Indicator.includes('معطلة')) {
            realisticTarget = `خفض النسبة إلى أقل من ${Math.max(0, Math.round(val * 0.5))}%`
          } else if (k.Indicator.includes('أعطال')) {
            realisticTarget = 'خفض معدل الأعطال إلى أقل من 3%'
          } else {
            realisticTarget = 'رفع نسبة الامتثال إلى 90%'
          }
        } else if (k.unit === 'أيام') {
          realisticTarget = `خفض المعدل إلى أقل من ${Math.max(1, Math.round(val - 1))} أيام`
        } else if (k.unit === 'عدد') {
          realisticTarget = 'تفعيل مستمر وفق الخطة التشغيلية'
        }
        return {
          name: k.Indicator,
          type: k.Indicator.includes('وفيات') || k.Indicator.includes('عدوى') ? 'outcome' : 'process',
          baseline: k.formatted,
          target: realisticTarget,
          frequency: 'شهري',
          date: (k.Year && k.Month) ? `${k.Year}/${k.Month}` : null
        }
      })

      if (cluster.ovrs.length > 0) {
        anchoredKpis.push({
          name: `معدل إغلاق بلاغات OVR (${cluster.domain_name})`,
          type: 'process',
          baseline: `${cluster.ovrs.length} بلاغ فعلي مسجل`,
          target: 'صفر أخطاء ضارة وحوادث جسيمة مع إغلاق 100% من البلاغات خلال 48 ساعة',
          frequency: 'شهري'
        })
      }

      if (cluster.findings.length > 0) {
        anchoredKpis.push({
          name: `نسبة إغلاق سلبيات المرور (${cluster.domain_name})`,
          type: 'process',
          baseline: `${cluster.findings.length} سلبية مرصودة`,
          target: 'إغلاق وتصحيح 100% من السلبيات المرصودة',
          frequency: 'شهري'
        })
      }

      // 4. Anchor forensic corroboration (True existence only, no hallucinations)
      const forensicCorroboration = {
        corroboration_level: cluster.corroboration_level,
        source_1_field_finding: cluster.findings.length > 0
          ? cluster.findings.slice(0, 3).map(f => `[${f.departments?.name || 'عام'}]: ${f.original_text}`).join(' | ')
          : null,
        source_2_sheet_kpi: cluster.deficient_kpis.length > 0
          ? cluster.deficient_kpis.slice(0, 3).map(k => `${k.Indicator}: ${k.formatted}`).join(' | ')
          : null,
        source_3_staff_ovr: cluster.ovrs.length > 0
          ? cluster.ovrs.slice(0, 2).map(o => `[${o.date || 'بلاغ'}]: ${o.description}`).join(' | ')
          : null
      }

      // 5. Sanitize leadership and team roles
      const projectLead = sanitizeClinicalLead(genProj.project_lead, deptName, category)
      const teamMembers = sanitizeClinicalTeamMembers(genProj.team_members, deptName, category)

      // 6. Sanitize interventions (no IT fantasies)
      const sanitizedInterventions = (genProj.interventions || []).map(it => {
        let step = typeof it === 'string' ? it : (it.step || '')
        let responsible = typeof it === 'object' && it.responsible
          ? sanitizeResponsibleRole(it.responsible, deptName, category)
          : `رئيس قسم ${deptName} ومشرفة التمريض`

        if (step.includes('API') || step.includes('Sync Engine') || step.includes('LIMS v2.0') || step.includes('تطبيق إلكتروني')) {
          step = 'تطبيق آلية التحقق المزدوج المستقل (Independent Dual Verification) وسجلات المطابقة الإلزامية قبل كل إجراء'
        }
        if (step.includes('قفل منطقي في CPOE') || step.includes('CPOE')) {
          step = 'تطبيق قائمة التحقق السريرية الإجبارية ومطابقة الهوية الثنائية قبل تنفيذ الإجراء'
        }
        return typeof it === 'string' ? step : { ...it, step, responsible }
      })

      // 7. Calculate Target Completion Date
      const durationWeeks = genProj.target_duration_weeks || 12
      const targetDate = new Date()
      targetDate.setDate(targetDate.getDate() + (durationWeeks * 7))

      // 8. Assemble Full Project Record
      const projectRecord = {
        id: crypto.randomUUID(),
        hospital_id: hospital.id,
        hospital_name: hospital.name,
        problem_id: cluster.problem_id,
        title: genProj.title || `مشروع تحسين: ${cluster.domain_name}`,
        department_name: deptName,
        category,
        priority: genProj.priority || 'high',
        status: 'draft',
        problem_statement: genProj.problem_statement || `تحسين مسار ${cluster.domain_name} بناءً على المؤشرات والسلبيات المرصودة`,
        baseline_metrics: baselineMetricsText,
        smart_goal: genProj.smart_goal || `تحسين مؤشرات ${cluster.domain_name} خلال ${durationWeeks} أسبوعاً`,
        evidence_reference: genProj.evidence_reference || cluster.gahar_standard,
        target_completion_date: targetDate.toISOString().split('T')[0],
        estimated_duration_weeks: durationWeeks,
        kpis: anchoredKpis,
        interventions: sanitizedInterventions,
        project_lead: projectLead,
        team_members: teamMembers,
        linked_findings_summary: cluster.findings.slice(0, 8).map(f => f.original_text),
        prioritization_matrix: {
          patient_safety_risk: Math.min(5, Math.max(3, Math.ceil(cluster.score / 25))),
          volume_frequency: Math.min(5, Math.max(2, cluster.findings_count)),
          process_complexity: 4,
          strategic_alignment: 5,
          total_score: Math.min(20, Math.max(14, Math.round(cluster.score / 10))),
          eligibility_justification: `أولوية تحسين معتمدة مبنية على ${cluster.corroboration_level}.`
        },
        why_hard_to_solve: genProj.why_hard_to_solve || 'تتطلب معالجة السبب الجذري إعادة هندسة مسار العمل وضوابط فيزيائية وإجرائية مستمرة.',
        root_cause_analysis: genProj.root_cause_analysis || 'تعدد خطوات الإجراء وضعف الرقابة المزدوجة أثناء تسليم الحالات وتنفيذ التدابير.',
        forensic_corroboration: forensicCorroboration,
        evidence_references: evidenceReferences,
        directorate_notes: `مشروع تحسين جودة مؤسسي معتمد ومبني على الأدلة (${cluster.corroboration_level})`
      }

      if (!isDryRun) {
        const saved = await this.saveProject(projectRecord)
        anchoredProjects.push(saved)
      } else {
        anchoredProjects.push(projectRecord)
      }
    }

    return anchoredProjects
  }
}
