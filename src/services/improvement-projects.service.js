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

  // 9. AI Generation: Propose Evidence-Based QIPs Grounded in Forensic Multi-Source Triangulation
  async generateProjectsForHospital(hospitalId, options = {}) {
    const { count = 3, focusDepartment = null } = options

    // Step A: Perform full integrated crisis analysis (Findings + Google Sheet KPIs + OVR)
    const crisisAnalysis = await this.analyzeHospitalCrisis(hospitalId)
    const hospital = crisisAnalysis.hospital
    const eligibleCrises = crisisAnalysis.eligible_crises || []

    if (eligibleCrises.length === 0) {
      throw new Error('لم يتم العثور على أي أزمة سريرية مستوفية لشرط التطابق متعدد المصادر (مصدرين على الأقل من 3).')
    }

    const primaryCrisis = crisisAnalysis.primary_crisis

    const selectedCrises = eligibleCrises.slice(0, count)

    // Step B: Build verified multi-source forensic evidence dossier
    const forensicDossierText = selectedCrises.map((ec, idx) => `
======================================================================
الأزمة السريرية رقم (${idx + 1}): [${ec.domain_name}]
• التصنيف السريري: ${ec.category || 'سلامة المرضى'} (مستوى التطابق: ${ec.corroboration_level} - النتيجة: ${ec.score} نقطة)
• الأدلة الجنائية الموثقة:

١. الشاهد الأول (المرور الميداني والسلبيات المرصودة):
${ec.correlating_findings_evidence.length > 0 ? ec.correlating_findings_evidence.join('\n') : 'لا توجد سلبيات مرصودة بهذا الشاهد (اكتفاء بالمصدرين الآخرين)'}

٢. الشاهد الثاني (شيت مؤشرات الأداء الحسابية الرسمية بالمديرية):
${ec.critical_kpis_evidence.length > 0 ? ec.critical_kpis_evidence.join('\n') : 'لا توجد مؤشرات مسجلة بهذا الشاهد'}

٣. الشاهد الثالث (بلاغات الحوادث العارضة OVR المسجلة من الأطباء والتمريض):
${ec.ovr_incidents_evidence.length > 0 ? ec.ovr_incidents_evidence.join('\n') : 'لا توجد بلاغات مسجلة بهذا الشاهد'}
======================================================================
`).join('\n')

    // AI Prompt - Blazing Intelligence (الذكاء الحارق)
    const systemPrompt = `أنت المراجع الإكلينيكي الأعلى وخبير هندسة النظم السريرية وتوكيد الجودة المعتمد (GAHAR Fellow & Senior Clinical Systems Architect).
مهمتك تصميم ميثاق مشروع تحسين جودة مؤسسي استراتيجي رفيع المستوى (Institutional Quality Improvement Project - QIP) لمعالجة الأزمات السريرية المعقدة للمستشفى، والمستخرجة من التحقيق الجنائي الإكلينيكي متعدد المصادر (مرور ميداني + شيت مؤشرات جوجل + بلاغات OVR).

قواعد الذكاء الحارق الصارمة لهندسة مشاريع التحسين (Blazing Clinical Intelligence Rules):
1. قاعدة عمق المشكلة السريرية مقابل عدد الشواهد (Critical Clinical Depth Mandate):
   - القاعدة الذهبية الحاسمة: «مشروع تحسين لمشكلة إكلينيكية عميقة ومعقدة تمس حياة وسلامة المريض (مثل الأوامر الشفهية 0% أو التدهور السريري 0% أو أدوية LASA أو أخطاء هوية المريض ونقل الدم) بمصدرين فقط، له الأولوية القصوى والمطلقة على أي مشكلة بسيطة ولو توافرت لها 3 مصادر».
   - وجود شاهدين إكلينيكيين مؤكدين لمشكلة عميقة يكفي تماماً ويُعتبر دليلاً جنائياً كافياً ومعتمداً لإطلاق مشروع تحسين مؤسسي عالي القيمة.
   - إذا توافرت 3 مصادر لمشكلة عميقة فهو ممتاز، ولكن لا يُشترط أبداً 3 مصادر إذا كانت المشكلة عميقة وتتوافر لها دلائل قاطعة من مصدرين.

2. الحظر المطلق والكامل لأي مشاريع تافهة أو سطحية (Zero-Tolerance For Superficial Tasks):
   - يُمنع منعاً باتاً صياغة أي مشروع بعنوان أو بمضمون يخص:
     * نظافة الأسطح أو الأرضيات أو المفروشات أو سلات المهملات أو المطهرات الروتينية.
     * استكمال أو جرد حقائب الانسكابات الكيميائية أو ماسة المواد أو كروت فحص الطفايات أو مقاييس الكلور.
     * تعليق بوسترات أو لافتات أو كروت تعريف للموظفين أو الثلاجات أو حقوق المرضى.
     * تنظيم وترتيب المخازن أو الأرفف أو الدواليب أو مكاتب الأرشيف.
     * برامج تدريبية نظرية أو ورش عمل كحل أساسي (التدريب بمفرده لا يصلح كحل لمشروع تحسين مؤسسي).
   - المشكلة المستهدفة يجب أن تكون «فشلاً هيكلياً في مسار الرعاية الطبية» (Complex Systemic Clinical Breakdown).

3. طبيعة الحلول التدخلية المقترحة (Structural Engineering Interventions):
   - بوابات إيقاف وفحص صلبة مانعة للخطأ (Poka-Yoke Hard-Stops) تمنع إتمام الإجراء الطبي إلا بعد تحقق إلزامي.
   - نظام التحقق المزدوج المستقل الإجباري (Independent Forced Double-Check) بواسطة اثنين من الممارسين.
   - مسار التوثيق الرقمي والفيزيائي المغلق (Closed-Loop Workflow).
   - بروتوكول تصعيد قيادي فوري للمدير الطبي عند تجاوز حدود الخطر.

4. توثيق كائن "forensic_corroboration" بدقة تامة:
   - corroboration_level: "تطابق جنائي ثلاثي (3 من 3 مصادر)" أو "تطابق جنائي ثنائي (2 من 3 مصادر معتمدة - أزمة إكلينيكية عميقة)"
   - source_1_field_finding: نص الشاهد الأول الميداني الدقيق أو "لا ينطبق (اكتفاء بالمصدرين الآخرين)"
   - source_2_sheet_kpi: اسم المؤشر الحقيقي مع النسبة المسجلة من الشيت
   - source_3_staff_ovr: واقعة وبلاغ OVR الحقيقي المسجل من الطاقم أو "لا ينطبق"

5. التمايز التام بين المشاريع المقترحة (Zero Duplication):
   - يجب أن يستهدف كل مشروع أزمة سريرية مستقلة تماماً من الأزمات المرفقة بملف الأدلة.

6. المصداقية التامة وخلو خط الأساس (Baseline) من الهلوسة أو الأرقام الوهمية:
   - يُمنع اختلاق أو تخمين أي وفيات أو أرقام غير واردة بالأدلة. خط الأساس يجب أن يقتبس حرفياً الأرقام الفعلية لشيت جوجل وبلاغات OVR.

أخرج النتيجة بصيغة JSON فقط.`

    const userPrompt = `بيانات المستشفى والأزمات السريرية العميقة المستخرجة عبر التحقيق الجنائي:
- اسم المستشفى: ${hospital.name} (مطابق لشيت جوجل: ${hospital.matchedSheetName || 'غير مسجل'})
- إجمالي السلبيات المرصودة بالمرور (المؤهلة): ${crisisAnalysis.stats.eligibleFindings}
- إجمالي مؤشرات الأداء المفحوصة بشيت جوجل: ${crisisAnalysis.stats.totalSheetKpis} (منها ${crisisAnalysis.stats.criticalSheetKpis} مؤشر في حالة خطر/حرج)
- إجمالي بلاغات الحوادث العارضة (OVR) السريرية: ${crisisAnalysis.stats.totalOvrRecords} بلاغ

ملف الأدلة الجنائية للأزمات المعتمدة بالمستشفى (Evidence Dossier):
${forensicDossierText}

المطلوب:
صِغ بالضبط عدد (${count}) مقترحات مشاريع تحسين مؤسسية جادة لمعالجة هذه الأزمات السريرية، بحيث يركز كل مشروع على مسار سريري حرج ومستقل تماماً ويثبت تطابقه مع مصدرين أو 3 مصادر.

الصيغة المطلوبة (JSON فقط - مصفوفة projects تحتوي على ${count} مشروع):
{
  "projects": [
    {
      "title": "عنوان المشروع السريري الرصين المعبر عن المسار والحل الصلب",
      "department_name": "القسم المعني",
      "category": "سلامة المرضى / إدارة واستخدام الدواء / الرعاية الحرجة والطوارئ / مكافحة العدوى والتعقيم",
      "priority": "high",
      "forensic_corroboration": {
        "corroboration_level": "تطابق جنائي ثلاثي (3 من 3 مصادر) أو تطابق جنائي ثنائي (2 من 3 مصادر)",
        "source_1_field_finding": "نص الشاهد الأول الميداني",
        "source_2_sheet_kpi": "اسم المؤشر من شيت جوجل مع القيمة الفعلية المسجلة",
        "source_3_staff_ovr": "واقعة وبلاغ OVR الحقيقي المسجل من الطاقم"
      },
      "why_hard_to_solve": "شرح لماذا هذه المشكلة مستعصية ولا تُحل بالتدريب البسيط وما هي عوائق مسار العمل",
      "root_cause_analysis": "تحليل الأسباب الجذرية النظامية للخلل في مسار العمل (Process Failure)",
      "prioritization_matrix": {
        "patient_safety_risk": 5,
        "volume_frequency": 4,
        "process_complexity": 5,
        "strategic_alignment": 5,
        "total_score": 19,
        "eligibility_justification": "أزمة سريرية مثبتة جنائياً بأدلة إكلينيكية صلبة تمس سلامة حياة المرضى."
      },
      "problem_statement": "بيان المشكلة يربط شهود الإثبات دون اختلاق وفيات غير موثقة",
      "baseline_metrics": "أرقام خط الأساس الحقيقية المستخرجة حرفياً من شيت مؤشرات جوجل وبلاغات OVR",
      "smart_goal": "الهدف الذكي القابل للقياس وموعد الإنجاز المستهدف",
      "evidence_reference": "معايير الهيئة العامة للاعتماد والرقابة الصحية (GAHAR)",
      "target_duration_weeks": 12,
      "kpis": [
        { "name": "مؤشر العملية للالتزام بالمسار", "type": "process", "baseline": "الرقم الحقيقي من شيت جوجل أو قيد التدقيق الأولي", "target": "95%", "frequency": "شهري" },
        { "name": "مؤشر النتيجة السريرية/التشغيلية", "type": "outcome", "baseline": "الرقم الحقيقي من شيت جوجل أو قيد الرصد المرجعي", "target": "المعيار المنشود", "frequency": "شهري" }
      ],
      "interventions": [
        { "step": "إعادة هندسة المسار / وضع بوابة فحص إلزامية Poka-Yoke / تحقق مزدوج مستقل / بروتوكول تصعيد", "responsible": "المسؤول عن التنفيذ", "duration": "أسبوعين" }
      ],
      "project_lead": "المسؤول المقترح عن قيادة المشروع بالمستشفى",
      "team_members": ["عضو 1", "عضو 2", "عضو 3"],
      "linked_findings_summary": ["نص السلبية المرصودة ذات الصلة"]
    }
  ]
}`

    // Call Groq API
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.15,
        max_tokens: 6000
      })
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Groq AI Error (${res.status}): ${errText}`)
    }

    const aiResponse = await res.json()
    const choice = aiResponse.choices?.[0]
    const content = choice?.message?.content || '{}'
    const parsed = JSON.parse(content)
    const generatedList = parsed.projects || []

    if (!Array.isArray(generatedList) || generatedList.length === 0) {
      throw new Error('لم يقم الذكاء الاصطناعي بتوليد مشاريع تحسين مطابقة للمواصفات.')
    }

    // Save and return generated projects
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
        baseline_metrics: p.baseline_metrics || p.baseline || 'مستند إلى شيت مؤشرات الأداء الرسمي بالمديرية وبلاغات OVR',
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
        directorate_notes: `مشروع تحسين جودة مؤسسي مستند إلى التحقيق الجنائي ثلاثي الأركان (${p.forensic_corroboration?.corroboration_level || 'مصدران أو أكثر'})`
      }

      const saved = await this.saveProject(projectRecord)
      savedProjects.push(saved)
    }

    return savedProjects
  }
}
