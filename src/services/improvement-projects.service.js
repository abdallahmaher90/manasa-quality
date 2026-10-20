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

    // Filter out trivial maintenance, minor handyman, and routine administrative noise
    const isNonQipTask = (text) => {
      const lower = (text || '').toLowerCase()
      const trivial = [
        'جرس استدعاء', 'جرس التمريض', 'ترمومتر', 'لمبة', 'بوابة', 'كالون', 'صنبور', 'سباكة',
        'كرسي', 'مفتاح كهرباء', 'دهان', 'تربيزة', 'بلاط', 'أرضيات', 'حشائش', 'بلاعة',
        'شفاط', 'مضخه', 'دولاب', 'أرفف', 'توفير كراسي', 'توفير غرفه ارشيف', 'توفير مستلزمات غسيل',
        'بوستر', 'بوسترات', 'race', 'pass', 'كارت فحص', 'كروت التعريف', 'طفايه الحريق',
        'دون قفازات', 'بدون قفازات', 'ارتداء قفازات', 'كمامة', 'مريلة', 'جاون',
        'توقيع الاطباء في بعض النماذج احادي', 'توقيع الصيدلى على الادويه في بعض الملفات',
        'شطب وكشط', 'غير مرقمة', 'اعتماد دفتر', 'سجل المشورة', 'كتابه عليه التوقيع',
        'سجل مكتوب يدوى', 'احواض غير معرفه', 'لا يوجد رقم خاص بمسؤل الشكاوي', 'المخزن غير منظم',
        'نظافة', 'سلة مهملات', 'ملفات العاملين', 'توصيف وظيفي', 'توصيف وظيفى', 'شهادات تدريب',
        'السياسات غير محدثه', 'السياسات غير معتمده', 'تحديث السياسات', 'لوحه المفاتيح',
        'قائمه باسماء', 'قائمة بأسماء'
      ]
      return trivial.some(t => lower.includes(t))
    }

    const eligibleFindings = (findings || []).filter(f => !isNonQipTask(f.original_text))

    // 3. Fetch Google Sheet KPIs
    const { matchedName: matchedSheetName, kpis: sheetKpis } = await this.fetchHospitalKpisFromSheet(hospital.name)

    // Domain definitions with GAHAR clinical risk weights
    const domainMeta = {
      PATIENT_SAFETY_GOVERNANCE: {
        id: 'PATIENT_SAFETY_GOVERNANCE',
        name: 'الأهداف الوطنية لسلامة المرضى (National Patient Safety Goals - NPSGs)',
        clinicalRiskFactor: 1.45
      },
      MEDICATION_MANAGEMENT: {
        id: 'MEDICATION_MANAGEMENT',
        name: 'إدارة ومأمونية الدواء والصيدلة السريرية (Medication Safety & Pharmacy)',
        clinicalRiskFactor: 1.4
      },
      CRITICAL_EMERGENCY_CARE: {
        id: 'CRITICAL_EMERGENCY_CARE',
        name: 'الرعاية الحرجة وفرز الطوارئ والإنقاذ (Critical Care & Emergency Triage)',
        clinicalRiskFactor: 1.4
      },
      INFECTION_PREVENTION: {
        id: 'INFECTION_PREVENTION',
        name: 'مكافحة العدوى والتعقيم والعزل الطبي (Infection Prevention & Isolation)',
        clinicalRiskFactor: 1.35
      },
      MEDICAL_RECORDS: {
        id: 'MEDICAL_RECORDS',
        name: 'اكتمال الملف الطبي والتوثيق والملائمة السريرية (Clinical Documentation & Med-Rec)',
        clinicalRiskFactor: 1.2
      },
      FACILITY_BIOMEDICAL_SAFETY: {
        id: 'FACILITY_BIOMEDICAL_SAFETY',
        name: 'السلامة والصحة المهنية والأجهزة الطبية (Biomedical Equipment & FMS)',
        clinicalRiskFactor: 1.15
      }
    }

    const domainBuckets = {}
    for (const [key, meta] of Object.entries(domainMeta)) {
      domainBuckets[key] = {
        ...meta,
        findings: [],
        kpis: [],
        ovrRecords: [],
        criticalKpiCount: 0,
        riskKpiCount: 0,
        recurringFindingCount: 0,
        highPriorityFindingCount: 0,
        ovrCount: 0,
        rawScore: 0
      }
    }

    // Place KPIs into domains
    sheetKpis.forEach(k => {
      const domainKey = this.classifyDomain(k.Indicator)
      const target = domainBuckets[domainKey]
      if (!target) return // Discard non-clinical admin items
      target.kpis.push(k)

      const isCritical = k.Alert_Level === 'Critical'
      const isRisk = k.Status === 'Risk' || k.Alert_Level === 'Alert'
      if (isCritical) {
        target.criticalKpiCount++
        target.rawScore += 25
      } else if (isRisk) {
        target.riskKpiCount++
        target.rawScore += 12
      }
    })

    // Place Findings into domains
    eligibleFindings.forEach(f => {
      const domainKey = this.classifyDomain(f.original_text, f.departments?.name || '')
      const target = domainBuckets[domainKey]
      if (!target) return // Discard non-clinical admin items
      target.findings.push(f)

      const isRec = (f.repeat_count || 1) >= 2 || f.status === 'recurring'
      const isHigh = f.priority === 'high'

      if (isRec) target.recurringFindingCount++
      if (isHigh) target.highPriorityFindingCount++

      target.rawScore += (isRec ? 10 : 3) + (isHigh ? 6 : 2)
    })

    // 4. Fetch Hospital OVR Incidents (The 3rd Forensic Pillar)
    const ovrRecords = await ovrService.getHospitalOVR(hospitalId)
    ovrRecords.forEach(ovr => {
      let domainKey = 'PATIENT_SAFETY_GOVERNANCE'
      if (ovr.domain_key === 'facility_equipment') domainKey = 'FACILITY_BIOMEDICAL_SAFETY'
      else if (ovr.domain_key === 'medical_records') domainKey = 'MEDICAL_RECORDS'
      else if (ovr.domain_key === 'infection_control') domainKey = 'INFECTION_PREVENTION'
      else if (ovr.domain_key === 'medication_safety') domainKey = 'MEDICATION_MANAGEMENT'
      else if (ovr.domain_key === 'critical_care') domainKey = 'CRITICAL_EMERGENCY_CARE'
      else if (ovr.domain_key === 'patient_safety') domainKey = 'PATIENT_SAFETY_GOVERNANCE'
      else domainKey = this.classifyDomain(`${ovr.subcategory} ${ovr.description}`)

      const target = domainBuckets[domainKey]
      if (!target) return
      target.ovrRecords.push(ovr)
      target.ovrCount++
      target.rawScore += 4
    })

    // STRICT FORENSIC RULE: Must have evidence in AT LEAST 2 OUT OF 3 SOURCES!
    // Source 1: Inspection Findings (>= 1)
    // Source 2: Google Sheet KPIs with Risk/Critical/Alert (>= 1)
    // Source 3: OVR Staff Incidents (>= 1)
    for (const d of Object.values(domainBuckets)) {
      const hasFindings = d.findings.length >= 1
      const criticalOrRiskKpis = d.kpis.filter(k => k.Alert_Level === 'Critical' || k.Status === 'Risk' || k.Alert_Level === 'Alert')
      const hasKpiWarning = criticalOrRiskKpis.length >= 1
      const hasOvr = d.ovrCount >= 1

      const sourceCount = (hasFindings ? 1 : 0) + (hasKpiWarning ? 1 : 0) + (hasOvr ? 1 : 0)
      d.sourceCount = sourceCount
      d.hasFindings = hasFindings
      d.hasKpiWarning = hasKpiWarning
      d.hasOvr = hasOvr

      // DISQUALIFY any domain with less than 2 corroborated sources!
      if (sourceCount < 2) {
        d.isEligible = false
        d.totalScore = 0
        d.corroborationLevel = 'Disqualified (مصدر واحد فقط - غير معتمد كمشروع تحسين)'
      } else {
        d.isEligible = true
        if (sourceCount === 3) {
          // Triple Forensic Match (Highest Conviction!)
          d.isTripleCorroborated = true
          d.corroborationLevel = 'تطابق جنائي ثلاثي (3 من 3 مصادر: تفتيش ميداني + شيت مؤشرات جوجل + بلاغات OVR)'
          d.totalScore = Math.round(d.rawScore * 2.5 * d.clinicalRiskFactor)
        } else {
          // Dual-Source Match
          d.isTripleCorroborated = false
          d.corroborationLevel = 'تطابق ثنائي المصدر (مصدران من 3 مصادر)'
          d.totalScore = Math.round(d.rawScore * 1.4 * d.clinicalRiskFactor)
        }
      }
    }

    // Sort domains descending by total score
    const eligibleDomains = Object.values(domainBuckets).filter(d => d.isEligible).sort((a, b) => b.totalScore - a.totalScore)
    const sortedDomains = Object.values(domainBuckets).sort((a, b) => b.totalScore - a.totalScore)
    
    // Primary crisis is highest scored eligible domain
    const primaryCrisis = eligibleDomains[0] || sortedDomains[0]

    // Build evidence summaries for all eligible corroborated domains
    const eligibleCrises = eligibleDomains.map(d => {
      const critKpis = d.kpis
        .filter(k => k.Alert_Level === 'Critical' || k.Status === 'Risk' || k.Alert_Level === 'Alert')
        .map(k => `• ${k.Indicator}: القيمة الفعلية المسجلة ${k.Value}% (حالة الخطر: ${k.Alert_Level || k.Status})`)
        .slice(0, 8)

      const topFindings = d.findings
        .sort((a, b) => (b.repeat_count || 1) - (a.repeat_count || 1))
        .map(f => `• [${f.departments?.name || 'عام'}]: ${f.original_text} (تكرر ${f.repeat_count || 1} مرات)`)
        .slice(0, 8)

      const topOvrs = (d.ovrRecords || [])
        .slice(0, 8)
        .map(o => `• [${o.date} - ${o.subcategory}]: ${o.description.length > 130 ? o.description.slice(0, 130) + '...' : o.description}`)

      return {
        domain_id: d.id,
        domain_name: d.name,
        score: d.totalScore,
        source_count: d.sourceCount,
        is_triple_corroborated: !!d.isTripleCorroborated,
        corroboration_level: d.corroborationLevel,
        findings_count: d.findings.length,
        kpis_count: d.kpis.length,
        ovr_count: d.ovrCount,
        critical_kpis_evidence: critKpis,
        correlating_findings_evidence: topFindings,
        ovr_incidents_evidence: topOvrs
      }
    })

    const primaryCriticalKpisSummary = primaryCrisis.kpis
      .filter(k => k.Alert_Level === 'Critical' || k.Status === 'Risk' || k.Alert_Level === 'Alert')
      .map(k => `• ${k.Indicator}: القيمة الفعلية المسجلة ${k.Value}% (حالة الخطر: ${k.Alert_Level || k.Status})`)
      .slice(0, 8)

    const primaryTopFindingsSummary = primaryCrisis.findings
      .sort((a, b) => (b.repeat_count || 1) - (a.repeat_count || 1))
      .map(f => `• [${f.departments?.name || 'عام'}]: ${f.original_text} (تكرر ${f.repeat_count || 1} مرات)`)
      .slice(0, 8)

    const primaryTopOvrSummary = (primaryCrisis.ovrRecords || [])
      .slice(0, 8)
      .map(o => `• [${o.date} - ${o.subcategory}]: ${o.description.length > 130 ? o.description.slice(0, 130) + '...' : o.description}`)

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
        totalOvrRecords: ovrRecords.length
      },
      eligible_crises: eligibleCrises,
      primary_crisis: {
        domain_id: primaryCrisis.id,
        domain_name: primaryCrisis.name,
        crisis_score: primaryCrisis.totalScore,
        source_count: primaryCrisis.sourceCount,
        corroboration_level: primaryCrisis.corroborationLevel,
        critical_kpis_count: primaryCrisis.criticalKpiCount,
        recurring_findings_count: primaryCrisis.recurringFindingCount,
        ovr_incidents_count: primaryCrisis.ovrCount,
        is_triple_corroborated: !!primaryCrisis.isTripleCorroborated,
        critical_kpis_evidence: primaryCriticalKpisSummary,
        correlating_findings_evidence: primaryTopFindingsSummary,
        ovr_incidents_evidence: primaryTopOvrSummary
      },
      all_domains_ranked: sortedDomains.map(d => ({
        domain_id: d.id,
        domain_name: d.name,
        score: d.totalScore,
        source_count: d.sourceCount,
        corroboration_level: d.corroborationLevel,
        findings_count: d.findings.length,
        kpis_count: d.kpis.length,
        ovr_count: d.ovrCount,
        critical_kpis_count: d.criticalKpiCount,
        recurring_findings_count: d.recurringFindingCount
      }))
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

    // Step B: Build verified multi-source forensic evidence dossier
    const forensicDossierText = eligibleCrises.map((ec, idx) => `
======================================================================
الأزمة السريرية رقم (${idx + 1}): [${ec.domain_name}]
• مستوى التطابق الجنائي: ${ec.corroboration_level} (مجموع النقاط: ${ec.score} نقطة)
• الأدلة الجنائية الثلاثية المتطابقة:

١. الشاهد الأول (المرور الميداني والسلبيات المرصودة - إجمالي ${ec.findings_count} سلبية):
${ec.correlating_findings_evidence.length > 0 ? ec.correlating_findings_evidence.join('\n') : 'لا توجد سلبيات مرصودة لهذا المسار'}

٢. الشاهد الثاني (شيت مؤشرات الأداء الحسابية الرسمية بالمديرية - إجمالي ${ec.kpis_count} مؤشر):
${ec.critical_kpis_evidence.length > 0 ? ec.critical_kpis_evidence.join('\n') : 'لا توجد مؤشرات حرجة مسجلة'}

٣. الشاهد الثالث (بلاغات الحوادث العارضة OVR المسجلة من الأطباء والتمريض - إجمالي ${ec.ovr_count} بلاغ):
${ec.ovr_incidents_evidence.length > 0 ? ec.ovr_incidents_evidence.join('\n') : 'لا توجد بلاغات OVR مسجلة'}
======================================================================
`).join('\n')

    // AI Prompt - Blazing Intelligence (الذكاء الحارق)
    const systemPrompt = `أنت المراجع الإكلينيكي الأعلى وخبير هندسة النظم السريرية وتوكيد الجودة المعتمد (GAHAR Fellow & Senior Clinical Systems Architect).
مهمتك تصميم ميثاق مشروع تحسين جودة مؤسسي استراتيجي رفيع المستوى (Institutional Quality Improvement Project - QIP) لمعالجة الأزمات النظامية الكبرى للمستشفى، والتي تم استخراجها وتأكيدها عبر «التحقيق الجنائي الإكلينيكي ثلاثي الأركان» (Triple Forensic Triangulation):
1. الشاهد الأول (الميداني): السلبيات الموثقة بزيارات فرق المرور والتفتيش.
2. الشاهد الثاني (الرقمي): مؤشرات الأداء الحسابية والنسب المئوية الرسمية المسجلة بشيت جوجل.
3. الشاهد الثالث (الواقعي): بلاغات الحوادث العارضة (OVR) وأحداث الاقتراب من الخطر (Near Misses) المسجلة من الأطباء والتمريض.

قواعد الذكاء الحارق الصارمة لهندسة مشاريع التحسين (Blazing Clinical Intelligence Rules):
1. قاعدة التطابق متعدد المصادر الإلزامي (Multi-Source Corroboration Mandate):
   - يُشترط حتماً في كل مشروع مقترح أن يستند إلى دليل مؤكد من (مصدرين على الأقل من المصادر الثلاثة)، والأولوية القصوى للمسارات المدعومة بالمصادر الثلاثة معاً (مرور + شيت جوجل + OVR).
   - يجب في كل مشروع توثيق كائن "forensic_corroboration" يوضح شهود الإثبات الثلاثة بالتفصيل:
     * corroboration_level: "تطابق جنائي ثلاثي (3 من 3 مصادر)" أو "تطابق ثنائي المصدر (2 من 3 مصادر)"
     * source_1_field_finding: نص السلبية الميدانية الدقيقة المرصودة بالمرور
     * source_2_sheet_kpi: اسم المؤشر من شيت جوجل مع ذكر النسبة المئوية الفعلية المسجلة (مثال: أخطاء التعريف = 10% أو الأوامر الشفهية = 0%)
     * source_3_staff_ovr: تفاصيل واقعة وبلاغ OVR الحقيقي المسجل من الطاقم

2. الحظر المطلق والبات للمشاريع الإدارية الهزيلة وحلول "التدريب الشكلي":
   - يُمنع منعاً باتاً صياغة مشاريع بعنوان أو بمضمون:
     * "تحديث السياسات والإجراءات وتوحيد الوثائق"
     * "تنظيم وترتيب المخازن أو دواليب الأرشيف"
     * "برامج تدريبية أو ورش عمل أو حملات توعية عامة"
     * "توفير بوسترات أو لوحات أو كروت تعريف"
   - مشاريع الجودة الحقيقية لا تعالج الإهمال الفردي أو النظافة الروتينية، بل تعالج «الفشل الهيكلي العميق في مسار العمل» (Complex System Breakdown).
   - الحلول المقترحة يجب أن تكون حصراً:
     * بوابات إيقاف وفحص صلبة مانعة للخطأ (Poka-Yoke Hard-Stops) تمنع إتمام الإجراء السريري إلا بعد اكتمال التحقق.
     * نظام التحقق المزدوج المستقل الإجباري (Independent Forced Double-Check).
     * مسارات التوثيق الرقمي المغلق (Closed-Loop Workflow).
     * بروتوكول تصعيد قيادي فوري وآلي للمدير الطبي عند رصد أي مؤشر حرج أو حادث عارض.

3. التمايز التام والاستقلالية الجذرية بين المشاريع المقترحة (Zero Duplication):
   - يجب أن يستهدف كل مشروع مساراً سريرياً حرجاً مستقلاً تماماً ومختلفاً عن المشاريع الأخرى. يُمنع تكرار نفس الفكرة بأسماء بديلة!
   - إذا توفرت أكثر من أزمة مؤكدة جنائياً، يُوزع كل مشروع على أزمة مختلفة أو مسار إكلينيكي مستقل.

4. المصداقية التامة وخلو خط الأساس (Baseline) من الهلوسة أو الأرقام الوهمية:
   - يُمنع اختلاق أو تخمين أي وفيات أو أرقام غير واردة بالأدلة.
   - خط الأساس يجب أن يقتبس حرفياً الأرقام الفعلية لشيت جوجل وبلاغات OVR المرفقة أدناه.

أخرج النتيجة بصيغة JSON فقط.`

    const userPrompt = `بيانات المستشفى والأزمات السريرية الكبرى المستخرجة عبر التحقيق الجنائي ثلاثي الأركان:
- اسم المستشفى: ${hospital.name} (مطابق لشيت جوجل: ${hospital.matchedSheetName || 'غير مسجل'})
- إجمالي السلبيات المرصودة بالمرور: ${crisisAnalysis.stats.totalFindings} (السريرية المؤهلة: ${crisisAnalysis.stats.eligibleFindings})
- إجمالي مؤشرات الأداء المفحوصة بشيت جوجل: ${crisisAnalysis.stats.totalSheetKpis} (منها ${crisisAnalysis.stats.criticalSheetKpis} مؤشر في حالة خطر/حرج)
- إجمالي بلاغات الحوادث العارضة (OVR) المسجلة: ${crisisAnalysis.stats.totalOvrRecords} بلاغ

ملف الأدلة الجنائية للأزمات المعتمدة بالمستشفى (Evidence Dossier):
${forensicDossierText}

المطلوب:
صِغ بالضبط عدد (${count}) مقترحات مشاريع تحسين مؤسسية جادة لمعالجة هذه الأزمات السريرية، بحيث يركز كل مشروع على مسار سريري حرج ومستقل تماماً ويثبت تطابقه مع مصدرين أو 3 مصادر.

الصيغة المطلوبة (JSON فقط - مصفوفة projects تحتوي على ${count} مشروع):
{
  "projects": [
    {
      "title": "عنوان المشروع السريري الرصين المعبر عن المسار والحل",
      "department_name": "القسم المعني",
      "category": "سلامة المرضى / إدارة واستخدام الدواء / مكافحة العدوى والتعقيم / الرعاية الحرجة والطوارئ / الملف الطبي والتوثيق / إدارة السلامة والمرافق (FMS)",
      "priority": "high",
      "forensic_corroboration": {
        "corroboration_level": "تطابق جنائي ثلاثي (3 من 3 مصادر)",
        "source_1_field_finding": "نص السلبية الميدانية الدقيقة من تقارير المرور",
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
        "eligibility_justification": "أزمة سريرية مثبتة جنائياً بالأدلة المتطابقة لتقارير المرور وشيت مؤشرات المديرية وبلاغات OVR."
      },
      "problem_statement": "بيان المشكلة يربط شهود الإثبات الثلاثة دون اختلاق وفيات غير موثقة",
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
