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

async function callGroqWithRetry(payload, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    if (res.ok) {
      return await res.json()
    }
    if (res.status === 429 && attempt < maxRetries) {
      const errText = await res.text()
      let waitTime = 10000
      const match = errText.match(/try again in ([0-9.]+)s/)
      if (match && match[1]) {
        waitTime = Math.ceil(parseFloat(match[1]) * 1000) + 2000
      }
      console.log(`[ImprovementProjectsService] Rate limit 429 hit. Waiting ${(waitTime / 1000).toFixed(1)}s before retry ${attempt + 1}...`)
      await new Promise(r => setTimeout(r, waitTime))
      continue
    }
    const errText = await res.text()
    throw new Error(`Groq API Error (${res.status}): ${errText}`)
  }
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

    // 5. Deep Clinical Crisis Tracks (GAHAR / JCI Patient Safety & Clinical Governance)
    const CLINICAL_CRISIS_TRACKS = [
      {
        id: 'VERBAL_ORDERS_HANDOVER',
        name: 'الأوامر الشفهية والهاتفية والتسليم والتسلم الحرج (NPSG: Verbal Orders & Handover)',
        category: 'سلامة المرضى (NPSG)',
        clinicalWeight: 2.5,
        kpiMatch: k => (k.Indicator || '').includes('الأوامر الشفهية') || (k.Indicator || '').includes('تسليم وتسلم'),
        findingMatch: f => (f.original_text || '').includes('شفه') || (f.original_text || '').includes('هاتف') || (f.original_text || '').includes('تسليم وتسلم') || (f.original_text || '').includes('isbar'),
        ovrMatch: o => (o.description || '').includes('isbar') || (o.description || '').includes('تسليم وتسلم') || (o.description || '').includes('شفه') || (o.subcategory || '').includes('handover') || (o.subcategory || '').includes('Compliance with handover')
      },
      {
        id: 'PATIENT_IDENTIFICATION',
        name: 'التحقق من هوية المريض ومطابقة الأساور ونقل الدم (NPSG: Patient Identification)',
        category: 'سلامة المرضى (NPSG)',
        clinicalWeight: 2.5,
        kpiMatch: k => (k.Indicator || '').includes('التعريف الصحيح للمريض') || (k.Indicator || '').includes('الأخطاء في عناصر الرعاية المرتبطة بالتعريف'),
        findingMatch: f => (f.original_text || '').includes('تعريف المريض') || (f.original_text || '').includes('اسورة') || (f.original_text || '').includes('اسطورة') || (f.original_text || '').includes('اساور') || (f.original_text || '').includes('كانولا غير معرف'),
        ovrMatch: o => (o.subcategory || '').includes('Patient identification') || (o.description || '').includes('اسطوره') || (o.description || '').includes('اسورة') || (o.description || '').includes('اساور') || (o.description || '').includes('تعريف المريض') || (o.description || '').includes('نقل الدم')
      },
      {
        id: 'CLINICAL_DETERIORATION_ALARMS',
        name: 'الاستجابة للتدهور السريري والإنذارات الحرجة وجاهزية الإنعاش (Rapid Response & Resuscitation)',
        category: 'الرعاية الحرجة والطوارئ',
        clinicalWeight: 2.4,
        kpiMatch: k => (k.Indicator || '').includes('التدهور الإكلينيكي') || (k.Indicator || '').includes('الإنذارات الحرجة') || (k.Indicator || '').includes('وفيات العناية'),
        findingMatch: f => (f.original_text || '').includes('تدهور') || (f.original_text || '').includes('الإنذارات') || (f.original_text || '').includes('الانذارات') || (f.original_text || '').includes('كود بلو') || (f.original_text || '').includes('cpr') || (f.original_text || '').includes('جهاز dc'),
        ovrMatch: o => (o.description || '').includes('تنفس صناعي') || (o.description || '').includes('ريسفنت') || (o.description || '').includes('تدهور') || (o.description || '').includes('انعاش') || (o.description || '').includes('cpr')
      },
      {
        id: 'MEDICATION_SAFETY_LASA_HIGH_ALERT',
        name: 'الأدوية عالية الخطورة والمتشابهة (LASA) وعربة الطوارئ والتوافق الدوائي (Medication Safety)',
        category: 'إدارة واستخدام الدواء',
        clinicalWeight: 2.4,
        kpiMatch: k => (k.Indicator || '').includes('عالية الخطورة') || (k.Indicator || '').includes('المتشابهة في الشكل') || (k.Indicator || '').includes('النتائج الدوائية العكسية'),
        findingMatch: f => (f.original_text || '').includes('عاليه الخطور') || (f.original_text || '').includes('عالية الخطور') || (f.original_text || '').includes('المتشابهه') || (f.original_text || '').includes('كراش') || (f.original_text || '').includes('التوافق الدوائي') || (f.original_text || '').includes('lasa'),
        ovrMatch: o => (o.subcategory || '').includes('Medication') || (o.description || '').includes('كراش') || (o.description || '').includes('محاليل') || (o.description || '').includes('انسولين') || (o.description || '').includes('دوائ')
      },
      {
        id: 'SURGICAL_SAFETY_TIME_OUT',
        name: 'الأمان الجراحي والوقت المستقطع وتفادي جراحة المريض الخطأ (Surgical Safety & Time-Out)',
        category: 'سلامة المرضى (NPSG)',
        clinicalWeight: 2.3,
        kpiMatch: k => (k.Indicator || '').includes('تحديد موضع الإجراء الجراحي') || (k.Indicator || '').includes('الجراحة التفقدية'),
        findingMatch: f => (f.original_text || '').includes('الوقت المستقطع') || (f.original_text || '').includes('الإجراءات التداخلية') || (f.original_text || '').includes('موضع الجراح'),
        ovrMatch: o => (o.description || '').includes('غسيل الأيدي الجراحي قبل العمليه') || (o.description || '').includes('تأجيل حاله عمليات') || (o.description || '').includes('الوقت المستقطع')
      },
      {
        id: 'CRITICAL_PANIC_VALUES',
        name: 'الإبلاغ الفوري للنتائج التشخيصية الحرجة (Critical Panic Diagnostic Results Communication)',
        category: 'الرعاية الحرجة والتشخيص',
        clinicalWeight: 2.2,
        kpiMatch: k => (k.Indicator || '').includes('النتائج الحرجة') || (k.Indicator || '').includes('المحولة من العيادات الى المعمل'),
        findingMatch: f => (f.original_text || '').includes('النتائج الحرجه') || (f.original_text || '').includes('النتائج الحرجة') || (f.original_text || '').includes('tat'),
        ovrMatch: o => (o.description || '').includes('مجلطة') || (o.description || '').includes('رفضها') || (o.description || '').includes('نتائج حرجة') || (o.description || '').includes('نتيجه حرجه')
      },
      {
        id: 'DEVICE_ASSOCIATED_INFECTIONS',
        name: 'حزم الوقاية من عدوى الأجهزة التداخلية (CLABSI, CAUTI, VAP Bundles)',
        category: 'مكافحة العدوى والتعقيم',
        clinicalWeight: 2.2,
        kpiMatch: k => (k.Indicator || '').includes('الحقن الآمن') || (k.Indicator || '').includes('مكافحة العدوى'),
        findingMatch: f => (f.original_text || '').includes('قسطرة') || (f.original_text || '').includes('قساطر') || (f.original_text || '').includes('تنفس صناعي'),
        ovrMatch: o => (o.description || '').includes('القسطرة المركزية') || (o.description || '').includes('القسطرة البولية') || (o.description || '').includes('مجري الدم') || (o.subcategory || '').includes('Urinary') || (o.subcategory || '').includes('Bloodstream')
      }
    ]

    const scoredTracks = []
    for (const track of CLINICAL_CRISIS_TRACKS) {
      const kpis = sheetKpis.filter(track.kpiMatch)
      const fList = eligibleFindings.filter(track.findingMatch)
      const ovrs = eligibleOvrRecords.filter(track.ovrMatch)

      const hasKpi = kpis.length > 0
      const hasFinding = fList.length > 0
      const hasOvr = ovrs.length > 0
      const sourceCount = (hasKpi ? 1 : 0) + (hasFinding ? 1 : 0) + (hasOvr ? 1 : 0)

      // STRICT RULE: At least 2 corroborating sources required for deep clinical crisis!
      if (sourceCount < 2) continue

      const isTriple = sourceCount === 3
      const corroborationLevel = isTriple
        ? 'تطابق جنائي ثلاثي (3 من 3 مصادر)'
        : 'تطابق جنائي ثنائي (2 من 3 مصادر معتمدة - أزمة إكلينيكية عميقة)'

      const critKpis = kpis.filter(k => k.Alert_Level === 'Critical')
      const alertKpis = kpis.filter(k => k.Alert_Level === 'Alert' || k.Status === 'Risk')
      const recFindings = fList.filter(f => (f.repeat_count || 1) >= 2 || f.status === 'recurring')
      const normFindings = fList.filter(f => (f.repeat_count || 1) < 2 && f.status !== 'recurring')

      const rawScore = (critKpis.length * 35) + (alertKpis.length * 15) + (recFindings.length * 12) + (normFindings.length * 5) + (ovrs.length * 5)
      const multiplier = isTriple ? 1.25 : 1.15
      const totalScore = Math.round(rawScore * multiplier * track.clinicalWeight)

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
      throw new Error('لم يتم العثور على أي أزمة سريرية مستوفية لشرط التطابق متعدد المصادر (مصدرين على الأقل من 3).')
    }

    // Strictly generate the top 3 major institutional improvement projects
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

    console.log(`[ImprovementProjectsService] Starting 4-Pass Adversarial Investigation Loop for: ${hospital.name}...`)

    // --- PASS 1: Initial Deep Investigation & Candidate Charters ---
    const pass1System = `أنت المحقق الإكلينيكي الجنائي الأعلى. مهمتك دراسة ملف الأدلة الجنائية لـ 3 أزمات سريرية كبرى بالمستشفى وصياغة مسودة تحقيقية شاملة لـ 3 مشاريع تحسين جودة مؤسسية صلبة.
قواعد خط الأساس الصارمة:
- خط الأساس (Baseline) لكل مؤشر يجب أن يقتبس حرفياً الأرقام الفعلية المذكورة في ملف الأدلة (النسبة المئوية من شيت جوجل، والعدد الفعلي لبلاغات OVR، وعدد الملاحظات الميدانية). ممنوع تخمين أرقام.
- صياغة المشكلة، السبب الجذري، والتدخلات الهندسية لكل مشروع بشكل تفصيلي ودقيق.`

    const pass1User = `بيانات المستشفى: ${hospital.name}
ملف الأدلة الجنائية للأزمات المعتمدة بالمستشفى:
${verifiedGroundTruthDossier}

صغ المسودة التحقيقية الأولية للمشاريع الثلاثة بأرقام خط الأساس الحقيقية الموثقة.`

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
1. هل هناك أي حل يعتمد على التدريب أو التوعية أو المنشورات الورقية؟ ارفضه فوراً واشترط بوابات Poka-Yoke صلبة وتحقق مزدوج مستقل.
2. هل التزم الفريق حرفياً بأرقام خط الأساس (Baseline) الواردة في ملف الأدلة؟ هاجم أي رقم وهمي أو مخترع.
3. هل التحليل الجذري كشف الفشل الهيكلي في مسار العمل (Process Failure)؟
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
1. استبدال أي إجراء إداري أو توعوي ببوابات Poka-Yoke صلبة (حواجز تمنع إتمام الإجراء الطبي إلا بعد تحقق إلزامي)، وتحقق مزدوج مستقل إجباري، وتصعيد آلي فوري للمدير الطبي.
2. ضبط أرقام خط الأساس لتكون مستخرجة 100% من أرقام شيت جوجل وبلاغات OVR الثابتة بلا أي تخمين أو اجتهاد.`

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

قواعد إلزامية حاسمة لخط الأساس (Baseline Metrics):
- القيمة الحالية (BASELINE) لكل مؤشر يجب أن تكون مطابقة حرفياً للبيانات الفعلية:
  * مؤشر شيت جوجل: القيمة الحالية = النسبة المئوية الدقيقة من الشيت (مثلاً 90% أو 0% أو 10%).
  * مؤشر بلاغات OVR: القيمة الحالية = العدد الفعلي الدقيق للبلاغات المسجلة المذكور في ملف الأدلة (مثلاً: 31 بلاغاً أو 5 بلاغات أو 8 بلاغات). المستهدف = صفر بلاغات (انعدام الأخطاء).
  * مؤشر الملاحظات الميدانية: القيمة الحالية = عدد الملاحظات الميدانية المرصودة. المستهدف = 100% إغلاق وتصحيح.
- يُمنع تخمين أي أرقام!

الصيغة المطلوبة (JSON فقط ومصفوفة projects تحتوي على 3 مشاريع):
{
  "projects": [
    {
      "title": "عنوان المشروع السريري الرصين المعبر عن المسار والحل الهندسي الصلب",
      "department_name": "القسم المعني",
      "category": "سلامة المرضى / إدارة واستخدام الدواء / الرعاية الحرجة والطوارئ",
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
          "target": "المستهدف المنشود (مثلاً ≥98% أو صفر بلاغات)",
          "frequency": "شهري"
        }
      ],
      "interventions": [
        { "step": "بوابة Poka-Yoke / تحقق مزدوج مستقل / مسار مغلق / تصعيد فوري للمدير الطبي", "responsible": "المسؤول عن التنفيذ", "duration": "أسبوعين" }
      ],
      "project_lead": "المسؤول المقترح عن قيادة المشروع بالمستشفى",
      "team_members": ["عضو 1", "عضو 2", "عضو 3"],
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

    console.log('[ImprovementProjectsService] Pass 4 (Supreme Certification) completed. Applying Ground-Truth KPI post-processing...')

    // Step C: Ground-Truth Anchoring Post-Processor (Guarantees zero guesswork in UI and DB)
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
              if (!kpi.target || kpi.target.includes('2>=')) {
                kpi.target = 'صفر بلاغات حوادث عارضة'
              }
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
        project_lead: p.project_lead || hospital.quality_head_name || 'فريق الجودة بالمستشفى',
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
