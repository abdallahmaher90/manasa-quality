import { createServiceClient } from '../lib/supabase.js'
import { fetchGoogleSheetData } from '../lib/google-sheets.js'
import { findMatchingSheetHospital } from '../lib/hospital-matcher.js'
import { ovrService } from './ovr.service.js'
import crypto from 'crypto'

let hasTableCache = null

async function checkHasTable(supabase) {
  if (hasTableCache !== null) return hasTableCache
  try {
    const { error } = await supabase.from('improvement_projects').select('id').limit(1)
    hasTableCache = !error
  } catch (e) {
    hasTableCache = false
  }
  return hasTableCache
}

function getGroqKeys() {
  const keysStr = process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || ''
  return keysStr.split(',').map(k => k.trim()).filter(Boolean)
}

let currentGroqKeyIndex = 0

async function callGroqWithRetry(payload, maxRetries = 5) {
  const keys = getGroqKeys()
  if (keys.length === 0) {
    throw new Error('لم يتم العثور على أي مفتاح GROQ_API_KEY أو GROQ_API_KEYS في ملف الإعدادات.')
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Pick current key in round-robin fashion
    const activeKey = keys[currentGroqKeyIndex % keys.length]
    // Advance index for next call/pass
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
        // If we have multiple keys, immediately switch to the next key with ZERO wait time!
        if (keys.length > 1 && attempt < maxRetries) {
          console.log(`[Groq Multi-Key] Rate limit hit on key ending with ...${activeKey.slice(-6)}. Instantly switching to next available key...`)
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

// Map department/category to standardized realistic clinical leadership & multidisciplinary team roles
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

  if (text.includes('مبتسر') || text.includes('حضّان') || text.includes('أطفال') || text.includes('nicu')) {
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

  // Fallback default
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

  // Banned personal names or tech terms
  const bannedKeywords = [
    'مهندس نظم', 'محلل نظم', 'مبرمج', 'مطور', 'it', 'برمجيات', 'software',
    'أحمد', 'محمد', 'محمود', 'علي', 'حسن', 'حسين', 'إبراهيم', 'مصطفى',
    'ليلى', 'سارة', 'فاطمة', 'مريم', 'منى', 'هدى', 'عبدالعزيز', 'الخالدي', 'السالم', 'عمر', 'خالد'
  ]

  // Any human honorific prefix
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
    
    // Check if it has any banned keywords
    const isBanned = bannedKeywords.some(bk => cleaned.toLowerCase().includes(bk))
    if (isBanned) continue

    // Must have a valid hospital role term
    const validClinicalTerms = ['طبيب', 'صيدلي', 'تمريض', 'ممرض', 'مشرف', 'مشرفة', 'أخصائي', 'استشاري', 'منسق', 'فني', 'كيميائي', 'مراقب', 'مسؤول', 'كادر']
    const isValidRole = validClinicalTerms.some(term => cleaned.includes(term))
    if (isValidRole) {
      validMembers.push(cleaned)
    }
  }

  // Supplement if needed
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

    // Fallback in settings
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

      // Filter rows for this hospital
      const hospitalRows = allSheetRows.filter(r => r.Hospital === matchedName)

      // Group by indicator and keep the latest record (highest year, highest month)
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

  // 7. Clinical Domain Classification & Synthesis (Smart Arabic Normalization)
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

    const norm = normalize(`${text} ${deptName}`)

    // 1. Medication Management & Pharmacy - إدارة ومأمونية الدواء والصيدلة السريرية
    if (
      norm.includes('دواء') || norm.includes('دوائ') || norm.includes('صيدل') ||
      norm.includes('وصفات') || norm.includes('وصفه') || norm.includes('روشت') ||
      norm.includes('ترياق') || norm.includes('حقن امن') || norm.includes('كراش') ||
      norm.includes('عاليه الخطور') || norm.includes('lasa') || norm.includes('تفاعل دوائ') ||
      norm.includes('محاليل') || norm.includes('وريدي') || norm.includes('انسولين') ||
      norm.includes('مخدر') || norm.includes('نقل دم') || norm.includes('مشتقات دم') ||
      norm.includes('ملائمه دوائ')
    ) {
      return 'MEDICATION_MANAGEMENT'
    }

    // 2. Critical Care, Emergency & Rescue - الرعاية الحرجة وفرز الطوارئ والنتائج الحرجة
    if (
      norm.includes('عناي') || norm.includes('طوارئ') || norm.includes('استقبال') ||
      norm.includes('فرز') || norm.includes('ترياج') || norm.includes('vte') ||
      norm.includes('جلطات') || norm.includes('انعاش') || norm.includes('cpr') ||
      norm.includes('تدهور') || norm.includes('قساطر') || norm.includes('انابيب') ||
      norm.includes('توصيل خاطئ') || norm.includes('rrt') || norm.includes('استجابه سريع') ||
      norm.includes('علامات حيوي') || norm.includes('صدمات') || norm.includes('تنفس صناعي') ||
      norm.includes('نتائج حرجه') || norm.includes('نتيجه حرجه')
    ) {
      return 'CRITICAL_EMERGENCY_CARE'
    }

    // 3. Infection Prevention & Control - مكافحة العدوى والتعقيم والعزل الطبي
    if (
      norm.includes('عدو') || norm.includes('عزل') || norm.includes('تعقيم') ||
      norm.includes('اوتوكلاف') || norm.includes('واقيات') || norm.includes('واقي شخص') ||
      norm.includes('ppe') || norm.includes('نفايات') || norm.includes('تطهير') ||
      norm.includes('غسيل ايدي') || norm.includes('تطهير ايدي') || norm.includes('وخز') ||
      norm.includes('ابره') || norm.includes('ابر') || norm.includes('انسكاب') ||
      norm.includes('ميكروب') || norm.includes('هايجين') || norm.includes('كوفيد') ||
      norm.includes('فيروس b') || norm.includes('cauti') || norm.includes('clabsi') ||
      norm.includes('vap') || norm.includes('ssi')
    ) {
      return 'INFECTION_PREVENTION'
    }

    // 4. National Patient Safety Goals (NPSGs) - الأهداف الوطنية لسلامة المرضى
    if (
      (norm.includes('تعريف') && norm.includes('مريض')) ||
      norm.includes('اسوره') || norm.includes('اساور') ||
      norm.includes('التحقق من هويه') || norm.includes('بيانات المريض') ||
      (norm.includes('اوامر') && (norm.includes('شفه') || norm.includes('هاتف'))) ||
      norm.includes('تسليم وتسلم') || norm.includes('تسليم وتسلّم') ||
      norm.includes('انذارات حرجه') || norm.includes('الانذارات الحرجه') ||
      norm.includes('موضع جراح') || norm.includes('تحديد موضع') ||
      norm.includes('وقت مستقطع') || norm.includes('time out') ||
      norm.includes('سقوط') || (norm.includes('قرح') && norm.includes('فراش')) ||
      norm.includes('تقييد') || norm.includes('هروب') || norm.includes('عنف')
    ) {
      return 'PATIENT_SAFETY_GOVERNANCE'
    }

    // 5. Medical Records & Clinical Documentation - السجلات والملفات الطبية والتوثيق
    if (
      norm.includes('ملف') || norm.includes('سجل طبي') || norm.includes('سجلات') ||
      norm.includes('تذكر') || norm.includes('توثيق') || norm.includes('نموذج') ||
      norm.includes('اختصار') || norm.includes('توقيع') || norm.includes('اقرار') ||
      norm.includes('ارشيف') || norm.includes('شارت')
    ) {
      return 'MEDICAL_RECORDS'
    }

    // 6. Facility & Biomedical Safety (FMS) - الأجهزة الطبية والمرافق
    if (
      norm.includes('صيان') || norm.includes('معاير') || norm.includes('اجهزه') ||
      norm.includes('جهاز') || norm.includes('معدات') || norm.includes('ماكين') ||
      norm.includes('اكسجين') || norm.includes('اسطوانات') || norm.includes('غازات') ||
      norm.includes('حريق') || norm.includes('اطفاء') || norm.includes('كهرباء') ||
      norm.includes('مياه') || norm.includes('اعطال') || norm.includes('مولد') ||
      norm.includes('مرافق') || norm.includes('تسريب') || norm.includes('تلاجه') ||
      norm.includes('تبريد')
    ) {
      return 'FACILITY_BIOMEDICAL_SAFETY'
    }

    // 7. Administration, HR & Routine Non-Clinical Noise
    if (
      norm.includes('ملفات العاملين') || norm.includes('توصيف وظيف') || norm.includes('تهيئة') ||
      norm.includes('تقييم اداء') || norm.includes('شهادات تدريب') || norm.includes('قوه بشريه') ||
      norm.includes('رضا العاملين') || norm.includes('شكاوى') || norm.includes('شكاوي') ||
      norm.includes('سجل المشوره') || norm.includes('احواض') || norm.includes('نظافه') ||
      norm.includes('مخزن غير منظم') || norm.includes('سله مهملات') || norm.includes('سياسات غير محدثه') ||
      norm.includes('تحديث السياسات') || norm.includes('لوحه المفاتيح') || norm.includes('بوستر') ||
      norm.includes('قائمه باسماء') || norm.includes('قائمة بأسماء')
    ) {
      return 'ADMIN_HR_GOVERNANCE'
    }

    return 'OTHER_GENERAL'
  }

  // 8. Analyze Hospital Crisis (Cross-Synthesis of Findings & Google Sheet KPIs & OVR)
  // This extracts: «أكبر مشكلة تعاني منها المستشفى» بناءً على التحقيق الجنائي ثلاثي الأركان
  async analyzeHospitalCrisis(hospitalId) {
    // 1. Hospital Details
    const { data: hospital, error: hospErr } = await this.supabase
      .from('hospitals')
      .select('*')
      .eq('id', hospitalId)
      .single()

    if (hospErr || !hospital) throw new Error('المستشفى غير موجود')

    // 2. Fetch Findings
    const { data: findings } = await this.supabase
      .from('v_report_findings')
      .select('id, department_id, original_text, priority, status, repeat_count, departments(name)')
      .eq('hospital_id', hospitalId)

    // Enhanced Clinical Noise Filter: Ban and eliminate janitorial, minor housekeeping, petty supplies/kits, and routine administrative formalities
    const isTrivialNoise = (text) => {
      if (!text) return false
      const lower = text.toLowerCase()
      const noisePatterns = [
        'جرس استدعاء', 'جرس التمريض', 'ترمومتر', 'لمبة', 'لمبه', 'بوابة', 'بوابه', 'كالون', 'صنبور', 'سباكة', 'سباكه',
        'كرسي', 'مفتاح كهرباء', 'دهان', 'تربيزة', 'بلاط', 'أرضيات', 'ارضيات', 'حشائش', 'بلاعة', 'بلاعه',
        'شفاط', 'مضخه', 'دولاب غير مطابق', 'أرفف غير مطابقة', 'ارفف غير مطابقه', 'ارفف غير مطابقة', 'توفير كراسي', 'توفير غرفه ارشيف', 'توفير مستلزمات غسيل',
        'بوستر', 'بوسترات', 'race & pass', 'race &pass', 'race&pass', 'كارت فحص', 'كروت التعريف على الثلاجات', 'طفايه الحريق', 'طفاية الحريق', 'طفايات الحريق',
        'دون قفازات', 'بدون قفازات', 'ارتداء قفازات', 'كمامة', 'كمامه', 'مريلة', 'مريله', 'جاون',
        'توقيع الاطباء في بعض النماذج احادي', 'توقيع الصيدلى على الادويه في بعض الملفات', 'توقيع ثنائي للأطباء',
        'شطب وكشط', 'غير مرقمة', 'اعتماد دفتر', 'سجل المشورة', 'كتابه عليه التوقيع',
        'سجل الارشيف', 'سجل مكتوب يدوى', 'سجل مكتوب يدوي', 'احواض غير معرفه', 'احواض غير معرفة',
        'لا يوجد رقم خاص بمسؤل الشكاوي', 'المخزن غير منظم', 'الصيدلية غير منظمة', 'الصيدليه غير منظمه',
        'غير نظيفة', 'غير نظيفه', 'سلة مهملات', 'سلات مهملات', 'سله مهملات', 'اكياس نفايات',
        'ملفات العاملين', 'توصيف وظيفي', 'توصيف وظيفى', 'شهادات تدريب',
        'السياسات غير محدثه', 'السياسات غير محدثة', 'السياسات غير معتمده', 'السياسات غير معتمدة', 'تحديث السياسات', 'لوحه المفاتيح',
        'قائمه باسماء', 'قائمة بأسماء', 'qr code', 'شباتر', 'حقيبة الانسكاب', 'حقيبه الانسكاب', 'حقيبة انسكاب', 'حقيبه انسكاب',
        'انسكابات', 'انسكاب', 'كيت انسكاب', 'ماسة المواد الكيميائية', 'ماسه المواد الكيميائيه',
        'مقياس الكلور', 'غاسلة اعين', 'غاسله اعين', 'تلاجة الموتى', 'تلاجه الموتي', 'مفروشات النظيفه', 'المغسلة', 'المطبخ',
        'وجبات بدون تعريف', 'كروت صيانه وتعريف على الثلاجات', 'كراتين على الارض', 'كاراتين على الارض',
        'لوحه بالخدمات', 'لوحات حقوق وواجبات', 'لوحة حقوق وواجبات', 'حنفية بحوض', 'تسريب بالحنفية', 'تسريب ف الحنفية'
      ]
      return noisePatterns.some(t => lower.includes(t))
    }

    const eligibleFindings = (findings || []).filter(f => !isTrivialNoise(f.original_text))

    // 3. Fetch Google Sheet KPIs
    const { matchedName: matchedSheetName, kpis: sheetKpis } = await this.fetchHospitalKpisFromSheet(hospital.name)

    // 4. Fetch Hospital OVR Incidents (Filtered for Clinical Depth)
    const rawOvrRecords = await ovrService.getHospitalOVR(hospitalId)
    const eligibleOvrRecords = (rawOvrRecords || []).filter(o => !isTrivialNoise(o.description) && !isTrivialNoise(o.subcategory))

    // 5. Comprehensive Clinical Crisis Tracks (Covering all hospital specialties and departments)
    const CLINICAL_CRISIS_TRACKS = [
      {
        id: 'LABORATORY_BLOOD_BANK',
        name: 'المعمل وبنك الدم وسلامة نقل الدم والفحوصات الحرجة (Laboratory & Blood Safety)',
        category: 'الخدمات التشخيصية وبنك الدم',
        deptMatch: d => d.includes('معمل') || d.includes('مختبر') || d.includes('بنك الدم') || d.includes('تحاليل'),
        findingMatch: f => f.includes('معمل') || f.includes('بنك دم') || f.includes('عينات') || f.includes('كواشف') || f.includes('نقل دم') || f.includes('تطابق فصائل') || f.includes('نتائج حرجه') || f.includes('ثلاجة المعمل'),
        ovrMatch: o => o.includes('Lab') || o.includes('Blood') || o.includes('معمل') || o.includes('دم') || o.includes('عينة') || o.includes('مجلطة'),
        kpiMatch: k => (k.Indicator || '').includes('النتائج الحرجة') || (k.Indicator || '').includes('نقل الدم') || (k.Indicator || '').includes('المعمل')
      },
      {
        id: 'EMERGENCY_TRIAGE_CARE',
        name: 'قسم الطوارئ والاستقبال وفرز الحالات والإنعاش القلبي الرئوي (Emergency & Resuscitation)',
        category: 'الرعاية الحرجة والطوارئ',
        deptMatch: d => d.includes('طوارئ') || d.includes('استقبال') || d.includes('فرز') || d.includes('ترياج'),
        findingMatch: f => f.includes('طوارئ') || f.includes('استقبال') || f.includes('فرز') || f.includes('cpr') || f.includes('كود بلو') || f.includes('انعاش') || f.includes('صدمات'),
        ovrMatch: o => o.includes('Emergency') || o.includes('Triage') || o.includes('طوارئ') || o.includes('استقبال') || o.includes('انعاش') || o.includes('cpr'),
        kpiMatch: k => (k.Indicator || '').includes('التدهور') || (k.Indicator || '').includes('الإنذارات')
      },
      {
        id: 'NICU_PEDIATRICS',
        name: 'الحضانات ورعاية حديثي الولادة والمبتسرين وطب الأطفال (NICU & Neonatal Safety)',
        category: 'صحة الأطفال وحديثي الولادة',
        deptMatch: d => d.includes('حضان') || d.includes('مبتسر') || d.includes('اطفال') || d.includes('أطفال'),
        findingMatch: f => f.includes('حضان') || f.includes('مبتسر') || f.includes('طفل') || f.includes('اطفال') || f.includes('حديثي الولادة') || f.includes('صفراء') || f.includes('ضوئي'),
        ovrMatch: o => o.includes('NICU') || o.includes('حضان') || o.includes('مبتسر') || o.includes('اطفال'),
        kpiMatch: k => (k.Indicator || '').includes('وفيات الحضانات') || (k.Indicator || '').includes('الحضانات')
      },
      {
        id: 'ICU_CRITICAL_CARE',
        name: 'العناية المركزة والاستجابة للتدهور السريري والإنذارات الحرجة (ICU & Critical Care)',
        category: 'الرعاية الحرجة والطوارئ',
        deptMatch: d => d.includes('عناي') || d.includes('مركزه') || d.includes('icu'),
        findingMatch: f => f.includes('عناي') || f.includes('تدهور') || f.includes('تنفس صناعي') || f.includes('انذارات حرجه') || f.includes('قرح فراش') || f.includes('قساطر وريدية'),
        ovrMatch: o => o.includes('ICU') || o.includes('عناي') || o.includes('تنفس صناعي') || o.includes('ريسفنت'),
        kpiMatch: k => (k.Indicator || '').includes('وفيات العناية') || (k.Indicator || '').includes('التدهور الإكلينيكي') || (k.Indicator || '').includes('الإنذارات الحرجة')
      },
      {
        id: 'SURGICAL_OR_ANESTHESIA',
        name: 'العمليات الجراحية والتخدير والأمان الجراحي والوقت المستقطع (Surgical Safety & OR)',
        category: 'الخدمات الجراحية والتخدير',
        deptMatch: d => d.includes('عمليات') || d.includes('جراح') || d.includes('تخدير') || d.includes('افاقه'),
        findingMatch: f => f.includes('عمليات') || f.includes('جراح') || f.includes('وقت مستقطع') || f.includes('تخدير') || f.includes('موضع الجراح') || f.includes('افاقة'),
        ovrMatch: o => o.includes('Surgical') || o.includes('عمليات') || o.includes('جراح') || o.includes('تخدير') || o.includes('الوقت المستقطع'),
        kpiMatch: k => (k.Indicator || '').includes('الجراحة') || (k.Indicator || '').includes('تحديد موضع')
      },
      {
        id: 'MEDICATION_SAFETY_PHARMACY',
        name: 'الصيدلية وسلامة الدواء والأدوية عالية الخطورة وLASA (Medication Safety & Pharmacy)',
        category: 'إدارة واستخدام الدواء',
        deptMatch: d => d.includes('صيدل') || d.includes('دواء'),
        findingMatch: f => f.includes('صيدل') || f.includes('دواء') || f.includes('دوائ') || f.includes('كراش') || f.includes('عاليه الخطور') || f.includes('lasa') || f.includes('ترياق') || f.includes('التوافق الدوائي'),
        ovrMatch: o => o.includes('Medication') || o.includes('صيدل') || o.includes('دواء') || o.includes('محاليل') || o.includes('انسولين'),
        kpiMatch: k => (k.Indicator || '').includes('عالية الخطورة') || (k.Indicator || '').includes('المتشابهة') || (k.Indicator || '').includes('النتائج الدوائية العكسية')
      },
      {
        id: 'INFECTION_CONTROL_CSSD',
        name: 'مكافحة العدوى والتعقيم المركزي والعزل الطبي وإدارة النفايات (Infection Prevention & CSSD)',
        category: 'مكافحة العدوى والسلامة البيئية',
        deptMatch: d => d.includes('تعقيم') || d.includes('مكافحة العدوى') || d.includes('عزل') || d.includes('نفايات'),
        findingMatch: f => f.includes('تعقيم') || f.includes('اوتوكلاف') || f.includes('عزل') || f.includes('واقيات') || f.includes('نفايات خطره') || f.includes('مكافحه العدوى') || f.includes('غرفة النفايات'),
        ovrMatch: o => o.includes('Infection') || o.includes('PPE') || o.includes('تعقيم') || o.includes('عدوى') || o.includes('نفايات') || o.includes('وخز'),
        kpiMatch: k => (k.Indicator || '').includes('مكافحة العدوى') || (k.Indicator || '').includes('الحقن الآمن')
      },
      {
        id: 'HEMODIALYSIS_NEPHROLOGY',
        name: 'الغسيل الكلوي وسلامة محطة معالجة المياه والوصلات الوعائية (Hemodialysis Safety)',
        category: 'أمراض الكلى والغسيل الكلوي',
        deptMatch: d => d.includes('كلى') || d.includes('كلوي') || d.includes('غسيل'),
        findingMatch: f => f.includes('غسيل كلوي') || f.includes('محطة مياه') || f.includes('فلتر') || f.includes('غسيل دموي') || f.includes('فلاتر') || f.includes('عينة مياه'),
        ovrMatch: o => o.includes('Dialysis') || o.includes('كلى') || o.includes('غسيل كلوي'),
        kpiMatch: k => (k.Indicator || '').includes('الغسيل الكلوي') || (k.Indicator || '').includes('الكلى')
      },
      {
        id: 'MEDICAL_RECORDS_DOCUMENTATION',
        name: 'السجلات والملفات الطبية وتذاكر الاستقبال وحوكمة التوثيق (Medical Records Governance)',
        category: 'حوكمة السجلات والمعلومات السريرية',
        deptMatch: d => d.includes('ملف') || d.includes('سجل') || d.includes('تذاكر') || d.includes('ارشيف'),
        findingMatch: f => f.includes('تذكرة') || f.includes('ملف طبي') || f.includes('نموذج') || f.includes('اقرار') || f.includes('اختصارات') || f.includes('تسليم وتسلم'),
        ovrMatch: o => o.includes('Medical Records') || o.includes('Forms') || o.includes('تذاكر') || o.includes('ملف') || o.includes('اقرار') || o.includes('تسليم وتسلم'),
        kpiMatch: k => (k.Indicator || '').includes('الأوامر الشفهية') || (k.Indicator || '').includes('السجلات')
      },
      {
        id: 'BIOMEDICAL_EQUIPMENT_MAINTENANCE',
        name: 'الأجهزة والمعدات الطبية الحيوية والمعايرة والصيانة الدورية (Biomedical Equipment & FMS)',
        category: 'الأجهزة الطبية والسلامة الهندسية',
        deptMatch: d => d.includes('صيان') || d.includes('اجهزه') || d.includes('هندسي') || d.includes('غازات'),
        findingMatch: f => f.includes('معايره') || f.includes('جهاز معطل') || f.includes('صيانه دوريه') || f.includes('شبكة الغازات') || f.includes('اسطوانات اكسجين') || f.includes('مولد'),
        ovrMatch: o => o.includes('Maintenance') || o.includes('Device') || o.includes('Equipment') || o.includes('اعطال') || o.includes('صيانة') || o.includes('جهاز'),
        kpiMatch: k => (k.Indicator || '').includes('الصيانة') || (k.Indicator || '').includes('الأجهزة')
      },
      {
        id: 'PATIENT_SAFETY_NPSG',
        name: 'التحقق من هوية المريض ومطابقة الأساور ومنع السقوط (Patient Identification & Fall Safety)',
        category: 'سلامة المرضى (NPSG)',
        deptMatch: d => d.includes('تمريض') || d.includes('جودة'),
        findingMatch: f => f.includes('تعريف المريض') || f.includes('اسورة') || f.includes('اساور') || f.includes('سقوط مريض'),
        ovrMatch: o => o.includes('Patient identification') || o.includes('Fall') || o.includes('اسورة') || o.includes('تعريف المريض') || o.includes('سقوط'),
        kpiMatch: k => (k.Indicator || '').includes('التعريف الصحيح') || (k.Indicator || '').includes('الأخطاء في عناصر الرعاية')
      },
      {
        id: 'VERBAL_ORDERS_HANDOVER',
        name: 'الأوامر الشفهية والتسليم والتسلم الحرج بين المناوبات (Verbal Orders & Handover)',
        category: 'سلامة المرضى والاتصال الفعال',
        deptMatch: d => d.includes('داخلي') || d.includes('جناح'),
        findingMatch: f => f.includes('شفه') || f.includes('هاتف') || f.includes('تسليم وتسلم') || f.includes('isbar'),
        ovrMatch: o => o.includes('isbar') || o.includes('تسليم وتسلم') || o.includes('شفه') || o.includes('Handover'),
        kpiMatch: k => (k.Indicator || '').includes('الأوامر الشفهية')
      }
    ]

    const scoredTracks = []
    for (const track of CLINICAL_CRISIS_TRACKS) {
      const kpis = sheetKpis.filter(track.kpiMatch)
      const fList = eligibleFindings.filter(f => {
        const text = (f.original_text || '').toLowerCase()
        const dName = (f.departments?.name || '').toLowerCase()
        return track.deptMatch(dName) || track.findingMatch(text)
      })
      const ovrs = eligibleOvrRecords.filter(o => {
        const sub = (o.subcategory || '').toLowerCase()
        const cat = (o.category || '').toLowerCase()
        const desc = (o.description || '').toLowerCase()
        const full = `${sub} ${cat} ${desc}`
        return track.ovrMatch(full)
      })

      const hasKpi = kpis.length > 0
      const hasFinding = fList.length > 0
      const hasOvr = ovrs.length > 0
      const sourceCount = (hasKpi ? 1 : 0) + (hasFinding ? 1 : 0) + (hasOvr ? 1 : 0)

      // Must have at least 1 corroborating source with substantive evidence
      if (sourceCount < 2 && fList.length === 0 && ovrs.length === 0) continue

      const isTriple = sourceCount === 3
      const corroborationLevel = isTriple
        ? 'تطابق جنائي ثلاثي (3 من 3 مصادر)'
        : (sourceCount === 2 ? 'تطابق جنائي ثنائي (مصدران معتمدان)' : 'مبني على المرور الميداني وبلاغات الأطقم')

      const critKpis = kpis.filter(k => k.Alert_Level === 'Critical')
      const alertKpis = kpis.filter(k => k.Alert_Level === 'Alert' || k.Status === 'Risk')
      const recFindings = fList.filter(f => (f.repeat_count || 1) >= 2 || f.status === 'recurring')
      const normFindings = fList.filter(f => (f.repeat_count || 1) < 2 && f.status !== 'recurring')

      // Unbiased data-driven scoring: strictly reflect what is hurting THIS hospital
      const rawScore = (critKpis.length * 35) + (alertKpis.length * 15) + (recFindings.length * 20) + (normFindings.length * 10) + (ovrs.length * 8)
      const multiplier = isTriple ? 1.25 : 1.1
      const totalScore = Math.round(rawScore * multiplier)

      if (totalScore <= 0 && fList.length === 0) continue

      const critKpisEvidence = kpis
        .map(k => `• ${k.Indicator}: ${k.Value}% (حالة الخطر: ${k.Alert_Level || k.Status})`)
        .slice(0, 8)

      const findingsEvidence = fList
        .sort((a, b) => (b.repeat_count || 1) - (a.repeat_count || 1))
        .map(f => `• [${f.departments?.name || 'عام'}]: ${f.original_text} (تكرر ${f.repeat_count || 1} مرات)`)
        .slice(0, 8)

      const ovrsEvidence = ovrs
        .slice(0, 8)
        .map(o => `• [${o.date} - ${o.subcategory}]: ${o.description.length > 130 ? o.description.slice(0, 130) + '...' : o.description}`)

      scoredTracks.push({
        domain_id: track.id,
        domain_name: track.name,
        category: track.category,
        score: totalScore,
        source_count: sourceCount,
        is_triple_corroborated: isTriple,
        corroboration_level: corroborationLevel,
        findings_count: fList.length,
        kpis_count: kpis.length,
        ovr_count: ovrs.length,
        critical_kpis_evidence: critKpisEvidence,
        correlating_findings_evidence: findingsEvidence,
        ovr_incidents_evidence: ovrsEvidence
      })
    }

    scoredTracks.sort((a, b) => b.score - a.score)
    const primaryCrisis = scoredTracks[0] || null

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
        criticalSheetKpis: sheetKpis.filter(k => k.Alert_Level === 'Critical' || k.Status === 'Risk' || k.Alert_Level === 'Alert').length,
        totalOvrRecords: eligibleOvrRecords.length
      },
      eligible_crises: scoredTracks,
      primary_crisis: primaryCrisis,
      all_domains_ranked: scoredTracks
    }
  }

  // 9. AI Generation: 4-Pass Adversarial Investigation Loop (Investigate -> Ruthless Audit -> Hardening -> Supreme Certification)
  async generateProjectsForHospital(hospitalId, options = {}) {
    // Step A: Perform full integrated crisis analysis (Findings + Google Sheet KPIs + OVR)
    const crisisAnalysis = await this.analyzeHospitalCrisis(hospitalId)
    const hospital = crisisAnalysis.hospital
    const eligibleCrises = crisisAnalysis.eligible_crises || []

    if (eligibleCrises.length === 0) {
      throw new Error('لم يتم العثور على أي أزمة سريرية مستوفية لشرط التطابق متعدد المصادر بالمستشفى.')
    }

    // Strictly generate the top 3 major institutional improvement projects tailored to THIS hospital
    const count = 3
    const selectedCrises = eligibleCrises.slice(0, count)

    // Step B: Build verified ground-truth multi-source evidence dossier (Zero-guesswork baseline values)
    const verifiedGroundTruthDossier = selectedCrises.map((c, idx) => {
      const kpiLines = (c.critical_kpis_evidence || []).map(k => `• [مؤشر شيت جوجل]: ${k}`)
      const ovrLines = `• [بلاغات الحوادث العارضة OVR]: إجمالي ${c.ovr_count} بلاغ فعلي مسجل بالمنظومة لهذا المسار`
      const findingLines = `• [ملاحظات المرور والتفتيش]: إجمالي ${c.findings_count} ملاحظة وسلبية ميدانية مرصودة`
      return `
======================================================================
الأزمة السريرية رقم (${idx + 1}): [${c.domain_name}]
• التصنيف السريري: ${c.category || 'سلامة المرضى'}
• مستوى التطابق الجنائي: ${c.corroboration_level} (مجموع النقاط: ${c.score})

أرقام خط الأساس الحقيقية الثابتة (Ground Truth Metrics - يُمنع منعاً باتاً تخمين أو اختراع أرقام أخرى):
${kpiLines.length > 0 ? kpiLines.join('\n') : '• لا توجد مؤشرات رقمية بالشيت لهذا المسار'}
${ovrLines}
${findingLines}

أدلة الشواهد التفصيلية الموثقة:
١. الشاهد الأول (المرور الميداني والسلبيات):
${(c.correlating_findings_evidence || []).slice(0, 4).join('\n') || 'لا توجد سلبيات مرصودة'}

٢. الشاهد الثاني (شيت مؤشرات جوجل الرسمي بالمديرية):
${(c.critical_kpis_evidence || []).slice(0, 4).join('\n') || 'لا توجد مؤشرات مسجلة'}

٣. الشاهد الثالث (بلاغات OVR الحقيقية المسجلة من الطاقم الطبي والتمريضي):
${(c.ovr_incidents_evidence || []).slice(0, 4).join('\n') || 'لا توجد بلاغات مسجلة'}
======================================================================
`
    }).join('\n')

    console.log(`[ImprovementProjectsService] Starting 4-Pass Tailored Investigation for: ${hospital.name}...`)

    // --- PASS 1: Initial Deep Investigation & Candidate Charters ---
    const pass1System = `أنت المحقق الإكلينيكي الجنائي الأعلى وخبير جودة المستشفيات الحكومية. مهمتك دراسة ملف الأدلة الجنائية لـ 3 أزمات سريرية كبرى خاصة بمستشفى (${hospital.name}) حصراً وصياغة مسودة تحقيقية شاملة لـ 3 مشاريع تحسين جودة مؤسسية صلبة.

قواعد التخصيص والواقعية الصارمة (Anti-Homogenization & Ground-Level Reality):
1. يُمنع منعاً باتاً صياغة مشاريع نمطية أو عامة أو مكررة تبدو كقالب مسبق الصنع؛ يجب أن يعكس كل مشروع هوية مستشفى (${hospital.name}) وأقسامه المحددة.
2. حظر الحلول البرمجية الخيالية (Strict Ban on Software Fantasies):
   - يُمنع منعاً باتاً اختلاق حلول برمجية مستحيلة لا تناسب المستشفيات الحكومية مثل: (تطوير API Bridges، برامج LIMS v2.0 خاصة، أنظمة مزامنة Sync Engine مع Google Sheets، أو أتمتة غير موجودة).
   - الحلول يجب أن تكون «هندسة مسارات فيزيائية وإجرائية ملموسة وواقعية (Physical & Workflow Poka-Yoke)»:
     * استخدام أقفال بلاستيكية مرقمة تستعمل لمرة واحدة (Numbered Breakaway Disposable Seals) لكراش كارت مع سجل مطابقة يومي.
     * وضع شرائط تحذيرية فوسفورية حمراء وحواجز بصرية (Red Alert Barrier Tape) على أدراج أدوية LASA والعالية الخطورة.
     * التحقق المزدوج المستقل الإجباري (Independent Forced Double-Check) بتوقيع ممارسَين متزامنين (ممرضة + صيدلي / ممرضة + طبيب).
     * تطبيق التحقق بالترديد الإلزامي (Forced Read-Back) للأوامر الشفهية وقصرها على الطوارئ القصوى والإنعاش القلبي فقط.
     * سجلات سلسلة التبريد المعتمدة ذات التوقيع المزدوج (Cold Chain Dual-Sign Logs) لثلاجات المعمل وحفظ الأدوية.
     * فلاتر مطابقة العينات، وأكواد باركود ملصقة فورياً بجانب المريض.
3. حظر كتابة أسماء أشخاص نهائياً (Strict Role-Only Policy - NO Human Names):
   - يُمنع منعاً باتاً كتابة أي أسماء أشخاص حقيقيين أو وهميين (مثل "د. ليلى" أو "د. فلان" أو أي اسم ثنائي/ثلاثي).
   - يجب كتابة «المسمى الوظيفي فقط» (Job Roles/Titles Only):
     * project_lead: مسمى وظيفي حصراً مثل "رئيس قسم المختبرات وبنك الدم بالمستشفى" أو "رئيس قسم الصيدلة بالمستشفى" أو "استشاري ورئيس قسم العناية المركزة".
     * team_members: مسميات وظيفية سريرية واقعية فقط مثل ["صيدلي إكلينيكي أول", "مشرفة تمريض القسم", "أخصائي سلامة المرضى وتوكيد الجودة", "طبيب مقيم بالقسم"]. يُمنع وضع وظائف غير موجودة بالمستشفيات العامة مثل "مهندس نظم" أو "مبرمج".
4. خط الأساس والمؤشرات:
   - خط الأساس (Baseline) يجب أن يقتبس حرفياً الأرقام الفعلية المذكورة في ملف الأدلة دون تخمين.
   - مستهدف بلاغات OVR: يُمنع استهداف "صفر بلاغات" لأنه يدمر ثقافة الإبلاغ؛ المستهدف هو: «صفر أخطاء ضارة وحوادث جسيمة مع إغلاق 100% من البلاغات وفق المهلة الزمنية (48 ساعة)».`

    const pass1User = `بيانات المستشفى: ${hospital.name}
ملف الأدلة الجنائية للأزمات المعتمدة بالمستشفى:
${verifiedGroundTruthDossier}

صغ المسودة التحقيقية الأولية للمشاريع الثلاثة بأرقام خط الأساس الحقيقية الموثقة، ومسميات وظيفية واقعية فقط، وبوابات فحص فيزيائية وإجرائية قابلة للتطبيق غداً صباحاً بالمستشفى الحكومي.`

    const p1Data = await callGroqWithRetry({
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: pass1System },
        { role: 'user', content: pass1User }
      ],
      temperature: 0.2,
      max_tokens: 2200
    })
    const pass1Draft = p1Data.choices[0].message.content
    console.log('[ImprovementProjectsService] Pass 1 (Forensic Investigation) completed.')

    // --- PASS 2: Ruthless Forensic Audit & Attack ---
    const pass2System = `أنت رئيس لجان التدقيق الصارم بالهيئة العامة للاعتماد والرقابة الصحية (Chief Clinical Auditor).
دورك أن تتقمص شخصية المراجع الصارم المتشدد الذي يهاجم أي ثغرة أو حل رخو بالدليل:
1. هل هناك أي حل يعتمد على التدريب النظري أو التوعية أو المنشورات الورقية؟ ارفضه فوراً واشترط بوابات Poka-Yoke فيزيائية صلبة وتحقق مزدوج مستقل.
2. هل اقترح الفريق حلولاً برمجية خيالية غير قابلة للتطبيق (مثل APIs أو Sync Engines أو ربط بـ Google Sheets)؟ ارفضها واشترط أقفالاً فيزيائية مرقمة وحواجز بصرية وسجلات مطابقة.
3. هل كتب الفريق أي أسماء أشخاص لقائد المشروع أو الأعضاء؟ ارفض أي اسم شخص واشترط مسميات وظيفية رسمية فقط.
4. هل استهدف المشروع "صفر بلاغات OVR" بما يخالف ثقافة السلامة العادلة (Just Culture)؟ ارفض ذلك واشترط استهداف صفر أخطاء ضارة وحوادث جسيمة مع تشجيع الإبلاغ وإغلاقه في 48 ساعة.
5. هل التزم الفريق حرفياً بأرقام خط الأساس (Baseline) الواردة في ملف الأدلة؟ هاجم أي رقم وهمي أو مخترع.
اكتب تقرير التدقيق الجنائي الصارم والمآخذ الإكلينيكية على المسودة دون أي مجاملة.`

    const pass2User = `المسودة المقترحة للمشاريع الثلاثة:
${pass1Draft}

ملف الأدلة الجنائية الأصلي:
${verifiedGroundTruthDossier}

اكتب تقرير التدقيق الجنائي الصارم والمآخذ الإكلينيكية على المسودة.`

    const p2Data = await callGroqWithRetry({
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: pass2System },
        { role: 'user', content: pass2User }
      ],
      temperature: 0.2,
      max_tokens: 2200
    })
    const pass2Critique = p2Data.choices[0].message.content
    console.log('[ImprovementProjectsService] Pass 2 (Ruthless Audit Critique) completed.')

    // --- PASS 3: Radical Re-Engineering & Hardening ---
    const pass3System = `أنت كبير مهندسي النظم السريرية ورئيس المجلس الاستشاري للجودة (Chief Clinical Systems Architect).
تلقيت تقرير التدقيق الصارم، ومهمتك إعادة هندسة وبناء المشاريع الثلاثة وسد كل ثغرة نقدية:
1. استبدال أي إجراء إداري أو توعوي أو خيال برمجي ببوابات Poka-Yoke فيزيائية وإجرائية صلبة (أقفال بلاستيكية مرقمة لكراش كارت، حواجز بصرية فوسفورية لأدوية LASA، تحقق مزدوج مستقل إجباري بتوقيعين، وقصر الأوامر الشفهية على الطوارئ بالترديد الفوري).
2. حظر أسماء الأشخاص والوظائف التقنية الدخيلة: استبدال أي أسماء أشخاص حقيقيين أو وهميين (مثل د. فلان)، واستبعاد الوظائف الدخيلة (مثل مهندس نظم، مبرمج، محلل نظم، مسؤول IT) بمسميات وظيفية إكلينيكية وتمريضية رسمية بالمستشفيات الحكومية فقط (مثل: رئيس قسم المختبرات وبنك الدم بالمستشفى، رئيس قسم الصيدلة بالمستشفى، استشاري ورئيس قسم العناية المركزة، صيدلي إكلينيكي أول، مشرفة تمريض القسم، أخصائي جودة، طبيب مقيم).
3. ضبط مستهدف بلاغات OVR ليكون (صفر أخطاء ضارة وحوادث جسيمة مع إغلاق 100% من البلاغات وفق المهلة) لتعزيز ثقافة الإبلاغ.
4. ضبط أرقام خط الأساس لتكون مستخرجة 100% من أرقام شيت جوجل وبلاغات OVR الثابتة بلا أي تخمين.`

    const pass3User = `تقرير التدقيق الصارم:
${pass2Critique}

المسودة السابقة:
${pass1Draft}

أعد صياغة وهندسة المشاريع الثلاثة بحلول قاطعة وصلبة تعالج كافة مآخذ التدقيق.`

    const p3Data = await callGroqWithRetry({
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: pass3System },
        { role: 'user', content: pass3User }
      ],
      temperature: 0.15,
      max_tokens: 2600
    })
    const pass3Overhaul = p3Data.choices[0].message.content
    console.log('[ImprovementProjectsService] Pass 3 (Re-Engineering & Hardening) completed.')

    // --- PASS 4: Supreme Certification & Final Institutional JSON Charter ---
    const pass4System = `أنت المجلس الإكلينيكي الأعلى لاعتماد المنشآت وتوكيد الجودة (Supreme Accreditation & Quality Council).
مهمتك إصدار ميثاق مشاريع التحسين الثلاثة المؤسسية المعتمدة النهائية بصيغة JSON فقط.

قواعد إلزامية حاسمة:
- المسمى الوظيفي الإكلينيكي فقط (Job Roles/Titles Only): يُمنع منعاً باتاً كتابة أي أسماء أشخاص حقيقيين أو وهميين في project_lead أو team_members؛ كما يُمنع كتابة وظائف تقنية شاذة بالمستشفيات الحكومية مثل (مهندس نظم، محلل نظم، مبرمج، فريق IT). اكتب المسمى الوظيفي الرسمي فقط:
  * project_lead: مسمى وظيفي إكلينيكي/إداري رسمي فقط (مثلاً: رئيس قسم المختبرات وبنك الدم بالمستشفى، رئيس قسم الصيدلة بالمستشفى، استشاري ورئيس قسم الرعاية المركزة).
  * team_members: مسميات وظيفية سريرية واقعية بالمستشفيات الحكومية (مثلاً: صيدلي إكلينيكي أول، مشرفة تمريض القسم، أخصائي سلامة المرضى وتوكيد الجودة، طبيب مقيم بالقسم).
- خط الأساس: مطابق حرفياً لملف الأدلة دون تخمين.
- مستهدف بلاغات OVR: «صفر أخطاء ضارة وحوادث جسيمة (Zero Harm) / إغلاق 100% من البلاغات خلال 48 ساعة».
- التدخلات: حلول فيزيائية ومسار عمل صلب (Poka-Yoke فيزيائي وإجرائي، أقفال مرقمة، حواجز بصرية، تحقق مزدوج مستقل بتوقيعين، ومسؤوليات إكلينيكية وتمريضية فقط).

الصيغة المطلوبة (JSON فقط ومصفوفة projects تحتوي على 3 مشاريع):
{
  "projects": [
    {
      "title": "عنوان المشروع السريري الرصين المعبر عن المسار والحل الهندسي الصلب",
      "department_name": "القسم المعني",
      "category": "سلامة المرضى / إدارة واستخدام الدواء / الرعاية الحرجة والطوارئ / الخدمات التشخيصية وبنك الدم",
      "priority": "high",
      "forensic_corroboration": {
        "corroboration_level": "تطابق جنائي ثلاثي (3 من 3 مصادر) أو تطابق جنائي ثنائي (2 من 3 مصادر)",
        "source_1_field_finding": "نص الشاهد الأول الميداني",
        "source_2_sheet_kpi": "اسم المؤشر من شيت جوجل مع القيمة الفعلية المسجلة",
        "source_3_staff_ovr": "واقعة وبلاغ OVR الحقيقي المسجل من الطاقم"
      },
      "why_hard_to_solve": "شرح لماذا المشكلة مستعصية ولا تُحل بالتدريب البسيط وما هي عوائق مسار العمل",
      "root_cause_analysis": "تحليل الأسباب الجذرية النظامية للخلل في مسار العمل (Process Failure)",
      "prioritization_matrix": {
        "patient_safety_risk": 5,
        "volume_frequency": 4,
        "process_complexity": 5,
        "strategic_alignment": 5,
        "total_score": 19,
        "eligibility_justification": "أزمة سريرية حيوية معتمدة بأدلة إكلينيكية صلبة تمس سلامة حياة المرضى."
      },
      "problem_statement": "بيان المشكلة يربط شهود الإثبات دون اختلاق وفيات غير موثقة",
      "baseline_metrics": "أرقام خط الأساس الحقيقية المستخرجة حرفياً من الشيت وبلاغات OVR",
      "smart_goal": "الهدف الذكي القابل للقياس وموعد الإنجاز المستهدف",
      "evidence_reference": "معايير الهيئة العامة للاعتماد والرقابة الصحية (GAHAR)",
      "target_duration_weeks": 12,
      "kpis": [
        {
          "name": "اسم المؤشر الدقيق من شيت جوجل أو بلاغات OVR",
          "type": "process أو outcome",
          "baseline": "القيمة الحالية الفعلية الحقيقية (مثلاً 90% أو 31 بلاغ فعلي)",
          "target": "المستهدف المنشود الواقعي",
          "frequency": "شهري"
        }
      ],
      "interventions": [
        { "step": "بوابة Poka-Yoke فيزيائية أو إجرائية / تحقق مزدوج مستقل / أقفال مرقمة / حواجز بصرية / مسار مغلق", "responsible": "المسمى الوظيفي الإكلينيكي أو التمريضي المسؤول", "duration": "أسبوعين" }
      ],
      "project_lead": "المسمى الوظيفي فقط (مثلاً: رئيس قسم المختبرات وبنك الدم بالمستشفى - يُمنع منعاً باتاً كتابة أي أسماء أشخاص)",
      "team_members": ["صيدلي إكلينيكي أول", "مشرفة تمريض القسم", "أخصائي سلامة المرضى وتوكيد الجودة", "طبيب مقيم بالقسم"],
      "linked_findings_summary": ["نص السلبية الميدانية ذات الصلة"]
    }
  ]
}`

    const pass4User = `المشاريع بعد إعادة هندستها وسد الثغرات في Pass 3:
${pass3Overhaul}

ملف الأدلة الجنائية الأصلي بأرقامه الحقيقية الثابتة:
${verifiedGroundTruthDossier}

أخرج ميثاق المشاريع الثلاثة النهائي المعتمد بصيغة JSON فقط.`

    const p4Data = await callGroqWithRetry({
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: pass4System },
        { role: 'user', content: pass4User }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 5000
    })

    const choice = p4Data.choices?.[0]
    const content = choice?.message?.content || '{}'
    const parsed = JSON.parse(content)
    const generatedList = (parsed.projects || []).slice(0, 3)

    if (!Array.isArray(generatedList) || generatedList.length === 0) {
      throw new Error('لم يقم الذكاء الاصطناعي بتوليد مشاريع تحسين مطابقة للمواصفات.')
    }

    console.log('[ImprovementProjectsService] Pass 4 (Supreme Certification) completed. Applying Ground-Truth & Role Sanitization...')

    // Step C: Ground-Truth & Clinical Role Sanitizer (Strictly Job Titles & Realistic Metrics)
    generatedList.forEach((p, idx) => {
      const matchingCrisis = selectedCrises[idx] || selectedCrises.find(c => 
        (p.category && c.category && p.category.includes(c.category)) ||
        (p.title && c.domain_name && (p.title.includes(c.domain_name.slice(0, 10)) || c.domain_name.includes(p.title.slice(0, 10))))
      ) || selectedCrises[idx]

      if (matchingCrisis) {
        // Anchor baseline_metrics text
        p.baseline_metrics = `مؤشرات شيت جوجل: ${(matchingCrisis.critical_kpis_evidence || []).join(' | ') || 'لا توجد'} - بلاغات OVR: ${matchingCrisis.ovr_count} بلاغ فعلي مسجل - ملاحظات المرور: ${matchingCrisis.findings_count} ملاحظة ميدانية`

        // Anchor KPIs
        if (Array.isArray(p.kpis)) {
          p.kpis.forEach(kpi => {
            const name = kpi.name || ''
            if (name.includes('OVR') || name.includes('حادث') || name.includes('بلاغ')) {
              kpi.baseline = `${matchingCrisis.ovr_count} بلاغ فعلي مسجل بالمنظومة`
              kpi.target = 'صفر أخطاء ضارة وحوادث جسيمة (مع إغلاق 100% من البلاغات خلال 48 ساعة)'
            } else if (name.includes('ملاحظ') || name.includes('سلبي') || name.includes('مرور')) {
              kpi.baseline = `${matchingCrisis.findings_count} ملاحظة وسلبية ميدانية مرصودة`
              kpi.target = '0 ملاحظات (إغلاق وتصحيح 100%)'
            } else if (matchingCrisis.critical_kpis_evidence && matchingCrisis.critical_kpis_evidence.length > 0) {
              for (const sheetKpiText of matchingCrisis.critical_kpis_evidence) {
                const parts = sheetKpiText.split('=')
                const kpiTitle = parts[0]?.trim() || ''
                const kpiValPart = parts[1] || ''
                const matchVal = kpiValPart.match(/([0-9.]+%?)/)
                if (kpiTitle && (name.includes(kpiTitle.slice(0, 12)) || kpiTitle.includes(name.slice(0, 12)))) {
                  if (matchVal && matchVal[1]) {
                    kpi.baseline = matchVal[1]
                  }
                }
              }
            }
          })
        }
      }

      // 1. Sanitize project_lead: STRICTLY NO HUMAN NAMES! Job roles/titles ONLY.
      p.project_lead = sanitizeClinicalLead(p.project_lead, p.department_name, p.category)

      // 2. Sanitize team_members: STRICTLY JOB ROLES / TITLES ONLY
      p.team_members = sanitizeClinicalTeamMembers(p.team_members, p.department_name, p.category)

      // 3. Sanitize interventions: remove any software API / sync engine / IT hallucinations
      if (Array.isArray(p.interventions)) {
        p.interventions = p.interventions.map(it => {
          let step = typeof it === 'string' ? it : (it.step || '')
          let responsible = typeof it === 'object' && it.responsible
            ? sanitizeResponsibleRole(it.responsible, p.department_name, p.category)
            : `رئيس قسم ${p.department_name || 'القسم'} ومشرفة التمريض`
          
          if (step.includes('API Bridge') || step.includes('Sync Engine') || step.includes('Google Sheet') || step.includes('LIMS v2.0')) {
            step = 'تطبيق آلية التحقق المزدوج المستقل (Independent Dual Verification) وسجلات المطابقة الإلزامية قبل كل إجراء'
          }
          if (step.includes('قفل منطقي (Lock‑out) في CPOE') || step.includes('CPOE') || step.includes('قفل منطقي')) {
            step = 'تطبيق قائمة التحقق السريرية الإجبارية (Mandatory Clinical Checklist) ومطابقة الهوية الثنائية قبل تنفيذ الإجراء'
          }
          return typeof it === 'string' ? step : { ...it, step, responsible }
        })
      }
    })

    // Step D: Save and return generated projects
    const savedProjects = []
    for (const p of generatedList) {
      const targetDate = new Date()
      targetDate.setDate(targetDate.getDate() + ((p.target_duration_weeks || 12) * 7))

      const projectRecord = {
        hospital_id: hospital.id,
        hospital_name: hospital.name,
        title: p.title || 'مشروع تحسين جودة سريري',
        department_name: p.department_name || 'عام',
        category: p.category || 'سلامة المرضى',
        priority: p.priority || 'high',
        status: 'draft',
        problem_statement: p.problem_statement || p.problem || 'بيان المشكلة قيد القياس والتدقيق',
        baseline_metrics: p.baseline_metrics || 'مستند إلى شيت مؤشرات الأداء الرسمي بالمديرية وبلاغات OVR',
        smart_goal: p.smart_goal || p.goal || 'رفع نسبة الامتثال لحزمة التدابير الإكلينيكية إلى 95% خلال 12 أسبوعاً',
        evidence_reference: p.evidence_reference || p.evidence || 'معايير الهيئة العامة للاعتماد والرقابة الصحية (GAHAR)',
        target_completion_date: targetDate.toISOString().split('T')[0],
        kpis: p.kpis || [],
        interventions: p.interventions || [],
        project_lead: p.project_lead || `رئيس ${p.department_name || 'القسم'} بالمستشفى`,
        team_members: p.team_members || [],
        estimated_duration_weeks: p.target_duration_weeks || 12,
        linked_findings_summary: p.linked_findings_summary || p.linked_findings || [],
        prioritization_matrix: p.prioritization_matrix || null,
        why_hard_to_solve: p.why_hard_to_solve || '',
        root_cause_analysis: p.root_cause_analysis || '',
        forensic_corroboration: p.forensic_corroboration || null,
        directorate_notes: `مشروع تحسين جودة مؤسسي معتمد عبر التدقيق الجنائي الرباعي (4 دورات نقد متتالية) وتطابق ثلاثي الأركان (${p.forensic_corroboration?.corroboration_level || 'مصدران أو أكثر'})`
      }

      const saved = await this.saveProject(projectRecord)
      savedProjects.push(saved)
    }

    return savedProjects
  }
}
