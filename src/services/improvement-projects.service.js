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
  if (norm.includes('دوران السرير') || norm.includes('مدة الإقامة') || norm.includes('مدة الاقامة') || norm.includes('أيام') || norm.includes('ايام') || norm.includes('بالأيام') || norm.includes('يوم')) {
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
  const val = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '').replace(',', '.'))
  if (!Number.isFinite(val)) return 'القيمة غير متاحة'
  if (unit === '%') return `${val}%`
  if (unit === 'أيام') return `${val} أيام`
  if (unit === 'ساعات') return `${val} ساعة`
  if (unit === 'دقيقة') return `${val} دقيقة`
  if (unit === 'عدد') return `${val}`
  return unit ? `${val} ${unit}`.trim() : `${val}`
}

export function getKpiPolarity(indicatorName = '') {
  const norm = normalizeClinicalText(indicatorName)
  const normalizedPatterns = patterns => patterns.map(normalizeClinicalText)
  const errorPatterns = normalizedPatterns(['أخطاء', 'خطأ', 'ممنوع', 'ممنوعة', 'غير مكتمل', 'عدم الالتزام'])
  const positiveProcessPatterns = normalizedPatterns([
    'الالتزام', 'استكمال', 'اكتمال', 'التعريف الصحيح', 'تغطية التطعيم', 'نسبة التطعيم', 'تطعيمات فيروس'
  ])
  const explicitlyHarmful = errorPatterns.some(p => norm.includes(p))
  // Compliance/completion indicators remain higher-is-better even when their
  // label names the harm they screen for (e.g. pressure-ulcer risk assessment).
  if (!explicitlyHarmful && positiveProcessPatterns.some(p => norm.includes(p))) {
    return 'HIGHER_IS_BETTER'
  }
  // Negative indicators: 0 is target achieved / desirable, higher values are harmful
  const negativePatterns = [
    'وفيات', 'وفاة', 'عدوى', 'وخز', 'أخطاء', 'اخطاء', 'سقوط', 'قرح', 'جلطات',
    'توصيل خاطئ', 'انتهاكات', 'أعطال', 'اعطال', 'معطلة', 'معطله', 'شكاوى', 'شكاوي',
    'إعادة دخول', 'اعادة دخول', 'انتظار', 'زمن', 'وقت', 'مدة', 'تأخير', 'تاخير',
    'دوران السرير', 'مدة الإقامة', 'مدة البقاء', 'اختصارات ممنوعة', 'اختصارات الممنوعة',
    'الاختصارات الطبية الممنوعة', 'الاختصارات الممنوعة', 'ممنوع'
  ]
  if (negativePatterns.some(p => norm.includes(normalizeClinicalText(p)))) {
    return 'LOWER_IS_BETTER'
  }
  return 'HIGHER_IS_BETTER'
}

function getValidatedSourceTarget(indicatorName, baseline, target) {
  if (target === null || target === undefined || String(target).trim() === '') return null
  const baselineValue = Number.parseFloat(String(baseline ?? '').replace(',', '.'))
  const targetMatch = String(target).replace(',', '.').match(/-?\d+(?:\.\d+)?/)
  if (!Number.isFinite(baselineValue) || !targetMatch) return null
  const targetValue = Number.parseFloat(targetMatch[0])
  const improves = getKpiPolarity(indicatorName) === 'LOWER_IS_BETTER'
    ? targetValue < baselineValue
    : targetValue > baselineValue
  return improves ? String(target).trim() : null
}

export function isDeficientKpi(k) {
  if (!k || !k.Indicator) return false
  const alert = normalizeClinicalText(k.Alert_Level || '')
  const status = normalizeClinicalText(k.Status || '')
  const hasValue = k.Value !== null && k.Value !== undefined && String(k.Value).trim() !== ''
  const val = hasValue ? Number.parseFloat(String(k.Value).replace(',', '.')) : Number.NaN
  const polarity = getKpiPolarity(k.Indicator)

  // 1. Explicit normal, good, or OK
  if (['normal', 'good', 'ok', 'target achieved'].includes(alert) ||
      ['normal', 'good', 'ok', 'target achieved'].includes(status)) {
    return false
  }

  // 2. If LOWER_IS_BETTER and value is 0, it is TARGET ACHIEVED / EXCELLENT (never a deficiency)
  if (Number.isFinite(val) && polarity === 'LOWER_IS_BETTER' && val === 0) {
    return false
  }

  // 3. If HIGHER_IS_BETTER and value is 0, it IS A SEVERE DEFICIENCY (e.g. 0% compliance, 0% verbal orders, 0% repairs)
  if (Number.isFinite(val) && polarity === 'HIGHER_IS_BETTER' && val === 0) {
    return true
  }

  // 4. An explicit risk state from sheet source
  if (['critical', 'alert'].includes(alert) || status === 'risk') return true

  // 5. Missing or malformed values are unknown, not zero
  if (!Number.isFinite(val)) return false

  return false
}

function normalizeClinicalText(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u065F\u0640]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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

