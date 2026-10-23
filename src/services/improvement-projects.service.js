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

  if (text.includes('تدفق') || text.includes('سعة') || text.includes('خروج') || text.includes('أسرة') || text.includes('flow')) {
    return {
      lead: 'مدير الإدارة الطبية ورئيس لجنة إدارة التدفق والأسرة بالمستشفى',
      team: [
        'مشرفة التمريض العام بالمستشفى',
        'أخصائي سلامة المرضى وتوكيد الجودة',
        'صيدلي إكلينيكي أول',
        'طبيب مقيم باطنة وجراحة'
      ]
    }
  }

  if (text.includes('قلب') || text.includes('stemi') || text.includes('جلطة') || text.includes('مذيب') || text.includes('d2n')) {
    return {
      lead: 'استشاري أمراض القلب ورئيس قسم الطوارئ بالمستشفى',
      team: [
        'مشرفة تمريض قسم الطوارئ',
        'طبيب مقيم رعاية قلب وطوارئ',
        'صيدلي إكلينيكي عناية حرجة',
        'أخصائي سلامة المرضى وتوكيد الجودة'
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
        'لوحه بالخدمات', 'لوحات حقوق وواجبات', 'لوحة حقوق وواجبات', 'حنفية بحوض', 'تسريب بالحنفية', 'تسريب ف الحنفية',
        'لا يوجد i.d', 'بطاقة تعريف', 'بطاقات تعريف', 'كارنيه', 'كارنيهات', 'قائمة الاختصارات', 'قائمه الاختصارات',
        'اختصارات ورموز', 'اختصارات بالملف', 'اختصارات ف التذكره', 'بدون تاريخ اصدار', 'قائمه ثبات التطعيمات',
        'اسلاك مكشوفه', 'اسلاك كهرباء'
      ]
      return noisePatterns.some(t => lower.includes(t))
    }

    const eligibleFindings = (findings || []).filter(f => !isTrivialNoise(f.original_text))

    // 3. Fetch Google Sheet KPIs
    const { matchedName: matchedSheetName, kpis: sheetKpis } = await this.fetchHospitalKpisFromSheet(hospital.name)

    // 4. Fetch Hospital OVR Incidents (Filtered for Clinical Depth)
    const rawOvrRecords = await ovrService.getHospitalOVR(hospitalId)
    const eligibleOvrRecords = (rawOvrRecords || []).filter(o => !isTrivialNoise(o.description) && !isTrivialNoise(o.subcategory))

    // 5. High-Impact Clinical & Operational Pathways (IHI, NHS & GAHAR Standards)
    const CLINICAL_CRISIS_TRACKS = [
      {
        id: 'ACUTE_CARDIAC_STEMI_D2N',
        name: 'احتشاء عضلة القلب الحاد وزمن بدء إذابة الجلطة (Door-to-Needle STEMI Pathway)',
        category: 'الرعاية الحرجة والقلبية الطارئة',
        deptMatch: d => d.includes('طوارئ') || d.includes('استقبال') || d.includes('قلب'),
        findingMatch: f => f.includes('رسم قلب') || f.includes('ecg') || f.includes('جلطة') || (f.includes('تدهور') && f.includes('طوارئ')),
        ovrMatch: o => (o.includes('Cardiac') || o.includes('ecg') || o.includes('رسم قلب') || o.includes('ألم بالصدر') || o.includes('جلطة')) && !o.includes('غسيل'),
        kpiMatch: k => (k.Indicator || '').includes('التدهور') || (k.Indicator || '').includes('الإنذارات')
      },
      {
        id: 'ICU_VENTILATOR_VAP_BUNDLE',
        name: 'حزمة العناية بالتنفس الصناعي وخفض وفيات الرعاية والالتهاب الرئوي (IHI Ventilator Bundle & ICU Mortality)',
        category: 'الرعاية المركزة ومكافحة العدوى',
        deptMatch: d => d.includes('عناي') || d.includes('مركزه') || d.includes('icu'),
        findingMatch: f => f.includes('عناي') || f.includes('تنفس صناعي') || f.includes('ريسفنت') || f.includes('قرح فراش'),
        ovrMatch: o => o.includes('ICU') || o.includes('تنفس صناعي') || o.includes('ريسفنت') || o.includes('Ventilator'),
        kpiMatch: k => (k.Indicator || '').includes('وفيات العناية') || (k.Indicator || '').includes('اشغال الأسرة في العناية') || (k.Indicator || '').includes('دوران السرير في الرعاية')
      },
      {
        id: 'PATIENT_FLOW_CAPACITY_DISCHARGE',
        name: 'إدارة التدفق السريري والخروج المبكر لكسر اختناق سعة الأسرة (Criteria-Led Discharge & Patient Flow)',
        category: 'إدارة التدفق السريري وسعة المنشأة',
        deptMatch: d => d.includes('داخلي') || d.includes('تذاكر') || d.includes('استقبال') || d.includes('طوارئ'),
        findingMatch: f => f.includes('خروج') || f.includes('حجز') || f.includes('احالة') || f.includes('تكدس') || f.includes('تذاكر غير مكتملة'),
        ovrMatch: o => o.includes('تكدس') || o.includes('تأخر حجز') || o.includes('ازدحام') || o.includes('طوارئ غير مكتمل'),
        kpiMatch: k => (k.Indicator || '').includes('دوران السرير') || ((k.Indicator || '').includes('اشغال الأسرة') && parseFloat(k.Value || 0) > 80)
      },
      {
        id: 'SEPSIS_HOUR_ONE_BUNDLE',
        name: 'حزمة إنقاذ الإنتان والصدمة التسممية في الساعة الذهبية (Hour-1 Sepsis Resuscitation Bundle)',
        category: 'الرعاية الحرجة ومكافحة العدوى',
        deptMatch: d => d.includes('عناي') || d.includes('طوارئ'),
        findingMatch: f => f.includes('تسمم') || f.includes('ميكروب') || f.includes('عدوى دم') || f.includes('صدمة انتانية'),
        ovrMatch: o => (o.includes('Infection') || o.includes('Sepsis') || o.includes('تسمم دم') || o.includes('تجرثم')) && !o.includes('غسيل'),
        kpiMatch: k => (k.Indicator || '').includes('العدوى المصاحبة')
      },
      {
        id: 'SAFE_INJECTIONS_INFUSION_SAFETY',
        name: 'ممارسات الحقن الآمن ومأمونية المحاليل الوريدية لمنع تجرثم الدم (Safe Injection Practices & IV Line Safety)',
        category: 'مكافحة العدوى وسلامة المرضى',
        deptMatch: d => d.includes('تمريض') || d.includes('مكافحة العدوى') || d.includes('ملاحظة') || d.includes('داخلي'),
        findingMatch: f => f.includes('حقن') || f.includes('محاليل') || f.includes('ثقب') || f.includes('سرنج') || f.includes('كانولا') || f.includes('وخز'),
        ovrMatch: o => o.includes('Safe Injection') || o.includes('حقن') || o.includes('وخز') || o.includes('سرنج') || o.includes('حامل محاليل'),
        kpiMatch: k => (k.Indicator || '').includes('الحقن الآمن') || (k.Indicator || '').includes('الواقيات الشخصية')
      },
      {
        id: 'DEFIBRILLATOR_RESUSCITATION_READINESS',
        name: 'الجاهزية التشغيلية لأجهزة الصدمات الكهربائية وسرعة استجابة الإنعاش (Defibrillator & Code Blue Readiness)',
        category: 'الأجهزة الطبية والسلامة الهندسية / الرعاية الحرجة',
        deptMatch: d => d.includes('طوارئ') || d.includes('عناي'),
        findingMatch: f => f.includes('صدمات') || f.includes('dc shock') || f.includes('كود بلو') || f.includes('code blue'),
        ovrMatch: o => o.includes('صدمات') || o.includes('dc shock') || o.includes('كود بلو') || o.includes('code blue'),
        kpiMatch: k => (k.Indicator || '').includes('إصلاح الأجهزة')
      },
      {
        id: 'SURGICAL_SAFETY_BUNDLE',
        name: 'حزمة الأمان الجراحي والوقاية من عدوى موضع الجراحة (Surgical Safety Checklist & SSI Prevention)',
        category: 'الخدمات الجراحية والتخدير',
        deptMatch: d => d.includes('عمليات') || d.includes('جراح') || d.includes('تخدير'),
        findingMatch: f => f.includes('عمليات') || f.includes('جراح') || f.includes('وقت مستقطع') || f.includes('time out'),
        ovrMatch: o => o.includes('Surgical') || o.includes('عمليات جراحية') || o.includes('الوقت المستقطع'),
        kpiMatch: k => (k.Indicator || '').includes('الجراحة التفقدية')
      },
      {
        id: 'NEONATAL_RDS_HYPOTHERMIA_NICU',
        name: 'إنعاش حديثي الولادة والمبتسرين ومتلازمة الضائقة التنفسية بالحضان (Neonatal RDS & Resuscitation)',
        category: 'صحة الأطفال وحديثي الولادة',
        deptMatch: d => d.includes('حضان') || d.includes('مبتسر'),
        findingMatch: f => f.includes('سيباب') || f.includes('تنفس صناعي بالحضان') || f.includes('انعاش مبتسر') || f.includes('ضائقة تنفسية') || f.includes('انقطاع تنفس') || f.includes('وفيات الحضان'),
        ovrMatch: o => (o.includes('إنعاش') || o.includes('تنفس صناعي') || o.includes('سيباب') || o.includes('RDS')) && (o.includes('حضان') || o.includes('NICU')),
        kpiMatch: k => ((k.Indicator || '').includes('وفيات الحضان') && parseFloat(k.Value || 0) > 0) || (k.Indicator || '').includes('دوران السرير في الحضان')
      },
      {
        id: 'HEMODIALYSIS_SAFETY_WATER_TREATMENT',
        name: 'سلامة جلسات الغسيل الكلوي ومحطة معالجة المياه والوقاية من التجلط وتلوث الوصلات (Hemodialysis Safety & Water Treatment)',
        category: 'الخدمات الكلوية التخصصية وسلامة المرضى',
        deptMatch: d => d.includes('كلى') || d.includes('غسيل') || d.includes('dialysis'),
        findingMatch: f => f.includes('غسيل كلوي') || f.includes('محطة المياه') || f.includes('فلتر') || f.includes('وصلات') || f.includes('معالجة المياه') || f.includes('نتائج حرجه الاكلينيكيه او الفسيولوجيه'),
        ovrMatch: o => o.includes('الغسيل الكلوي') || o.includes('معالجة المياه') || o.includes('تجلط بالدم بالوصلات') || o.includes('ماكينات'),
        kpiMatch: k => (k.Indicator || '').includes('الغسيل الكلوي') || (k.Indicator || '').includes('الكلى')
      },
      {
        id: 'LABORATORY_BLOOD_TRANSFUSION',
        name: 'سلامة ومأمونية نقل الدم ومطابقة الفصائل بجانب سرير المريض (Safe Bedside Blood Transfusion Verification)',
        category: 'الخدمات التشخيصية وبنك الدم',
        deptMatch: d => d.includes('بنك الدم') || d.includes('نقل الدم'),
        findingMatch: f => f.includes('نقل دم') || f.includes('تطابق فصائل') || f.includes('كيس دم') || f.includes('فصيلة الدم'),
        ovrMatch: o => (o.includes('نقل دم') || o.includes('كيس دم') || o.includes('فصائل الدم') || o.includes('Blood Transfusion')) && !o.includes('غسيل كلوي'),
        kpiMatch: k => {
          const ind = (k.Indicator || '')
          return !ind.includes('الكشف الدوري') && !ind.includes('المحولة من العيادات') && (ind.includes('نقل الدم') || ind.includes('بنك الدم') || ind.includes('مشتقات الدم'))
        }
      }
    ]

    // Helper: Filter only KPIs indicating real deficiencies/risks (rejecting Normal, Target Achieved, and 0% mortality/infection)
    const isDeficientKpi = (k) => {
      if (!k) return false
      const alert = (k.Alert_Level || '').trim().toLowerCase()
      const status = (k.Status || '').trim().toLowerCase()
      if (alert === 'normal' || status === 'normal' || status === 'good' || status === 'target_achieved') {
        return false
      }
      const ind = (k.Indicator || '').toLowerCase()
      const val = parseFloat(k.Value || 0)
      if ((ind.includes('وفيات') || ind.includes('عدوى') || ind.includes('تدهور') || ind.includes('انتظار')) && val === 0) {
        return false
      }
      return alert === 'critical' || alert === 'alert' || status === 'risk' || (val > 0 && alert !== 'normal')
    }

    const scoredTracks = []
    for (const track of CLINICAL_CRISIS_TRACKS) {
      const deficientKpis = sheetKpis.filter(k => track.kpiMatch(k) && isDeficientKpi(k))
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

      const hasKpi = deficientKpis.length > 0
      const hasFinding = fList.length > 0
      const hasOvr = ovrs.length > 0
      const sourceCount = (hasKpi ? 1 : 0) + (hasFinding ? 1 : 0) + (hasOvr ? 1 : 0)

      // Strict Criterion: A domain CANNOT be a project crisis if it has ZERO findings AND ZERO deficient KPIs!
      // (Loose OVR keyword matches alone cannot manufacture an improvement project without any finding or KPI failure)
      if (deficientKpis.length === 0 && fList.length === 0) continue

      // Must have at least 2 corroborating sources OR at least 2 distinct field findings/recurring issues
      if (sourceCount < 2 && fList.length < 2) continue

      const isTriple = sourceCount === 3
      const corroborationLevel = isTriple
        ? 'تطابق جنائي ثلاثي (3 من 3 مصادر)'
        : (sourceCount === 2 ? 'تطابق جنائي ثنائي (مصدران معتمدان)' : 'مبني على المرور الميداني الموثق')

      const critKpis = deficientKpis.filter(k => k.Alert_Level === 'Critical')
      const alertKpis = deficientKpis.filter(k => k.Alert_Level === 'Alert' || k.Status === 'Risk')
      const recFindings = fList.filter(f => (f.repeat_count || 1) >= 2 || f.status === 'recurring')
      const normFindings = fList.filter(f => (f.repeat_count || 1) < 2 && f.status !== 'recurring')

      // Unbiased data-driven scoring: strictly reflect what is genuinely hurting THIS hospital
      const rawScore = (critKpis.length * 40) + (alertKpis.length * 20) + (recFindings.length * 25) + (normFindings.length * 15) + (Math.min(ovrs.length, 10) * 5)
      const multiplier = isTriple ? 1.25 : 1.1
      const totalScore = Math.round(rawScore * multiplier)

      if (totalScore <= 0) continue

      const critKpisEvidence = deficientKpis
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
        kpis_count: deficientKpis.length,
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
    const pass1System = `أنت المحقق الإكلينيكي الجنائي الأعلى وخبير جودة المستشفيات وفق معايير الاعتماد الوطنية والدولية (GAHAR / IHI / NHS). مهمتك دراسة ملف الأدلة لـ 3 أزمات سريرية وتشغيلية كبرى بمستشفى (${hospital.name}) وصياغة ميثاق 3 مشاريع تحسين جودة مؤسسية كبرى (Flagship Quality Improvement Projects).

قواعد التحسين المؤسسي والعمق السريري الصارمة (Clinical Depth & Benchmarks):
1. التمييز الحاسم بين الإجراءات التصحيحية العادية ومشاريع التحسين المؤسسية (CAPA vs. Flagship QIP):
   - يُمنع منعاً باتاً تحويل السلبيات التفتيشية الروتينية (مثل وضع استيكر على ثلاجة، أو شراء أقفال، أو تعليق بوستر، أو عقد محاضرة تدريبية عادية) إلى مشاريع تحسين؛ فهذه إجراءات تصحيحية فورية (CAPA) وليست مشاريع جودة.
   - مشاريع التحسين المؤسسية يجب أن تستهدف «إعادة هندسة مسارات سريرية كبرى وعلاج اختناقات تشغيلية حاسمة» تمس الوفيات ومعدلات المضاعفات، مستندة إلى نماذج عالمية معتمدة:
     * مسار احتشاء عضلة القلب الحاد وزمن إذابة الجلطة (Door-to-Needle STEMI Pathway < 30 min وفق معايير AHA/GAHAR).
     * حزم الرعاية الحرجة وخفض الوفيات مثل حزمة التنفس الصناعي (IHI Ventilator Care Bundle لخفض VAP ووفيات العناية 23%).
     * إعادة هندسة التدفق السريري والخروج المبكر قبل 11:00 صباحاً (Criteria-Led Discharge & Patient Flow لكسر اختناق إشغال 100% ودوران السرير).
     * حزمة إنقاذ الإنتان والصدمة التسممية في الساعة الأولى (Hour-1 Sepsis Resuscitation Bundle).
     * ممارسات الحقن الآمن ومأمونية المحاليل الوريدية لمنع تجرثم الدم.
     * الجاهزية والاستجابة لحالات التدهور الإكلينيكي وإنعاش القلب (Code Blue & Resuscitation).
2. قاعدة التركيز الحاسم وفك الارتباط (Single-Problem Focus & Strict Anti-Bundling):
   - كل مشروع يركز على «قضية سريرية واحدة محددة بدقة»؛ يُمنع منعاً باتاً دمج مسارين منفصلين أو تكديس مشكلات متباينة في نفس المشروع أو في الهدف الذكي.
   - لكل مشروع: بيان مشكلة محدد، وهدف ذكي (SMART Goal) واحد غير مشتت يركز على نتيجة سريرية أو تشغيلية واحدة قابلة للقياس الدقيق.
3. حظر الحلول البرمجية الخيالية (Strict Ban on Software Fantasies):
   - يُمنع منعاً باتاً اختلاق حلول برمجية مستحيلة لا تناسب المستشفيات الحكومية مثل: (تطوير API Bridges، برامج LIMS v2.0 خاصة، أنظمة مزامنة Sync Engine مع Google Sheets، أو أتمتة غير موجودة).
   - الحلول يجب أن تكون «هندسة مسارات فيزيائية وسريرية وإجرائية ملموسة وواقعية (Physical & Clinical Workflow Poka-Yoke)»:
     * غرف فحص سريع Fast-track معيارية بجانب الاستقبال، ومسار استدعاء فوري Code STEMI.
     * قوائم تفقدية إجبارية لحزم الرعاية (Bundle Checklists) بجانب سرير المريض، وتحديد زوايا فيزيائية لرأس السرير (30-45°).
     * تطبيق معايير الخروج المسبق المتفق عليها قبل 24 ساعة (Criteria-Led Discharge)، وجولات تفقدية صباحية مبكرة للأطباء والصيادلة.
     * التحقق المزدوج المستقل الإجباري (Independent Forced Double-Check) بتوقيع ممارسَين متزامنين.
4. حظر كتابة أسماء أشخاص نهائياً (Strict Role-Only Policy - NO Human Names):
   - يُمنع منعاً باتاً كتابة أي أسماء أشخاص حقيقيين أو وهميين (مثل "د. فلان" أو أي اسم شخص).
   - يجب كتابة «المسمى الوظيفي فقط» (Job Roles/Titles Only):
     * project_lead: مسمى وظيفي إكلينيكي/إداري رسمي فقط مثل "استشاري أمراض القلب ورئيس قسم الطوارئ بالمستشفى" أو "استشاري ورئيس قسم الرعاية المركزة بالمستشفى" أو "مدير الإدارة الطبية ورئيس لجنة التدفق والأسرة".
     * team_members: مسميات وظيفية سريرية واقعية فقط مثل ["مشرفة تمريض قسم الطوارئ", "طبيب مقيم رعاية مركزة", "صيدلي إكلينيكي عناية حرجة", "أخصائي سلامة المرضى وتوكيد الجودة"]. يُمنع وضع وظائف غير موجودة بالمستشفيات العامة مثل "مهندس نظم" أو "مبرمج".
5. خط الأساس والمؤشرات:
   - خط الأساس (Baseline) يجب أن يقتبس حرفياً الأرقام الفعلية المذكورة في ملف الأدلة دون اختلاق.
   - مستهدف بلاغات OVR: «صفر أخطاء ضارة وحوادث جسيمة مع إغلاق 100% من البلاغات وفق المهلة الزمنية (48 ساعة)».`

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
1. هل انحدر أي مشروع إلى مستوى السلبيات التفتيشية الروتينية (مثل وضع استيكرات أو تعليق أوراق أو شراء أقفال) التي تُحل بتدريب بسيط أو إجراء تصحيحي فوري (CAPA) بدلاً من أن يكون مشروع تحسين سريري مؤسسي عميق؟ ارفض ذلك فوراً واشترط إعادة هيكلة المسار كمسار سريري/تشغيلي نوعي (مثل STEMI D2N أو VAP Bundle أو Criteria-Led Discharge).
2. هل قام الفريق بدمج موضوعين منفصلين أو أكثر في نفس المشروع أو خلط قضايا متباينة في الهدف الذكي؟ ارفض ذلك فوراً واشترط فصلاً تاماً وتركيزاً مطلقاً على مسار سريري واحد وهدف ذكي واحد.
3. هل هناك أي حل يعتمد على التدريب النظري أو التوعية أو المنشورات الورقية؟ ارفضه واشترط هندسة مسار سريري صلب وحزم تدابير إجبارية وتحقق مزدوج مستقل.
4. هل اقترح الفريق حلولاً برمجية خيالية غير قابلة للتطبيق (مثل APIs أو Sync Engines أو ربط بـ Google Sheets)؟ ارفضها واشترط آليات فيزيائية ومسارات عمل معتمدة بالمستشفيات العامة.
5. هل كتب الفريق أي أسماء أشخاص لقائد المشروع أو الأعضاء؟ ارفض أي اسم شخص واشترط مسميات وظيفية رسمية فقط.
6. هل استهدف المشروع "صفر بلاغات OVR" بما يخالف ثقافة السلامة العادلة (Just Culture)؟ ارفض ذلك واشترط استهداف صفر أخطاء ضارة وحوادث جسيمة مع تشجيع الإبلاغ وإغلاقه في 48 ساعة.
7. هل التزم الفريق حرفياً بأرقام خط الأساس (Baseline) الواردة في ملف الأدلة؟ هاجم أي رقم وهمي أو مخترع.
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
1. الترقية من مستوى CAPA إلى مشاريع جودة مؤسسية كبرى: استبعاد السلبيات العادية واستبدالها بمسارات سريرية معيارية (مثل مسار Door-to-Needle STEMI لجلطات القلب، حزمة العناية بالتنفس الصناعي VAP Bundle لخفض وفيات العناية، وإعادة هندسة الخروج المبكر Criteria-Led Discharge لكسر اختناق الأسرة).
2. فك أي دمج عشوائي للمشكلات: كل مشروع يختص بقضية سريرية واحدة عميقة، بهدف ذكي واحد صريح وواضح وغير مشتت.
3. استبدال أي إجراء إداري أو توعوي أو خيال برمجي ببوابات فيزيائية وسريرية صلبة (حزم رعاية سريرية معيارية، بوابات فحص سريع Fast-track، مقاييس زوايا الأسرة، تحقق مزدوج مستقل بتوقيعين، ومسارات خروج موحدة).
4. حظر أسماء الأشخاص والوظائف التقنية الدخيلة: استبدال أي أسماء أشخاص حقيقيين أو وهميين (مثل د. فلان)، واستبعاد الوظائف الدخيلة (مثل مهندس نظم، مبرمج، محلل نظم، مسؤول IT) بمسميات وظيفية إكلينيكية وتمريضية رسمية بالمستشفيات الحكومية فقط.
5. ضبط مستهدف بلاغات OVR ليكون (صفر أخطاء ضارة وحوادث جسيمة مع إغلاق 100% من البلاغات وفق المهلة) لتعزيز ثقافة الإبلاغ.
6. ضبط أرقام خط الأساس لتكون مستخرجة 100% من أرقام شيت جوجل وبلاغات OVR الثابتة بلا أي تخمين.`

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
- مشاريع جودة مؤسسية معيارية (International Clinical Quality Benchmarks): يجب أن تعكس المشاريع مسارات سريرية وتشغيلية كبرى (مثل STEMI D2N، VAP Care Bundle، Criteria-Led Discharge قبل 11:00 صباحاً، Sepsis Hour-1، أو Safe Injections) ولا تنحدر لسلبيات CAPA الروتينية العادية.
- التركيز السريري الصارم (Single-Problem Focus): كل مشروع يركز حصراً على «قضية سريرية واحدة عميقة وجوهرية»؛ يُمنع دمج موضوعين منفصلين في مشروع واحد أو في الهدف الذكي.
- المسمى الوظيفي الإكلينيكي فقط (Job Roles/Titles Only): يُمنع منعاً باتاً كتابة أي أسماء أشخاص حقيقيين أو وهميين في project_lead أو team_members؛ كما يُمنع كتابة وظائف تقنية شاذة بالمستشفيات الحكومية مثل (مهندس نظم، محلل نظم، مبرمج، فريق IT). اكتب المسمى الوظيفي الرسمي فقط:
  * project_lead: مسمى وظيفي إكلينيكي/إداري رسمي فقط (مثلاً: استشاري أمراض القلب ورئيس قسم الطوارئ بالمستشفى، استشاري ورئيس قسم الرعاية المركزة بالمستشفى، مدير الإدارة الطبية ورئيس لجنة التدفق والأسرة بالمستشفى).
  * team_members: مسميات وظيفية سريرية واقعية بالمستشفيات الحكومية (مثلاً: مشرفة تمريض القسم، صيدلي إكلينيكي عناية حرجة، أخصائي سلامة المرضى وتوكيد الجودة، طبيب مقيم بالقسم).
- خط الأساس: مطابق حرفياً لملف الأدلة دون تخمين.
- مستهدف بلاغات OVR: «صفر أخطاء ضارة وحوادث جسيمة (Zero Harm) / إغلاق 100% من البلاغات خلال 48 ساعة».
- التدخلات: حلول فيزيائية ومسار عمل صلب (مسارات Fast-track، حزم رعاية IHI Bundles، معايير خروج مسبقة، تحقق مزدوج مستقل بتوقيعين، ومسؤوليات إكلينيكية وتمريضية فقط).

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