// Split broad accreditation domains into the actual operational problem so a
// single charter cannot combine unrelated workstreams just because they share
// -------------------------------------------------------------
// Comprehensive, Fine-Grained Operational Problem Tracks (Strictly Unbundled)
// Each problem is a cohesive clinical/operational challenge with a single focus
// -------------------------------------------------------------
export const OPERATIONAL_PROBLEMS = [
  // --- Medication Safety Tracks (Strictly Unbundled) ---
  {
    id: 'crash-cart-readiness',
    domainId: 'MEDICATION_SAFETY_MANAGEMENT',
    name: 'جاهزية عربات الإنعاش القلبي الرئوي وأدوية الطوارئ',
    category: 'إدارة واستخدام الدواء والرعاية الحرجة (MMU/ECC)',
    gaharStandard: 'معايير إدارة واستخدام الدواء والرعاية الحرجة (GAHAR MMU.04 - ECC.03)',
    findingKeywords: ['كراش كار', 'كراش كارت', 'عربة الانعاش', 'عربة الإنعاش', 'شيك ليست لمرور الصيدلي', 'مرور الصيدلي على الكراش', 'ادويه الكراش', 'أدوية الكراش', 'سجل سي بي ار', 'محاضر فتح للكراش'],
    deptKeywords: ['غسيل كلوي', 'طوارئ', 'استقبال', 'عناية', 'باطنة', 'أطفال'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('عربات الإنعاش') || ind.includes('عربة الإنعاش') || ind.includes('كراش كارت')
    },
    ovrMatch: o => {
      const t = o.toLowerCase()
      return (t.includes('كراش') || t.includes('إنعاش') || t.includes('crash cart')) && !t.includes('سقوط')
    },
    primaryMetricTemplate: {
      name: 'نسبة اكتمال وجاهزية عربات الإنعاش وسجلات التفتيش الدوري بوحدة الغسيل الكلوي',
      unit: '%',
      defaultTarget: '100%'
    }
  },
  {
    id: 'vaccine-cold-chain',
    domainId: 'MEDICATION_SAFETY_MANAGEMENT',
    name: 'حوكمة تواريخ فتح فايلات التطعيمات وضمان ثبات سلسلة التبريد',
    category: 'إدارة واستخدام الدواء ومكافحة العدوى (MMU/IPC)',
    gaharStandard: 'معايير إدارة واستخدام الدواء ومكافحة العدوى (GAHAR MMU.03 - IPC.04)',
    findingKeywords: ['تاريخ الانتهاء بعد الفتح', 'فايلات التطعيمات', 'ثبات التطعيمات بعد الفتح', 'تطعيمات بعد الفتح', 'تطعيم بعد الفتح'],
    deptKeywords: ['غسيل كلوي', 'أطفال', 'مبتسرين', 'صيدلية'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('تطعيمات فيروس b') || ind.includes('سلسلة التبريد للتطعيمات')
    },
    ovrMatch: o => {
      const t = o.toLowerCase()
      return (t.includes('تطعيم') || t.includes('لقاح') || t.includes('vaccine')) && (t.includes('فتح') || t.includes('صلاحية') || t.includes('تبريد'))
    },
    primaryMetricTemplate: {
      name: 'نسبة الالتزام بتدوين تاريخ وساعة الفتح على فايلات التطعيمات متعددة الجرعات (Open Vial Policy)',
      unit: '%',
      defaultTarget: '100%'
    }
  },
  {
    id: 'medication-storage-refrigeration',
    domainId: 'MEDICATION_SAFETY_MANAGEMENT',
    name: 'معايير التخزين الآمن للأدوية والثلاجات وسلسلة التبريد الدوائي',
    category: 'إدارة واستخدام الدواء (MMU)',
    gaharStandard: 'معايير سلامة التخزين الدوائي وسلسلة التبريد (GAHAR MMU.02)',
    findingKeywords: ['تكدس بالادويه في الثلاجه', 'تكدس بالأدوية في الثلاجة', 'كراتين في الثلاجه', 'كراتين في الثلاجة', 'ثلاجة الادوية', 'ثلاجه الادويه', 'سلسلة التبريد', 'درجات حرارة الثلاجة'],
    deptKeywords: ['صيدلية', 'كشك الادوية', 'تمريض'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('ثلاجات الأدوية') || ind.includes('سلسلة التبريد')
    },
    ovrMatch: o => {
      const t = o.toLowerCase()
      return t.includes('ثلاجة أدوية') || t.includes('تلف دواء بالثلاجة') || t.includes('انقطاع تبريد')
    },
    primaryMetricTemplate: {
      name: 'نسبة الالتزام بالمعايير القياسية لتخزين الأدوية بالثلاجات وفصل الكراتين ومتابعة درجات الحرارة',
      unit: '%',
      defaultTarget: '100%'
    }
  },
  {
    id: 'prescribing-dosage-safety',
    domainId: 'MEDICATION_SAFETY_MANAGEMENT',
    name: 'سلامة الوصفات الدوائية والحد من أخطاء الجرعات والبيانات الناقصة',
    category: 'إدارة واستخدام الدواء (MMU)',
    gaharStandard: 'إطار استرشادي: معايير كتابة ومراجعة وصرف الوصفات والجرعات (GAHAR MMU.04 - MMU.05 استرشادي)',
    findingKeywords: [
      'روشت', 'وصفات', 'وصفة', 'الوصفه الطبيه', 'الوصفة الطبية', 'جرعات الادوية غير مكتوبه',
      'جرعات الأدوية غير مكتوبة', 'جرعة غير مكتوبة', 'نقص بيانات الوصفة', 'وصفة غير مكتملة',
      'جرعات الادوية', 'جرعات الأدوية', 'الوصفه الطبيه في بعض التذاكر غير مكتمله'
    ],
    deptKeywords: ['صيدلية', 'عيادات', 'تذاكر العيادات', 'تذاكر الاستقبال', 'داخلي'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('أخطاء الوصفات') || ind.includes('الوصفات الدوائية') || ind.includes('الوصفات الطبية') || ind.includes('الوصفات')
    },
    ovrMatch: o => {
      const t = o.toLowerCase()
      return (t.includes('خطأ دوائي') || t.includes('جرعة') || t.includes('وصفة') || t.includes('صرف دواء') || t.includes('روشتة')) && !t.includes('كراش')
    },
    primaryMetricTemplate: {
      name: 'نسبة أخطاء الوصفات الدوائية والجرعات في تذاكر المرضى والعيادات',
      unit: '%',
      defaultTarget: 'أقل من 5%'
    }
  },

  // --- Patient Safety Tracks (Strictly Unbundled) ---
  {
    id: 'critical-results-reporting',
    domainId: 'PATIENT_SAFETY_GOVERNANCE_CRITICAL_RESULTS',
    name: 'حوكمة وسرعة إبلاغ النتائج الحرجة والإنذارات السريرية',
    category: 'سلامة المرضى والأهداف الوطنية (NPSG)',
    gaharStandard: 'إطار استرشادي: متطلبات السلامة الوطنية - التواصل الفعال والنتائج الحرجة (GAHAR NSR.02 / NPSG.02 استرشادي)',
    findingKeywords: ['النتائج الحرجه', 'النتائج الحرجة', 'دفتر النتائج الحرجه', 'قائمه بالنتائج الحرجه', 'قائمة بالنتائج الحرجة', 'انذارات حرجه', 'إنذارات حرجة'],
    deptKeywords: ['معمل', 'مختبر', 'غسيل كلوي', 'رعاية', 'طوارئ'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('النتائج الحرجة') || ind.includes('الإنذارات الحرجة')
    },
    ovrMatch: o => {
      const t = o.toLowerCase()
      // Strict Evidence Rule: Incident must describe an actual breakdown in reporting, communication, or documentation,
      // NOT a clinical complication or vital-sign variation managed normally (e.g. hypotension given saline)
      const hasReportingBreakdown = t.includes('تأخر') || t.includes('تاخر') || t.includes('لم يتم إبلاغ') ||
        t.includes('لم يتم ابلاغ') || t.includes('عدم إبلاغ') || t.includes('عدم ابلاغ') ||
        t.includes('عدم توثيق') || t.includes('لم يتم توثيق') || t.includes('لم يخطر') ||
        t.includes('تأخير في النتيجة') || t.includes('panic value') || t.includes('read back') ||
        t.includes('فشل إبلاغ') || t.includes('سقوط اتصال')
      const hasCriticalContext = t.includes('حرجة') || t.includes('حرجه') || t.includes('إنذار حرج') || t.includes('انذار حرج') || t.includes('critical result')
      return hasCriticalContext && hasReportingBreakdown
    },
    primaryMetricTemplate: {
      name: 'معدل إبلاغ وتوثيق النتائج الحرجة وإعادة التلاوة (Read-Back) خلال الإطار الزمني المعتمد',
      unit: '%',
      defaultTarget: '100%'
    }
  },
  {
    id: 'patient-identification-safety',
    domainId: 'PATIENT_SAFETY_GOVERNANCE_CRITICAL_RESULTS',
    name: 'التحقق الصارم من هوية المريض بالأساور والبيانات الثنائية',
    category: 'سلامة المرضى والأهداف الوطنية (NPSG)',
    gaharStandard: 'إطار استرشادي: متطلبات السلامة الوطنية - التعريف الصحيح للمريض (GAHAR NSR.01 / NPSG.01 استرشادي)',
    findingKeywords: [
      'تعريف المريض', 'اسوره', 'اساور', 'هويه المريض', 'هوية المريض', 'بدون تعريف للمريض',
      'نماذج في الملف الطبي بدون تعريف', 'اسم المرضى على العينات', 'اسم المريض على العينة',
      'كتابة اسم المرضى على العينات'
    ],
    deptKeywords: ['طوارئ', 'داخلي', 'غسيل كلوي', 'حضانات', 'عمليات', 'معمل', 'مختبر'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('التعريف الصحيح للمريض') || ind.includes('أخطاء في عناصر الرعاية المرتبطة بالتعريف')
    },
    ovrMatch: o => {
      const t = o.toLowerCase()
      return t.includes('هوية المريض') || t.includes('اسورة') || t.includes('خطأ في اسم المريض') || t.includes('wrong patient')
    },
    primaryMetricTemplate: {
      name: 'معدل الالتزام بالتعريف الصحيح للمريض باستخدام معرّفين اثنين (الاسم الرباعي والرقم الطبي)',
      unit: '%',
      defaultTarget: '100%'
    }
  },
  {
    id: 'patient-fall-prevention',
    domainId: 'PATIENT_SAFETY_GOVERNANCE_CRITICAL_RESULTS',
    name: 'الوقاية من سقوط المرضى وتفعيل بروتوكول تقييم المخاطر',
    category: 'سلامة المرضى والأهداف الوطنية (NPSG)',
    gaharStandard: 'معايير الأهداف الوطنية لسلامة المرضى - خفض مخاطر السقوط (GAHAR NPSG.06)',
    findingKeywords: ['سقوط المرضى', 'سقوط مريض', 'مقياس مورس', 'تقييم مخاطر السقوط', 'morse fall'],
    deptKeywords: ['داخلي', 'مسنين', 'عظام', 'رعاية'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('سقوط المرضى') || ind.includes('معدل سقوط المرضى')
    },
    ovrMatch: o => {
      const t = o.toLowerCase()
      return t.includes('سقوط مريض') || t.includes('سقوط من السرير') || t.includes('patient fall')
    },
    primaryMetricTemplate: {
      name: 'معدل تقييم مخاطر السقوط للمرضى الداخليين وتطبيق تدابير الحماية المعتمدة',
      unit: '%',
      defaultTarget: '100%'
    }
  },

  // --- Documentation & Medical Records Tracks (Strictly Unbundled) ---
  {
    id: 'prohibited-abbreviations',
    domainId: 'MEDICAL_RECORDS_CLINICAL_DOCUMENTATION',
    name: 'الحد من الاختصارات الطبية الممنوعة وغير المعتمدة في التوثيق السريري',
    category: 'إدارة المعلومات والسجلات الطبية (MRM)',
    gaharStandard: 'إطار استرشادي: معايير إدارة السجلات الطبية وحظر الاختصارات الخطرة (GAHAR MRM.03 استرشادي)',
    findingKeywords: [
      'قائمه الاختصارات', 'قائمة الاختصارات', 'اختصارات ورموز في الملف الطبي', 'اختصارات ف التذكره',
      'اختصارات بالملف الطبي', 'اختصارات طبية ممنوعة', 'اختصارات ممنوعة', 'اختصارات غير معتمدة',
      'اختصارات', 'اختصار'
    ],
    deptKeywords: ['غسيل كلوي', 'عيادات', 'تذاكر العيادات', 'حضانات', 'سجلات', 'داخلي'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('الاختصارات الطبية الممنوعة') || ind.includes('اختصارات طبية ممنوعة') || ind.includes('الاختصارات')
    },
    ovrMatch: o => {
      const t = o.toLowerCase()
      return t.includes('اختصار ممنوع') || t.includes('غموض في الاختصار') || t.includes('prohibited abbreviation')
    },
    primaryMetricTemplate: {
      name: 'معدل خفض استخدام الاختصارات الطبية الممنوعة في التوثيق السريري',
      unit: '%',
      defaultTarget: 'أقل من 10%'
    }
  },
  {
    id: 'record-completeness-signatures',
    domainId: 'MEDICAL_RECORDS_CLINICAL_DOCUMENTATION',
    name: 'اكتمال توثيق الملفات الطبية المفتوحة والتوقيعات الطبية النظامية',
    category: 'إدارة المعلومات والسجلات الطبية (MRM)',
    gaharStandard: 'إطار استرشادي: معايير اكتمال التوثيق السريري والتوقيعات المعتمدة (GAHAR MRM.01 - MRM.02 استرشادي)',
    findingKeywords: [
      'بدون توقيع للطبيب', 'توقيع بعض الاطباء فورمه', 'توقيع ثنائي', 'استكمال الملف الطبي',
      'الملف الطبي المفتوح', 'الملف الطبي المغلق', 'تذاكر بدون توقيع', 'بيانات ناقصة في التذكرة',
      'توقيع بعض الاطباء فورمه او ثنائي', 'توقيع الاطباء', 'توقيع الطبيب'
    ],
    deptKeywords: ['غسيل كلوي', 'سجلات', 'داخلي', 'عيادات'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('استكمال الملف الطبي') || ind.includes('الملف الطبي المفتوح') || ind.includes('الملف الطبي المغلق')
    },
    ovrMatch: o => {
      const t = o.toLowerCase()
      return t.includes('ملف غير مكتمل') || t.includes('تذكرة ناقصة') || t.includes('غياب توقيع الطبيب')
    },
    primaryMetricTemplate: {
      name: 'نسبة اكتمال تدوين البيانات والتوقيعات الطبية الثلاثية في الملفات الطبية المفتوحة',
      unit: '%',
      defaultTarget: '95%'
    }
  },
  {
    id: 'verbal-orders-governance',
    domainId: 'MEDICAL_RECORDS_CLINICAL_DOCUMENTATION',
    name: 'حوكمة وتوثيق الأوامر الشفهية والهاتفية (Read-Back Policy)',
    category: 'سلامة المرضى والتوثيق الطبي (NPSG/MRM)',
    gaharStandard: 'معايير التواصل الفعال وتوثيق الأوامر الشفهية (GAHAR NPSG.02 / MRM.04)',
    findingKeywords: ['اوامر شفهية', 'أوامر شفهية', 'اوامر شفوية', 'أمر هاتفي', 'أوامر هاتفية', 'read back'],
    deptKeywords: ['طوارئ', 'رعاية', 'داخلي', 'حضانات'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('الالتزام بتسجيل الأوامر الشفهية') || ind.includes('الأوامر الشفهية')
    },
    ovrMatch: o => {
      const t = o.toLowerCase()
      return t.includes('أمر شفهي') || t.includes('أمر هاتفي') || t.includes('telephone order')
    },
    primaryMetricTemplate: {
      name: 'نسبة الالتزام بتسجيل وإعادة تلاوة وتوثيق الأوامر الشفهية والتوقيع عليها خلال 24 ساعة',
      unit: '%',
      defaultTarget: '100%'
    }
  },

  // --- Environmental, Electrical & Facility Safety Tracks (Strictly Unbundled) ---
  {
    id: 'electrical-safety-hazards',
    domainId: 'FACILITY_ENVIRONMENTAL_ELECTRICAL_SAFETY',
    name: 'إزالة المخاطر الكهربائية والأسلاك المكشوفة وتأمين بيئة العمل',
    category: 'السلامة البيئية والمخاطر الهندسية (ENV)',
    gaharStandard: 'معايير السلامة البيئية والمخاطر الفيزيائية والكهربائية (GAHAR FMS.01 - FMS.03)',
    findingKeywords: ['اسلاك مكشوفه', 'أسلاك مكشوفة', 'كهرباء بعموم القسم', 'اسلاك على الارض', 'أسلاك على الأرض', 'خطر صعق', 'مفاتيح كهرباء مكشوفة', 'تمديدات كهربائية مكشوفة'],
    deptKeywords: ['الأشعة', 'المرافق', 'الإدارة الهندسية', 'السلامة البيئية'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('مخاطر كهربائية') || ind.includes('بيئة العمل')
    },
    ovrMatch: o => {
      const t = o.toLowerCase()
      return t.includes('ماس كهربائي') || t.includes('سلك مكشوف') || t.includes('صعق كهربائي') || t.includes('electrical')
    },
    primaryMetricTemplate: {
      name: 'نسبة إزالة وتأمين التمديدات والأسلاك الكهربائية المكشوفة وفق الكود الهندسي والسلامة المهنية',
      unit: '%',
      defaultTarget: '100%'
    }
  },
  {
    id: 'life-fire-safety',
    domainId: 'LIFE_AND_FIRE_SAFETY',
    name: 'الجاهزية للسلامة وحماية الأرواح ومكافحة الحريق وخطط الإخلاء',
    category: 'السلامة وحماية الأرواح (FMS - Life Safety)',
    gaharStandard: 'معايير حماية الأرواح والسلامة من الحريق وخطط الطوارئ (GAHAR FMS.04 - FMS.06)',
    findingKeywords: ['طفايه', 'طفاية', 'طفايات', 'حريق', 'حماية مدنية', 'اخلاء', 'إخلاء', 'كواشف دخان', 'معدات إطفاء', 'معدات الاطفاء', 'race & pass'],
    deptKeywords: ['السلامة والصحة المهنية', 'الحماية المدنية', 'الأمن والسلامة'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('حريق') || ind.includes('إخلاء') || ind.includes('اخلاء') || ind.includes('معدات الإطفاء') || ind.includes('كواشف الدخان')
    },
    ovrMatch: o => {
      const t = o.toLowerCase()
      return t.includes('حريق') || t.includes('إنذار حريق') || t.includes('طفاية') || t.includes('fire')
    },
    primaryMetricTemplate: {
      name: 'نسبة الجاهزية التشغيلية لمعدات الإطفاء ومطابقة اشتراطات الحماية المدنية ومعدل التدريب على الإخلاء',
      unit: '%',
      defaultTarget: '100%'
    }
  },
  {
    id: 'biomedical-equipment-maintenance',
    domainId: 'BIOMEDICAL_EQUIPMENT_MAINTENANCE',
    name: 'الجاهزية التشغيلية وصيانة ومعايرة الأجهزة الطبية الحيوية',
    category: 'تكنولوجيا وسلامة الأجهزة الطبية (BME)',
    gaharStandard: 'معايير إدارة وصيانة ومعايرة الأجهزة الطبية (GAHAR FMS.07 - FMS.08)',
    findingKeywords: ['أجهزة طبية', 'اجهزة طبية', 'صيانة أجهزة', 'معايرة أجهزة', 'عطل جهاز طبي', 'ترخيص أجهزة', 'عقود صيانة الأجهزة'],
    deptKeywords: ['الأجهزة الطبية', 'الهندسة الطبية', 'الصيانة الطبية'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('الأجهزة الطبية') || ind.includes('الاجهزة والاقسام المرخصة') || ind.includes('الأجهزة والأقسام المغطاة بعقود الصيانة')
    },
    ovrMatch: o => {
      const t = o.toLowerCase()
      return t.includes('عطل جهاز طبي') || t.includes('توقف جهاز') || t.includes('biomedical')
    },
    primaryMetricTemplate: {
      name: 'معدل إصلاح ومعايرة الأجهزة الطبية ونسبة التغطية بعقود الصيانة الوقائية والترخيص',
      unit: '%',
      defaultTarget: '90%'
    }
  },

  // --- Infection Control Tracks ---
  {
    id: 'safe-injections-sharps-safety',
    domainId: 'INFECTION_PREVENTION_CONTROL',
    name: 'ممارسات الحقن الآمن والوقاية من حوادث وخز الإبر والمهام الحادة',
    category: 'مكافحة ومنع انتشار العدوى (IPC)',
    gaharStandard: 'معايير مكافحة العدوى - الحقن الآمن والسلامة المهنية (GAHAR IPC.05)',
    findingKeywords: ['حقن امن', 'حقن آمن', 'وخز', 'صندوق امان', 'صندوق أمان', 'إعادة تغطية السن', 'recapping'],
    deptKeywords: ['مكافحة العدوى', 'داخلي', 'طوارئ', 'غسيل كلوي', 'معمل'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('الحقن الآمن') || ind.includes('الوخز بالإبر')
    },
    ovrMatch: o => {
      const t = o.toLowerCase()
      return t.includes('وخز إبرة') || t.includes('وخز سن') || t.includes('needle stick')
    },
    primaryMetricTemplate: {
      name: 'معدل الالتزام بمعايير الحقن الآمن وتفادي إعادة تغطية الإبر وخفض إصابات الوخز',
      unit: '%',
      defaultTarget: '95%'
    }
  },
  {
    id: 'ppe-compliance',
    domainId: 'INFECTION_PREVENTION_CONTROL',
    name: 'الالتزام بمهمات الوقاية الشخصية (PPE) والاحتياطات القياسية لمكافحة العدوى',
    category: 'مكافحة ومنع انتشار العدوى (IPC)',
    gaharStandard: 'معايير مكافحة العدوى - الاحتياطات القياسية ومهمات الوقاية (GAHAR IPC.02 - IPC.03)',
    findingKeywords: ['واقيات شخصية', 'واقيات شخصيه', 'قفازات', 'كمامة', 'كمامه', 'جاون', 'مريلة بلاستيك', 'عدم ارتداء واقيات'],
    deptKeywords: ['مكافحة العدوى', 'عزل', 'عمليات', 'غسيل كلوي', 'معمل'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('الواقيات الشخصية') || ind.includes('استخدام الواقيات الشخصية')
    },
    ovrMatch: o => {
      const t = o.toLowerCase()
      return t.includes('عدم توفر واقيات') || t.includes('تعرض لغياب الواقيات') || t.includes('ppe')
    },
    primaryMetricTemplate: {
      name: 'معدل التزام الكوادر الطبية والتمريضية بارتداء مهمات الوقاية الشخصية المناسبة لكل إجراء',
      unit: '%',
      defaultTarget: '90%'
    }
  },

  // --- Clinical Specialized Tracks ---
  {
    id: 'specialized-dialysis-care',
    domainId: 'SPECIALIZED_DIALYSIS_RENAL',
    name: 'مأمونية جلسات الغسيل الكلوي ومحطة معالجة المياه وتفادي المضاعفات',
    category: 'الخدمات التخصصية - الغسيل الكلوي',
    gaharStandard: 'المعايير التخصصية لوحدات الغسيل الكلوي ومحطات المعالجة (GAHAR DLS.01)',
    findingKeywords: ['محطة المياه', 'محطه المياه', 'ماكينات الغسيل الكلوي', 'فلتر الغسيل', 'مأمونية جلسات الغسيل'],
    deptKeywords: ['غسيل كلوي', 'كلى'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('غسيل كلوي') || ind.includes('الكلى')
    },
    ovrMatch: o => {
      const t = o.toLowerCase()
      return t.includes('غسيل كلوي') || t.includes('جلطة وصلة وريدية') || t.includes('عطل محطة مياه')
    },
    primaryMetricTemplate: {
      name: 'معدل سلامة جلسات الغسيل ومطابقة تحاليل مياه المحطة الكيميائية والبكتريولوجية',
      unit: '%',
      defaultTarget: '100%'
    }
  },
  {
    id: 'patient-flow-bed-management',
    domainId: 'PATIENT_FLOW_CAPACITY_MANAGEMENT',
    name: 'إدارة التدفق السريري والخروج المعياري وكفاءة دوران الأسرة',
    category: 'إدارة السعة والتدفق السريري (FLOW)',
    gaharStandard: 'معايير إدارة تدفق المرضى وسعة المنشأة (GAHAR ACC.01 - ACC.04)',
    findingKeywords: ['تكدس', 'ازدحام', 'تاخر خروج', 'تأخر خروج', 'اشغال الاسرة', 'إشغال الأسرة', 'دوران السرير'],
    deptKeywords: ['داخلي', 'طوارئ', 'تذاكر', 'سجلات'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      return ind.includes('دوران السرير') || ind.includes('اشغال الأسرة') || ind.includes('إشغال الأسرة')
    },
    ovrMatch: o => {
      const t = o.toLowerCase()
      return t.includes('تكدس') || t.includes('تأخير دخول الداخلي') || t.includes('bed delay')
    },
    primaryMetricTemplate: {
      name: 'معدل دوران الأسرة ومتوسط مدة الإقامة بالأيام',
      unit: 'أيام',
      defaultTarget: 'وفق المعدل المعياري للأقسام الداخلية'
    }
  },
  {
    id: 'critical-care-resuscitation',
    domainId: 'CRITICAL_EMERGENCY_CARE_RESUSCITATION',
    name: 'جاهزية إنعاش القلب وخفض وفيات الرعاية المركزة والاستجابة للتدهور السريري',
    category: 'الرعاية الحرجة والطارئة (ECC)',
    gaharStandard: 'معايير الرعاية الحرجة والطوارئ وفريق الاستجابة السريعة (GAHAR ECC.01 - ECC.07)',
    findingKeywords: ['كود بلو', 'code blue', 'dc shock', 'جهاز صدمات', 'تفريغ جهاز dc', 'وفيات العناية', 'وفيات الرعاية'],
    deptKeywords: ['طوارئ', 'عناية مركزه', 'عنايه مركزه', 'icu'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      const val = parseFloat(k.Value || 0)
      return (ind.includes('وفيات العناية') || ind.includes('وفيات الرعاية')) && val > 0
    },
    ovrMatch: o => {
      const t = o.toLowerCase()
      return t.includes('وفاة مفاجئة') || t.includes('تأخر كود بلو') || t.includes('resuscitation failure')
    },
    primaryMetricTemplate: {
      name: 'معدل وفيات العناية المركزة وسرعة استجابة فريق الإنعاش القلبي',
      unit: '%',
      defaultTarget: 'خفض معدل الوفيات القابلة للتفادي'
    }
  },
  {
    id: 'specialized-nicu-care',
    domainId: 'SPECIALIZED_NICU_NEONATAL',
    name: 'رعاية حديثي الولادة والمبتسرين وخفض مضاعفات ووفيات الحضانات',
    category: 'الخدمات التخصصية - الحضانات والأطفال',
    gaharStandard: 'المعايير التخصصية لرعاية الأطفال وحديثي الولادة (GAHAR PED.01)',
    findingKeywords: ['حضان', 'مبتسر', 'سيباب', 'ضائقة تنفسية', 'وفيات الحضان', 'دوران السرير في الحضان'],
    deptKeywords: ['حضان', 'مبتسر'],
    kpiMatch: k => {
      const ind = (k.Indicator || '').toLowerCase()
      const val = parseFloat(k.Value || 0)
      return (ind.includes('وفيات الحضان') && val > 0) || ind.includes('دوران السرير في الحضان') || ind.includes('الاشغال في الحضان')
    },
    ovrMatch: o => {
      const t = o.toLowerCase()
      return t.includes('وفاة مبتسر') || t.includes('تدهور مبتسر') || t.includes('nicu')
    },
    primaryMetricTemplate: {
      name: 'معدل خفض مضاعفات ووفيات المبتسرين ودوران أسرة الحضانات',
      unit: '%',
      defaultTarget: 'خفض الوفيات ومطابقة زمن دوران الحواضن'
    }
  }
]

export function findMatchingOperationalProblem(findingText = '') {
  const norm = normalizeClinicalText(findingText)
  let bestProblem = null
  let maxKeywordLength = 0

  for (const prob of OPERATIONAL_PROBLEMS) {
    for (const kw of prob.findingKeywords) {
      const normKw = normalizeClinicalText(kw)
      if (norm.includes(normKw) && normKw.length > maxKeywordLength) {
        maxKeywordLength = normKw.length
        bestProblem = prob
      }
    }
  }

  return bestProblem
}

function getRecordDepartment(record = {}) {
  return record.department_name || record.Department_Name || record.departmentName ||
    record.Department || record.department || record.dept_name || record.Dept || record.section || ''
}

function isNearRestatement(hypothesis, findingTexts = []) {
  const stopWords = new Set(['في', 'من', 'على', 'الى', 'إلى', 'عن', 'هذا', 'هذه', 'بعض', 'وجود', 'عدم', 'يتم', 'تم', 'التي', 'الذي'])
  const tokens = value => new Set(normalizeClinicalText(value).split(' ').filter(token => token.length > 2 && !stopWords.has(token)))
  const hypothesisTokens = tokens(hypothesis)
  if (hypothesisTokens.size < 4) return true
  return findingTexts.some(text => {
    const findingTokens = tokens(text)
    if (!findingTokens.size) return false
    const intersection = [...hypothesisTokens].filter(token => findingTokens.has(token)).length
    const union = new Set([...hypothesisTokens, ...findingTokens]).size
    return union > 0 && intersection / union >= 0.62
  })
}

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
    const [saved] = await this.saveProjects([projectData])
    return saved
  }

  async saveProjects(projects) {
    if (!Array.isArray(projects) || projects.length === 0) return []
    const now = new Date().toISOString()
    const normalizedProjects = projects.map(projectData => ({
      ...projectData,
      id: projectData.id || crypto.randomUUID(),
      status: projectData.status || 'draft',
      priority: projectData.priority || 'high',
      created_at: projectData.created_at || now,
      updated_at: now
    }))

    const hasTable = await checkHasTable(this.supabase)
    if (hasTable) {
      const { data, error } = await this.supabase
        .from('improvement_projects')
        .insert(normalizedProjects)
        .select()
      if (error) throw error
      return data
    }

    const settingsRows = normalizedProjects.map(project => ({
      key: `improvement_project:${project.id}`,
      value: JSON.stringify(project)
    }))
    const { error } = await this.supabase.from('settings').upsert(settingsRows, { onConflict: 'key' })

    if (error) throw error
    return normalizedProjects
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

    // High-specificity clinical topics take precedence over broad phrases such
    // as "medical record" or "medication" that can appear as context.
    const priorityClassifications = [
      { id: 'PATIENT_SAFETY_GOVERNANCE_CRITICAL_RESULTS', terms: ['تعريف المريض', 'هوية المريض', 'بدون تعريف للمريض', 'نتائج حرجه', 'نتائج حرجة', 'دفتر النتائج الحرجه', 'انذارات حرجه', 'سقوط المرضى', 'قرح الفراش'] },
      { id: 'MEDICAL_RECORDS_CLINICAL_DOCUMENTATION', terms: ['اختصارات', 'اختصار', 'توقيع الطبيب', 'توقيع الاطباء', 'الأوامر الشفهية', 'الاوامر الشفهية', 'تذكرة غير مكتمله', 'تذكرة غير مكتملة'] }
    ]
    for (const classification of priorityClassifications) {
      if (classification.terms.some(term => normText.includes(normalize(term)))) return classification.id
    }

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
  async analyzeHospitalCrisis(hospitalId, { focusDepartment = null } = {}) {
    // 1. Fetch Hospital Details
    const { data: hospital, error: hospErr } = await this.supabase
      .from('hospitals')
      .select('*')
      .eq('id', hospitalId)
      .single()

    if (hospErr || !hospital) throw new Error('المستشفى غير موجود')

    // 2. Fetch All Findings to Compute MANASA Official Recurrence (count >= 2, review_status != 'pending_review')
    const { data: allHospFindings, error: allFindingsError } = await this.supabase
      .from('v_report_findings')
      .select('id, recurrence_group_id, review_status')
      .eq('hospital_id', hospitalId)

    if (allFindingsError) {
      console.warn(`[ImprovementProjectsService] Could not fetch all findings for recurrence calc: ${allFindingsError.message}`)
    }

    const recurrenceGroupCounts = new Map()
    for (const f of allHospFindings || []) {
      if (f.review_status === 'pending_review') continue
      const grpKey = f.recurrence_group_id || f.id
      recurrenceGroupCounts.set(grpKey, (recurrenceGroupCounts.get(grpKey) || 0) + 1)
    }

    const recurringGroupIds = new Set(
      Array.from(recurrenceGroupCounts.entries())
        .filter(([_, count]) => count >= 2)
        .map(([id]) => id)
    )

    // 3. Fetch Active Findings: STRICTLY EXCLUDE RESOLVED / CLOSED FINDINGS!
    const { data: findings, error: findingsError } = await this.supabase
      .from('v_report_findings')
      .select('id, department_id, original_text, priority, status, review_status, recurrence_group_id, canonical_finding_id, departments(name)')
      .eq('hospital_id', hospitalId)
      .not('status', 'in', '("resolved_confirmed","resolved_by_hospital","resolved")')

    if (findingsError) throw new Error(`تعذر تحميل سلبيات المستشفى لتحليل مشاريع التحسين: ${findingsError.message}`)

    let hospitalFindings = findings || []
    let matchedFocusDepartment = null
    if (focusDepartment) {
      const requestedDepartment = normalizeClinicalText(focusDepartment)
      const availableDepartments = [...new Set(hospitalFindings.map(f => f.departments?.name).filter(Boolean))]
      const exactMatches = availableDepartments.filter(name => normalizeClinicalText(name) === requestedDepartment)
      const partialMatches = exactMatches.length
        ? exactMatches
        : availableDepartments.filter(name => normalizeClinicalText(name).includes(requestedDepartment))

      if (partialMatches.length === 0) {
        throw new Error(`لم يتم العثور على قسم مطابق لـ "${focusDepartment}" ضمن سلبيات المستشفى.`)
      }
      if (partialMatches.length > 1) {
        throw new Error(`اسم القسم "${focusDepartment}" غير محدد؛ اختر اسماً أوضح.`)
      }

      matchedFocusDepartment = partialMatches[0]
      const normalizedFocus = normalizeClinicalText(matchedFocusDepartment)
      hospitalFindings = hospitalFindings.filter(f => normalizeClinicalText(f.departments?.name || '') === normalizedFocus)
    }

    const eligibleFindings = (hospitalFindings || []).filter(f => !isTrivialNoise(f)).map(f => {
      const grpKey = f.recurrence_group_id || f.id
      const isConfirmedRecurring = f.review_status !== 'pending_review' && recurringGroupIds.has(grpKey)
      return {
        ...f,
        is_confirmed_recurring: isConfirmedRecurring
      }
    })

    // 4. Fetch Google Sheet KPIs
    const { matchedName: matchedSheetName, kpis: sheetKpis } = await this.fetchHospitalKpisFromSheet(hospital.name)
    const activeDeficientKpis = sheetKpis.filter(k => isDeficientKpi(k))

    // 5. Fetch Hospital OVR Incidents
    const rawOvrRecords = await ovrService.getHospitalOVR(hospitalId)
    let eligibleOvrRecords = (rawOvrRecords || []).filter(o =>
      !isTrivialNoise([o.subcategory, o.category, o.description].filter(Boolean).join(' ')))
    const isInFocusedDepartment = record => {
      if (!matchedFocusDepartment) return true
      const recordDepartment = record.department_name || record.Department_Name || record.departmentName ||
        record.Department || record.department || record.dept_name
      return Boolean(recordDepartment) && normalizeClinicalText(recordDepartment) === normalizeClinicalText(matchedFocusDepartment)
    }
    const scopedOvrRecords = eligibleOvrRecords.filter(isInFocusedDepartment)
    eligibleOvrRecords = matchedFocusDepartment ? scopedOvrRecords : eligibleOvrRecords

    // 6. Dynamic Bottom-Up Thematic Clustering on OPERATIONAL_PROBLEMS
    const clusters = []

    for (const problem of OPERATIONAL_PROBLEMS) {
      // Semantic matching on finding text (Department is secondary context, NOT standalone evidence!)
      const problemFindings = eligibleFindings.filter(f => {
        const normF = normalizeClinicalText(f.original_text || '')
        const bestMatch = findMatchingOperationalProblem(f.original_text || '')
        if (bestMatch) return bestMatch.id === problem.id

        // Fallback keyword check
        return problem.findingKeywords.some(kw => normF.includes(normalizeClinicalText(kw)))
      })

      // Grounding Rule: A project CANNOT be created without active field inspection findings!
      if (problemFindings.length === 0) continue

      const depts = [...new Set(problemFindings.map(f => f.departments?.name).filter(Boolean))]
      const primaryDept = depts.length === 1 ? depts[0] : (depts.length > 0 ? `أقسام متعددة (${depts.join('، ')})` : 'عام')

      // Attach matching Sheet KPIs that specifically correlate with this operational issue
      const domainKpis = activeDeficientKpis.filter(k => problem.kpiMatch(k) && isInFocusedDepartment(k))

      // Attach only issue-specific, verified OVR incidents
      const domainOvrs = eligibleOvrRecords.filter(o => {
        const full = `${o.subcategory || ''} ${o.category || ''} ${o.description || ''}`
        return problem.ovrMatch(full)
      })

      const hasFinding = problemFindings.length > 0
      const hasKpi = domainKpis.length > 0
      const hasOvr = domainOvrs.length > 0
      const sourceCount = (hasFinding ? 1 : 0) + (hasKpi ? 1 : 0) + (hasOvr ? 1 : 0)

      // Strict Validation Threshold: Require at least 2 field findings OR (1 field finding + 1 verified KPI/OVR)
      if (!hasFinding || (problemFindings.length < 2 && sourceCount < 2)) continue

      let corroborationLevel = 'مبني على حصر المرور الميداني وسلبيات التفتيش الموثقة'
      if (sourceCount === 3) {
        corroborationLevel = 'تطابق ثلاثي موثق: سلبيات ميدانية + مؤشرات أداء رقمية + بلاغات أمان معتمدة'
      } else if (sourceCount === 2 && hasKpi) {
        corroborationLevel = 'تطابق ثنائي موثق: سلبيات ميدانية + مؤشر أداء رقمي معتمد'
      } else if (sourceCount === 2 && hasOvr) {
        corroborationLevel = 'تطابق ثنائي موثق: سلبيات ميدانية + بلاغات أمان محددة'
      }

      const critKpis = domainKpis.filter(k => normalizeClinicalText(k.Alert_Level || '') === 'critical')
      const alertKpis = domainKpis.filter(k =>
        normalizeClinicalText(k.Alert_Level || '') === 'alert' || normalizeClinicalText(k.Status || '') === 'risk')
      const recurringFindings = problemFindings.filter(f => f.is_confirmed_recurring)
      const highFindings = problemFindings.filter(f => f.priority === 'high' && !f.is_confirmed_recurring)
      const normalFindings = problemFindings.filter(f => f.priority !== 'high' && !f.is_confirmed_recurring)
      const score = (critKpis.length * 40) + (alertKpis.length * 20) +
        (recurringFindings.length * 25) + (highFindings.length * 20) +
        (normalFindings.length * 10) + (Math.min(domainOvrs.length, 5) * 5) +
        (sourceCount === 3 ? 15 : sourceCount === 2 ? 8 : 0)

      if (score <= 0) continue

      const structuredKpis = domainKpis.map(k => ({
        Indicator: k.Indicator,
        Value: k.Value,
        Target: getValidatedSourceTarget(
          k.Indicator,
          k.Value,
          k.Target ?? k.Target_Value ?? k.TargetValue ?? k.target ?? k.target_value ?? null
        ),
        Frequency: k.Frequency ?? k.frequency ?? null,
        unit: extractKpiUnit(k.Indicator),
        Alert_Level: k.Alert_Level,
        Status: k.Status,
        Year: k.Year || null,
        Month: k.Month || null,
        formatted: formatKpiDisplay(k.Indicator, k.Value)
      }))

      const critKpisEvidence = structuredKpis.map(k => {
        const dateStr = k.Year && k.Month ? ` [تاريخ: ${k.Year}/${k.Month}]` : ''
        return `• ${k.Indicator}: ${k.formatted} (حالة الخطر: ${k.Alert_Level || k.Status})${dateStr}`
      }).slice(0, 8)

      const findingsEvidence = [...problemFindings]
        .sort((a, b) => (b.priority === 'high' ? 1 : 0) - (a.priority === 'high' ? 1 : 0))
        .map(f => `• [${f.departments?.name || 'عام'}]: ${f.original_text} (معرف: ${f.id})${f.is_confirmed_recurring ? ' [سلبية متكررة معتمدة]' : ''}`)
        .slice(0, 8)

      const ovrsEvidence = domainOvrs.slice(0, 5).map(o => {
        const description = String(o.description || o.subcategory || 'بلاغ دون وصف')
        return `• [${o.date || 'بلاغ'} - ${o.subcategory || 'حدث'}]: ${description.length > 130 ? `${description.slice(0, 130)}...` : description}`
      })

      const problemId = `prob-${hospital.code || 'hosp'}-${problem.id}`

      clusters.push({
        problem_id: problemId,
        domain_id: problem.domainId,
        issue_id: problem.id,
        domain_name: problem.name,
        name: problem.name,
        category: problem.category,
        primary_department: primaryDept,
        gahar_standard: problem.gaharStandard,
        score,
        source_count: sourceCount,
        is_triple_corroborated: sourceCount === 3,
        corroboration_level: corroborationLevel,
        project_scale: 'FOCUSED_TARGETED',
        findings_count: problemFindings.length,
        kpis_count: domainKpis.length,
        ovr_count: domainOvrs.length,
        findings: problemFindings,
        deficient_kpis: structuredKpis,
        ovrs: domainOvrs,
        critical_kpis_evidence: critKpisEvidence,
        correlating_findings_evidence: findingsEvidence,
        ovr_incidents_evidence: ovrsEvidence,
        primaryMetricTemplate: problem.primaryMetricTemplate
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
        totalFindings: hospitalFindings.length,
        eligibleFindings: eligibleFindings.length,
        focusDepartment: matchedFocusDepartment,
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
    const crisisAnalysis = await this.analyzeHospitalCrisis(hospitalId, {
      focusDepartment: options.focusDepartment || null
    })
    const hospital = crisisAnalysis.hospital
    const eligibleCrises = crisisAnalysis.eligible_crises || []

    if (eligibleCrises.length === 0) {
      throw new Error('لا توجد أدلة سريرية أو رقمية كافية حالياً لتبرير مشروع تحسين مؤسسي بالمستشفى. يُكتفى بالإجراءات التصحيحية الفورية (CAPA) وتحديث مؤشرات الأداء.')
    }

    // Strictly generate up to 3 major projects, 1 per distinct problem cluster
    const requestedCount = Number.parseInt(options.count, 10)
    const count = Math.min(Number.isFinite(requestedCount) && requestedCount > 0 ? requestedCount : 3, 3, eligibleCrises.length)

    // Select candidates prioritizing distinct accreditation domains among top-ranked candidates, then fill by score
    const selectedCrises = []
    const selectedDomains = new Set()
    for (const crisis of eligibleCrises) {
      if (selectedCrises.length >= count) break
      if (!selectedDomains.has(crisis.domain_id)) {
        selectedCrises.push(crisis)
        selectedDomains.add(crisis.domain_id)
      }
    }
    if (selectedCrises.length < count) {
      for (const crisis of eligibleCrises) {
        if (selectedCrises.length >= count) break
        if (!selectedCrises.includes(crisis)) selectedCrises.push(crisis)
      }
    }

    // Explicitly document selection status and rationale on ALL candidates for full auditability
    for (let i = 0; i < eligibleCrises.length; i++) {
      const crisis = eligibleCrises[i]
      const rank = i + 1
      crisis.rank = rank
      const isSelected = selectedCrises.some(s => s.problem_id === crisis.problem_id)
      crisis.selection_status = isSelected ? 'selected' : 'excluded'
      if (isSelected) {
        crisis.selection_rationale = `تم اختياره ضمن المشروعات المعتمدة (الرتبة ${rank} - ${crisis.score} نقطة) لتكامل أركان الإثبات وتوافر أدلة ميدانية متطابقة (${crisis.corroboration_level}).`
      } else if (selectedDomains.has(crisis.domain_id)) {
        crisis.selection_rationale = `استبعاد موثق: تم تمثيل مجال (${crisis.category}) بالمشروع الأعلى رتبة في هذا المجال، ولتأمين التوازن المؤسسي بين المجالات دون ازدواجية المشروعات في المجال نفسه.`
      } else {
        crisis.selection_rationale = `استبعاد موثق: شغل المشروعات الأعلى رتبة في المجموع التراكمي للمقاعد المتاحة (${count} مشروعات).`
      }
    }

    // Step B: Build verified ground-truth dossier with auditable IDs and genuine units
    const groundTruthDossier = selectedCrises.map((c, idx) => {
      const kpiLines = (c.critical_kpis_evidence || []).map(k => `  ${k}`)
      const ovrLines = c.ovr_count > 0
        ? `  • إجمالي ${c.ovr_count} بلاغ فعلي مسجل لهذه المشكلة:\n${(c.ovr_incidents_evidence || []).join('\n')}`
        : '  • لا توجد بلاغات OVR مسجلة لهذه المشكلة بالتحديد خلال فترة التقرير'
      const findingLines = c.findings_count > 0
        ? `  • إجمالي ${c.findings_count} ملاحظة وسلبية ميدانية مرصودة. المعرفات المتاحة للاستشهاد: ${c.findings.slice(0, 8).map(f => f.id).join(', ')}\n${(c.correlating_findings_evidence || []).join('\n')}`
        : '  • لا توجد سلبيات ميدانية مرصودة'

      return `
======================================================================
المشكلة رقم (${idx + 1}): [${c.domain_name}]
- المعرف الثابت (problem_id): "${c.problem_id}"
- التصنيف: ${c.category}
- القسم الأساسي: ${c.primary_department}
- معيار الاعتماد: ${c.gahar_standard}
- حجم ونطاق المشروع: مشروع تحسين مركّز ومحدد (Focused QIP)
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
    const systemPrompt = `أنت خبير في تحسين جودة الرعاية الصحية. صغ مسودة ميثاق لمراجع بشري، ولا تدّع أن تحليل السبب الجذري اكتمل آلياً.
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
   - كل فرضية سبب جذري يجب أن تستشهد بمعرف سلبية واحد أو أكثر موجود حرفياً في ملف الأدلة. إذا لم تدعم الأدلة الفرضية، لا تذكرها.
   - الفرضية ليست إعادة صياغة للملاحظة ولا مجرد تسمية الحل المفقود؛ صف آلية تشغيلية/نظامية محتملة، واقترح تحققاً يمكنه إثباتها أو نفيها دون افتراض السبب مسبقاً.
   - اكتب الأسباب كفرضيات أولية بلا لوم تحتاج للتحقق بالملاحظة ورسم مسار العمل و5 Whys؛ لا تصفها كحقائق مثبتة.
3. ضيق نطاق المشروع:
   - كل مشروع يعالج مساراً تشغيلياً واحداً في قسم واحد. لا تدمج نتائج حرجة وهوية مريض وسقوط وقرح ضغط، ولا تدمج التخزين والتوريد والوصفات وعربة الإنعاش.
   - إذا لم تكف الأدلة لمسار واحد، أعد مشروعاً أقل عدداً ولا تملأ العدد بمشكلات غير مترابطة.
   - لا تقترح تدخلات لقسم أو مشكلة غير موجودة في ملف الأدلة.
4. حظر الحلول البرمجية الخيالية (No IT Fantasies):
   - المستشفيات الحكومية لا تملك أنظمة ربط API أو برمجيات مخصصة LIMS. التدخلات يجب أن تكون مسارات عمل إكلينيكية وتمريضية وإدارية قابلة للتنفيذ غداً.
5. المسمى الوظيفي فقط (Job Roles Only - NO Human Names):
   - ممنوع كتابة أسماء أشخاص حقيقيين أو وهميين (مثل د. فلان).
   - اكتب المسمى الوظيفي الإكلينيكي أو التمريضي الرسمي فقط (مثلاً: رئيس قسم الصيدلة بالمستشفى، رئيس قسم الاستقبال والطوارئ، مشرفة تمريض القسم).
6. لا تخترع مرضاً أو معدلاً سريرياً أو خللاً في خطوة عمل لم تذكره الأدلة. استخدم صياغة عامة مرتبطة بالمجال عند غياب التفاصيل.
7. لا تخترع أهدافاً رقمية أو تحوّل اتجاه مؤشر. استخدم هدف المصدر فقط إن كان موجوداً؛ وإلا اذكر أن تعريف المؤشر ومقامه والهدف يحتاج اعتماد الفريق.
8. صيغة الإخراج: JSON فقط ومصفوفة "projects" تحتوي على مشروع واحد لكل problem_id.`

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
      "root_cause_hypotheses": [
        { "hypothesis": "فرضية تشغيلية محددة وليست حقيقة مثبتة", "supporting_finding_ids": ["معرف سلبية من ملف الأدلة"], "how_to_validate": "طريقة تحقق ميدانية قابلة للتنفيذ" }
      ],
      "problem_statement": "بيان المشكلة يربط الأدلة الحقيقية دون اختلاق",
      "smart_goal": "الهدف الذكي القابل للقياس وموعد الإنجاز المستهدف",
      "evidence_reference": "اسم معيار GAHAR المعني",
      "root_cause_validation_plan": "خطة تحقق تبدأ برسم العملية وملاحظة الحالات ثم 5 Whys ومراجعة السجلات",
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

    const crisisById = new Map(selectedCrises.map(crisis => [crisis.problem_id, crisis]))
    const validGeneratedProjects = []
    const seenProblemIds = new Set()
    for (const project of generatedProjects) {
      if (!project || typeof project !== 'object' || !project.problem_id) continue
      if (!crisisById.has(project.problem_id) || seenProblemIds.has(project.problem_id)) continue
      seenProblemIds.add(project.problem_id)
      validGeneratedProjects.push(project)
    }

    if (validGeneratedProjects.length === 0) {
      throw new Error('لم يقم الذكاء الاصطناعي بتوليد أي مشروع تحسين مطابق للمشكلات المعتمدة في ملف الأدلة.')
    }

    console.log(`[ImprovementProjectsService] Generation successful. Anchoring ${validGeneratedProjects.length} projects to ground-truth evidence...`)

    // Step D: Deterministic Post-Processing Anchor (Match by explicit problem_id, NEVER by index [idx])
    const anchoredProjects = []

    for (const genProj of validGeneratedProjects) {
      const cluster = crisisById.get(genProj.problem_id)
      if (!cluster) continue

      const deptName = crisisAnalysis.stats.focusDepartment || cluster.primary_department || 'عام'
      const category = cluster.category || 'سلامة المرضى'
      const durationWeeks = 12

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
        baselineSnippets.push(`بلاغات OVR: ${cluster.ovrs.length} بلاغ فعلي مسجل لهذه المشكلة`)
      }
      if (cluster.findings.length > 0) {
        baselineSnippets.push(`المرور الميداني: ${cluster.findings.length} سلبية مرصودة`)
      }
      const baselineMetricsText = baselineSnippets.join(' • ') || 'مبني على المرور الميداني وسلبيات التفتيش الموثقة'

      // 3. Anchor Primary KPI and Secondary KPIs
      let primaryKpi = null
      const secondaryKpis = []

      if (cluster.deficient_kpis.length > 0) {
        const primaryKpiObj = cluster.deficient_kpis[0]
        const polarity = getKpiPolarity(primaryKpiObj.Indicator)
        const sourceTarget = primaryKpiObj.Target
        const hasSourceTarget = sourceTarget !== null && String(sourceTarget).trim() !== ''

        let targetStr = ''
        let targetVal = null
        let targetType = ''
        let targetRationale = ''

        if (hasSourceTarget) {
          targetStr = String(sourceTarget).trim()
          targetVal = String(sourceTarget).trim()
          targetType = 'منصوص عليه بمصدر المؤشر المعتمد'
          targetRationale = `مستهدف رسمي منصوص عليه في بطاقة المؤشر بمصدر البيانات المعتمد (${String(sourceTarget).trim()}).`
        } else if (polarity === 'LOWER_IS_BETTER') {
          targetStr = primaryKpiObj.unit === '%' ? 'أقل من 10%' : '0'
          targetVal = primaryKpiObj.unit === '%' ? '10' : '0'
          targetType = 'مستهدف تحسيني مقترح يحتاج اعتماد الإدارة'
          targetRationale = `مستهدف تحسيني مرحلي مقترح من فريق الجودة لتضييق فجوة خط الأساس (${primaryKpiObj.formatted}) إلى (${targetStr})، ويتطلب مراجعة واعتماد لجنة الدواء والجودة وإدارة المستشفى؛ ولا يُنسب هذا الرقم إلى معايير GAHAR كنسبة مئوية منصوص عليها بل كهدف تشغيلي مرحلي.`
        } else {
          targetStr = primaryKpiObj.unit === '%' ? '95% على الأقل' : 'تحقيق المستهدف القياسي'
          targetVal = primaryKpiObj.unit === '%' ? '95' : '100'
          targetType = 'مستهدف تحسيني مقترح يحتاج اعتماد الإدارة'
          targetRationale = `مستهدف تحسيني مرحلي مقترح للوصول بالامتثال إلى مستوى آمن (${targetStr}) انطلاقاً من خط الأساس الموثق (${primaryKpiObj.formatted})؛ يخضع للاعتماد والمواءمة مع سياسة المستشفى قبل بدء التطبيق.`
        }

        primaryKpi = {
          name: primaryKpiObj.Indicator,
          type: /وفيات|وفاة|عدوى|سقوط|قرح|إصابة|اصابة/i.test(primaryKpiObj.Indicator) ? 'outcome' : 'process',
          baseline: primaryKpiObj.formatted,
          target: `${targetStr} (${targetType === 'منصوص عليه بمصدر المؤشر المعتمد' ? 'مستهدف معتمد بمصدر المؤشر' : 'مستهدف تحسيني مقترح يحتاج اعتماد الإدارة'})`,
          target_value: targetVal,
          target_type: targetType,
          target_rationale: targetRationale,
          unit: primaryKpiObj.unit,
          frequency: primaryKpiObj.Frequency || 'شهري',
          date: (primaryKpiObj.Year && primaryKpiObj.Month) ? `${primaryKpiObj.Year}/${primaryKpiObj.Month}` : null,
          source: `مؤشرات الأداء الشهرية المعتمدة (Google Sheet${primaryKpiObj.Year ? ` - ${primaryKpiObj.Year}/${primaryKpiObj.Month}` : ''})`
        }

        // Additional sheet KPIs as secondary
        for (let i = 1; i < cluster.deficient_kpis.length && secondaryKpis.length < 2; i++) {
          const secKpiObj = cluster.deficient_kpis[i]
          secondaryKpis.push({
            name: secKpiObj.Indicator,
            type: 'process',
            baseline: secKpiObj.formatted,
            target: secKpiObj.Target || (getKpiPolarity(secKpiObj.Indicator) === 'LOWER_IS_BETTER' ? 'أقل من 10%' : '90%'),
            frequency: secKpiObj.Frequency || 'شهري',
            source: 'مؤشرات الأداء الشهرية المعتمدة'
          })
        }
      } else {
        const tpl = cluster.primaryMetricTemplate || {
          name: `معدل الالتزام بمعايير ${cluster.domain_name}`,
          unit: '%',
          defaultTarget: '100%'
        }
        primaryKpi = {
          name: tpl.name,
          type: 'process',
          baseline: `${cluster.findings.length} ملاحظات سلبية مرصودة بالمرور الميداني`,
          target: `${tpl.defaultTarget} (مستهدف تحسيني مقترح يحتاج اعتماد الإدارة)`,
          target_value: '100',
          target_type: 'مستهدف تحسيني مقترح يحتاج اعتماد الإدارة',
          target_rationale: 'مستهدف تحسيني مرحلي مقترح لمعالجة الملاحظات الميدانية بالكامل؛ يتطلب مراجعة واعتماد رئيس القسم ولجنة الجودة.',
          unit: tpl.unit,
          frequency: 'أسبوعي',
          source: 'سجلات وقوائم المرور الميداني والتدقيق الداخلي'
        }
      }

      // Add operational secondary KPI tracking process compliance if room exists
      if (secondaryKpis.length === 0) {
        secondaryKpis.push({
          name: `نسبة التزام الطاقم بنموذج المتابعة والتدخل المعتمد (${cluster.domain_name})`,
          type: 'process',
          baseline: '0% (قيد التفعيل والتطبيق)',
          target: '100%',
          frequency: 'أسبوعي',
          source: 'سجلات المتابعة والتدقيق الإكلينيكي بالقسم'
        })
      }

      const allAnchoredKpis = [primaryKpi, ...secondaryKpis].filter(Boolean)

      // 4. Anchor forensic corroboration (True existence only, neutral wording for zero OVR)
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
          : 'لا توجد بلاغات OVR مسجلة لهذه المشكلة بالتحديد خلال فترة التقرير'
      }

      // 5. Sanitize leadership and team roles
      const projectLead = sanitizeClinicalLead(genProj.project_lead, deptName, category)
      const teamMembers = sanitizeClinicalTeamMembers(genProj.team_members, deptName, category)
      const allowedFindingIds = new Set(cluster.findings.slice(0, 8).map(f => f.id))
      const verifiedRootCauseHypotheses = (Array.isArray(genProj.root_cause_hypotheses) ? genProj.root_cause_hypotheses : [])
        .filter(item => item && typeof item.hypothesis === 'string' && item.hypothesis.trim())
        .map(item => ({
          hypothesis: item.hypothesis.trim(),
          supporting_finding_ids: Array.isArray(item.supporting_finding_ids)
            ? [...new Set(item.supporting_finding_ids.filter(id => allowedFindingIds.has(id)))]
            : [],
          how_to_validate: typeof item.how_to_validate === 'string' ? item.how_to_validate.trim() : ''
        }))
        .filter(item => item.supporting_finding_ids.length > 0 && item.how_to_validate.length >= 20 &&
          !isNearRestatement(item.hypothesis, cluster.findings
            .filter(finding => item.supporting_finding_ids.includes(finding.id))
            .map(finding => finding.original_text || '')))

      const rootCauseAnalysis = verifiedRootCauseHypotheses.length
        ? 'الفرضيات المعروضة أدناه مرتبطة بسلبيات مرصودة، لكنها تحتاج إلى تحقق ميداني قبل اعتبارها أسباباً جذرية.'
        : 'لا تثبت بيانات المرور وحدها سبباً جذرياً محدداً. يبدأ الفريق برسم مسار العمل وملاحظة التنفيذ وإجراء 5 Whys قبل اعتماد أي سبب.'
      const rootCauseValidationPlan = 'خلال أول أسبوعين: رسم خطوات العملية كما تنفذ فعلياً، ملاحظة الحالات والمناوبات، مراجعة السجلات، ثم إجراء 5 Whys مع الفريق والتحقق من كل فرضية قبل اعتماد التدخل.'

      // 6. Sanitize interventions (no IT fantasies)
      const generatedInterventions = Array.isArray(genProj.interventions)
        ? genProj.interventions.filter(it => typeof it === 'string' || (it && typeof it === 'object'))
        : []
      const sanitizedInterventions = (generatedInterventions.length ? generatedInterventions : [
        { step: 'رسم خطوات العملية الحالية وملاحظة تنفيذها في أكثر من مناوبة، وتوثيق نقاط التعطل كما حدثت فعلياً.', responsible: 'أخصائي سلامة المرضى وتوكيد الجودة', duration: 'الأسبوعان الأولان' },
        { step: 'اختبار تدخل صغير يعالج السبب الذي تم التحقق منه، باستخدام دورة تخطيط وتنفيذ ودراسة وتعديل (PDSA).', responsible: `رئيس قسم ${deptName} بالمستشفى`, duration: 'أربعة أسابيع' },
        { step: 'مراجعة المؤشرات والملاحظات في كل مرور وتعديل التدخل قبل تعميمه على القسم.', responsible: 'فريق التحسين متعدد التخصصات', duration: 'طوال مدة المشروع' }
      ]).map(it => {
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

      // 7. Calculate Target Completion Date & Priority Matrix
      const matrix = {
        patient_safety_risk: cluster.deficient_kpis.some(k => normalizeClinicalText(k.Alert_Level || '') === 'critical') ||
          cluster.findings.some(f => f.priority === 'high') ? 5 :
          cluster.findings.some(f => f.priority === 'medium') ? 3 : 2,
        volume_frequency: Math.min(5, Math.max(1, cluster.findings_count)),
        process_complexity: 3,
        strategic_alignment: 3
      }
      matrix.total_score = Object.values(matrix).reduce((total, score) => total + score, 0)
      const evidencePriority = matrix.total_score >= 16 ? 'high' : matrix.total_score >= 12 ? 'medium' : 'low'
      const targetDate = new Date()
      targetDate.setDate(targetDate.getDate() + (durationWeeks * 7))

      const smartGoal = `خلال ${durationWeeks} أسبوعاً، يتم تحقيق المستهدف لمؤشر «${primaryKpi.name}» بالوصول إلى ${primaryKpi.target} (انطلاقاً من خط الأساس الموثق: ${primaryKpi.baseline}) في ${deptName}، مع المتابعة الدورية بصفة ${primaryKpi.frequency} واعتماد الإجراءات التصحيحية الميدانية.`

      const hospitalLabel = String(hospital.name || '').replace(/^\s*مستشفى\s+/u, '').trim()

      // 8. Assemble Full Project Record
      const projectRecord = {
        id: crypto.randomUUID(),
        hospital_id: hospital.id,
        hospital_name: hospital.name,
        problem_id: cluster.problem_id,
        primary_problem: cluster.domain_name,
        title: `تحسين ${cluster.domain_name} في ${deptName} بمستشفى ${hospitalLabel}`,
        department_name: deptName,
        category,
        priority: evidencePriority,
        status: 'draft',
        problem_statement: `في ${hospital.name}، رُصدت ${cluster.findings.length} ملاحظة نشطة مرتبطة بـ ${cluster.domain_name}، في ${[...new Set(cluster.findings.map(f => f.departments?.name).filter(Boolean))].join('، ') || cluster.primary_department}. ${cluster.deficient_kpis.length ? `وتظهر مؤشرات الأداء التالية كإشارات تحتاج إلى تحسين: ${cluster.deficient_kpis.map(k => `${k.Indicator} ${k.formatted}`).join('؛ ')}.` : 'لا يتوفر مؤشر رقمي موثق لهذا المسار حالياً.'} هذه الأدلة تحدد فجوة الأداء، لكنها لا تثبت وحدها سببها الجذري.`,
        baseline_metrics: baselineMetricsText,
        smart_goal: smartGoal,
        primary_kpi: primaryKpi,
        secondary_kpis: secondaryKpis,
        kpis: allAnchoredKpis,
        evidence_reference: `مرجع استرشادي للمراجعة مع مسؤول الاعتماد: ${cluster.gahar_standard} (إطار استرشادي يخضع للمواءمة مع دليل سياسات المنشأة المعتمد)`,
        target_completion_date: targetDate.toISOString().split('T')[0],
        estimated_duration_weeks: durationWeeks,
        interventions: sanitizedInterventions,
        project_lead: projectLead,
        team_members: teamMembers,
        linked_finding_ids: cluster.findings.map(f => f.id),
        linked_findings_summary: cluster.findings.slice(0, 8).map(f => f.original_text),
        prioritization_matrix: {
          ...matrix,
          eligibility_justification: `درجة آلية أولية من عناصر التقييم الظاهرة؛ يراجع الفريق تقدير التعقيد والتوافق الاستراتيجي قبل الاعتماد. الأدلة ضمن قسم ومسار واحد (${cluster.corroboration_level}).`
        },
        why_hard_to_solve: `الملاحظات تثبت وجود فجوة في ${cluster.domain_name}، لكنها لا تحدد وحدها موضع التعطل أو سببه. يحدد الفريق تعقيد المسار بعد ملاحظة التنفيذ ومراجعة نقاط التسليم والمسؤوليات في الأقسام المعنية.`,
        root_cause_analysis: rootCauseAnalysis,
        root_cause_hypotheses: verifiedRootCauseHypotheses,
        root_cause_validation_plan: rootCauseValidationPlan,
        forensic_corroboration: forensicCorroboration,
        evidence_references: evidenceReferences,
        directorate_notes: `مسودة مشروع مبنية على الأدلة المتاحة (${cluster.corroboration_level})؛ يجب التحقق من فرضيات السبب واعتماد الأهداف والتدخلات قبل بدء التنفيذ.`
      }

      anchoredProjects.push(projectRecord)
    }

    if (isDryRun) return anchoredProjects
    return this.saveProjects(anchoredProjects)
  }
}
