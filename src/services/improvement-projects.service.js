import { createServiceClient } from '../lib/supabase.js'
import { fetchGoogleSheetData } from '../lib/google-sheets.js'
import { findMatchingSheetHospital } from '../lib/hospital-matcher.js'
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

  // 7. Clinical Domain Classification & Synthesis
  classifyDomain(text) {
    const lower = (text || '').toLowerCase()

    if (
      lower.includes('دواء') || lower.includes('دوائي') || lower.includes('صيدلية') || lower.includes('صيدلي') ||
      lower.includes('وصفات') || lower.includes('وصفة') || lower.includes('ترياق') || lower.includes('حقن آمن') ||
      lower.includes('كراش') || lower.includes('عالية الخطورة') || lower.includes('عاليه الخطوره') ||
      lower.includes('lasa') || lower.includes('تفاعلات دوائية')
    ) {
      return 'MEDICATION_MANAGEMENT'
    }

    if (
      lower.includes('عدوى') || lower.includes('عزل') || lower.includes('تعقيم') || lower.includes('أوتوكلاف') ||
      lower.includes('واقيات شخصية') || lower.includes('نفايات') || lower.includes('تطهير') || lower.includes('كوفيد') ||
      lower.includes('ميكروبيولوجي') || lower.includes('vap') || lower.includes('cauti') || lower.includes('clabsi') ||
      lower.includes('ssi') || lower.includes('فيروس b')
    ) {
      return 'INFECTION_PREVENTION'
    }

    if (
      lower.includes('عناية') || lower.includes('طوارئ') || lower.includes('استقبال') || lower.includes('فرز') ||
      lower.includes('نتائج حرجة') || lower.includes('vte') || lower.includes('جلطات') || lower.includes('إنعاش') ||
      lower.includes('cpr') || lower.includes('تدهور') || lower.includes('قساطر') || lower.includes('علامات حيوية')
    ) {
      return 'CRITICAL_EMERGENCY_CARE'
    }

    if (
      lower.includes('سقوط') || lower.includes('قرح الفراش') || lower.includes('تعريف المريض') || lower.includes('أوامر شفهية') ||
      lower.includes('شكاوى') || lower.includes('حقوق المرضى') || lower.includes('رضا المرضى') || lower.includes('أحداث عارضة')
    ) {
      return 'PATIENT_SAFETY_GOVERNANCE'
    }

    if (
      lower.includes('ملف طبي') || lower.includes('ملف') || lower.includes('تذكرة') || lower.includes('نموذج') ||
      lower.includes('توافق دوائي') || lower.includes('care plan') || lower.includes('خطة رعاية') || lower.includes('اختصارات')
    ) {
      return 'MEDICAL_RECORDS'
    }

    return 'FACILITY_BIOMEDICAL_SAFETY'
  }

  // 8. Analyze Hospital Crisis (Cross-Synthesis of Findings & Google Sheet KPIs)
  // This extracts: «أكبر مشكلة تعاني منها المستشفى»
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

    // Filter out trivial maintenance/handyman tasks
    const isNonQipTask = (text) => {
      const lower = (text || '').toLowerCase()
      const trivial = [
        'جرس استدعاء', 'جرس التمريض', 'ترمومتر', 'لمبة', 'بوابة', 'كالون', 'صنبور', 'سباكة',
        'كرسي', 'مفتاح كهرباء', 'دهان', 'تربيزة', 'بلاط', 'أرضيات', 'حشائش', 'بلاعة',
        'شفاط', 'مضخه', 'دولاب', 'أرفف', 'توفير كراسي', 'توفير غرفه ارشيف', 'توفير مستلزمات غسيل',
        'بوستر', 'بوسترات', 'race', 'pass', 'كارت فحص', 'كروت التعريف', 'طفايه الحريق',
        'دون قفازات', 'بدون قفازات', 'ارتداء قفازات', 'كمامة', 'مريلة', 'جاون',
        'توقيع الاطباء في بعض النماذج احادي', 'توقيع الصيدلى على الادويه في بعض الملفات',
        'شطب وكشط', 'غير مرقمة', 'اعتماد دفتر', 'سجل المشورة', 'كتابه عليه التوقيع'
      ]
      return trivial.some(t => lower.includes(t))
    }

    const eligibleFindings = (findings || []).filter(f => !isNonQipTask(f.original_text))

    // 3. Fetch Google Sheet KPIs
    const { matchedName, kpis: sheetKpis } = await this.fetchHospitalKpisFromSheet(hospital.name)

    // Domain definitions
    const domainMeta = {
      MEDICATION_MANAGEMENT: {
        id: 'MEDICATION_MANAGEMENT',
        name: 'إدارة ومأمونية الدواء والصيدلة السريرية (Medication Safety & Pharmacy)',
        clinicalRiskFactor: 1.3
      },
      CRITICAL_EMERGENCY_CARE: {
        id: 'CRITICAL_EMERGENCY_CARE',
        name: 'الرعاية الحرجة وفرز الطوارئ والإنقاذ (Critical Care & Emergency Triage)',
        clinicalRiskFactor: 1.4
      },
      INFECTION_PREVENTION: {
        id: 'INFECTION_PREVENTION',
        name: 'مكافحة العدوى والتعقيم والعزل الطبي (Infection Prevention & Isolation)',
        clinicalRiskFactor: 1.3
      },
      PATIENT_SAFETY_GOVERNANCE: {
        id: 'PATIENT_SAFETY_GOVERNANCE',
        name: 'الأهداف الوطنية لسلامة المرضى (National Patient Safety Goals - NPSGs)',
        clinicalRiskFactor: 1.2
      },
      MEDICAL_RECORDS: {
        id: 'MEDICAL_RECORDS',
        name: 'اكتمال الملف الطبي والتوثيق السريري والتوافق (Clinical Documentation & Med-Rec)',
        clinicalRiskFactor: 1.1
      },
      FACILITY_BIOMEDICAL_SAFETY: {
        id: 'FACILITY_BIOMEDICAL_SAFETY',
        name: 'السلامة والصحة المهنية والأجهزة الطبية (Biomedical Equipment & FMS)',
        clinicalRiskFactor: 1.0
      }
    }

    const domainBuckets = {}
    for (const [key, meta] of Object.entries(domainMeta)) {
      domainBuckets[key] = {
        ...meta,
        findings: [],
        kpis: [],
        criticalKpiCount: 0,
        riskKpiCount: 0,
        recurringFindingCount: 0,
        highPriorityFindingCount: 0,
        totalScore: 0
      }
    }

    // Place KPIs into domains
    sheetKpis.forEach(k => {
      const domainKey = this.classifyDomain(k.Indicator)
      const target = domainBuckets[domainKey] || domainBuckets.PATIENT_SAFETY_GOVERNANCE
      target.kpis.push(k)

      const isCritical = k.Alert_Level === 'Critical'
      const isRisk = k.Status === 'Risk' || k.Alert_Level === 'Alert'
      if (isCritical) {
        target.criticalKpiCount++
        target.totalScore += 20
      } else if (isRisk) {
        target.riskKpiCount++
        target.totalScore += 10
      }
    })

    // Place Findings into domains
    eligibleFindings.forEach(f => {
      const domainKey = this.classifyDomain(`${f.original_text} ${f.departments?.name || ''}`)
      const target = domainBuckets[domainKey] || domainBuckets.PATIENT_SAFETY_GOVERNANCE
      target.findings.push(f)

      const isRec = (f.repeat_count || 1) >= 2 || f.status === 'recurring'
      const isHigh = f.priority === 'high'

      if (isRec) target.recurringFindingCount++
      if (isHigh) target.highPriorityFindingCount++

      target.totalScore += (isRec ? 8 : 3) + (isHigh ? 6 : 2)
    })

    // Apply clinical multiplier
    for (const d of Object.values(domainBuckets)) {
      d.totalScore = Math.round(d.totalScore * d.clinicalRiskFactor)
    }

    // Sort domains descending by total score
    const sortedDomains = Object.values(domainBuckets).sort((a, b) => b.totalScore - a.totalScore)
    const primaryCrisis = sortedDomains[0]

    // Formulate the Crisis Diagnosis Summary
    const criticalKpisSummary = primaryCrisis.kpis
      .filter(k => k.Alert_Level === 'Critical' || k.Status === 'Risk')
      .map(k => `• ${k.Indicator}: القيمة الفعلية المسجلة ${k.Value}% (حالة الخطر: ${k.Alert_Level || k.Status})`)
      .slice(0, 5)

    const topFindingsSummary = primaryCrisis.findings
      .sort((a, b) => (b.repeat_count || 1) - (a.repeat_count || 1))
      .map(f => `• [${f.departments?.name || 'عام'}]: ${f.original_text} (تكرر ${f.repeat_count || 1} مرات)`)
      .slice(0, 5)

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
        criticalSheetKpis: sheetKpis.filter(k => k.Alert_Level === 'Critical' || k.Status === 'Risk').length
      },
      primary_crisis: {
        domain_id: primaryCrisis.id,
        domain_name: primaryCrisis.name,
        crisis_score: primaryCrisis.totalScore,
        critical_kpis_count: primaryCrisis.criticalKpiCount,
        recurring_findings_count: primaryCrisis.recurringFindingCount,
        critical_kpis_evidence: criticalKpisSummary,
        correlating_findings_evidence: topFindingsSummary
      },
      all_domains_ranked: sortedDomains.map(d => ({
        domain_id: d.id,
        domain_name: d.name,
        score: d.totalScore,
        findings_count: d.findings.length,
        kpis_count: d.kpis.length,
        critical_kpis_count: d.criticalKpiCount,
        recurring_findings_count: d.recurringFindingCount
      }))
    }
  }

  // 9. AI Generation: Propose Evidence-Based QIPs Grounded in the Primary Crisis
  async generateProjectsForHospital(hospitalId, options = {}) {
    const { count = 3, focusDepartment = null } = options

    // Step A: Perform full integrated crisis analysis (Findings + Google Sheet KPIs)
    const crisisAnalysis = await this.analyzeHospitalCrisis(hospitalId)
    const primaryCrisis = crisisAnalysis.primary_crisis
    const hospital = crisisAnalysis.hospital

    // Step B: Prepare verified evidence text
    const kpiEvidenceText = primaryCrisis.critical_kpis_evidence.length > 0
      ? primaryCrisis.critical_kpis_evidence.join('\n')
      : 'لا توجد مؤشرات حرجة مسجلة في شيت جوجل لهذا المسار.'

    const findingsEvidenceText = primaryCrisis.correlating_findings_evidence.length > 0
      ? primaryCrisis.correlating_findings_evidence.join('\n')
      : 'لا توجد سلبيات متكررة مسجلة بالمرور لهذا المسار.'

    // AI Prompt - Strictly Evidence-Based on Real Google Sheet KPIs & Field Findings
    const systemPrompt = `أنت استشاري أول وخبير توكيد جودة واعتماد مستشفيات ومراجع معتمد (GAHAR Senior Quality Surveyor & Fellow of IHI).
مهمتك تصميم ميثاق مشروع تحسين جودة مؤسسي استراتيجي (Quality Improvement Project - QIP) لمعالجة «أكبر أزمة نظامية تعاني منها المستشفى» والتي تم استخراجها عبر التقاطع المباشر بين تقارير المرور الميدانية وشيت مؤشرات الأداء الرسمي بالمديرية.

قواعد الهندسة السريرية لمشاريع التحسين (Strict Clinical Architecture Rules):
1. قاعدة المشكلة الكبرى الأولى الحصرية (Single Core Primary Crisis Focus):
   - يجب أن يركز المشروع 100% وبشكل حصري على معالجة «الأزمة الكبرى المستخرجة للمستشفى»: (${primaryCrisis.domain_name}).
   - يُمنع منعاً باتاً دمج مشاكل غير مرتبطة، ويُمنع فتح مشاريع على مهام إشرافية روتينية تُحل بالتدريب السريع أو التوقيع الورقي.

2. قاعدة المصداقية التامة وربط خط الأساس (Baseline) بالأرقام الحقيقية من شيت جوجل:
   - يُمنع منعاً باتاً اختلاق أو تخمين أي أرقام وفيات أو نسب عشوائية!
   - خط الأساس (Baseline Metrics) يجب أن يستند حصراً إلى:
     * الأرقام الرسمية الحقيقية المذكورة في قائمة مؤشرات شيت جوجل المرفقة أدناه (مثال: أخطاء الوصفات = 19% حسب شيت المديرية).
     * إذا كان المؤشر غير مقاس بالأرقام في الشيت، يُكتب نصاً: "قيد التدقيق والقياس المرجعي في مرحلة التحليل الأولى للمشروع".
     * المستهدف (Target): يُحدد المعيار الوطني المعتمد (مثلاً: امتثال ≥ 95%، أو خفض الأخطاء إلى <2%).

3. معيار المشكلة المستعصية صعبة الحل (Hard-to-Solve Criteria):
   - يجب توضيح (why_hard_to_solve) ولماذا فشل التدريب الروتيني في حلها، وما هي التعقيدات التنظيمية والسريرية.
   - تحليل الأسباب الجذرية (root_cause_analysis) للخلل في مسار العمل (Process Breakdown).

4. التدخلات التنفيذية الهندسية الصارمة (Systemic Engineering Interventions):
   - ممنوع كتابة خطوات شكلية عامة (مثل: عقد اجتماع، تدريب أسبوع، اعتماد ورقة، التفتيش).
   - التدخلات يجب أن تكون: إعادة تصميم المسار السريري (Workflow Redesign)، وبوابات فحص وإيقاف إجبارية مانعة للخطأ (Poka-Yoke Hard-Stops)، وبروتوكول تصعيد فوري للقيادة عند التأخير، وتدقيق سريري مغلق أسبوعي.

أخرج النتيجة بصيغة JSON فقط.`

    const userPrompt = `بيانات الأزمة السريرية الكبرى المستخرجة للمستشفى:
- اسم المستشفى: ${hospital.name} (مطابق لشيت جوجل: ${hospital.matchedSheetName || 'غير مسجل'})
- إجمالي السلبيات المرصودة بالمرور: ${crisisAnalysis.stats.totalFindings}
- إجمالي مؤشرات الأداء المفحوصة بشيت جوجل: ${crisisAnalysis.stats.totalSheetKpis} (منها ${crisisAnalysis.stats.criticalSheetKpis} مؤشر في حالة خطر/حرج)

أكبر مشكلة تعاني منها المستشفى (The Primary Systemic Crisis):
- المحور السريري: ${primaryCrisis.domain_name}
- درجة تركز الأزمة: ${primaryCrisis.crisis_score} نقطة

أدلة الأداء الرسمية من شيت مؤشرات جوجل (Real Google Sheet KPIs Evidence):
${kpiEvidenceText}

أدلة تقارير المرور والسلبيات الميدانية المتكررة (Inspection Findings Evidence):
${findingsEvidenceText}

المطلوب:
صِغ بالضبط عدد (${count}) مقترحات مشاريع تحسين مؤسسية جادة لمعالجة هذه الأزمة الكبرى (مشروع مستقل لمعالجة كل جانب محوري في هذه الأزمة).

متطلبات كل مشروع:
1. عنوان المشروع (Title): اسم رصين يعكس المسار والحل المستهدف.
2. لماذا هذه المشكلة مستعصية وصعبة الحل؟ (why_hard_to_solve): شرح يوضح لماذا لا يحل التدريب العادي المشكلة وما هي عوائق المسار.
3. تحليل الأسباب الجذرية (root_cause_analysis): تحليل الأسباب العميقة للخلل في مسار العمل.
4. مبررات الاختيار وتقييم مصفوفة الأولويات (prioritization_matrix): درجات 1-5 لمخاطر سلامة المرضى، الحجم، التعقيد، التوافق الاستراتيجي مع GAHAR.
5. بيان المشكلة (problem_statement): يربط السلبيات الميدانية بأرقام مؤشرات شيت جوجل دون اختلاق وفيات غير موثقة.
6. خط الأساس الحقيقي (baseline_metrics): مستند إلى أرقام شيت جوجل الرسمية المذكورة أعلاه.
7. الهدف الذكي (smart_goal): هدف كمي وزمني دقيق.
8. المرجع العلمي (evidence_reference): معايير GAHAR وتوصيات WHO المعنية.
9. مؤشرات الأداء (kpis): مؤشر عملية ومؤشر نتيجة (مع استخدام خط الأساس الحقيقي من شيت جوجل).
10. خطة التدخلات (interventions): خطوات إعادة هندسة المسار وبوابات Poka-Yoke والتصعيد القيادي.
11. السلبيات المرتبطة (linked_findings_summary): نصوص السلبيات المرصودة المتطابقة.

الصيغة المطلوبة (JSON فقط - مصفوفة projects تحتوي على ${count} مشروع):
{
  "projects": [
    {
      "title": "عنوان مشروع يعالج جانباً محورياً من الأزمة الكبرى للمستشفى",
      "department_name": "القسم المعني",
      "category": "سلامة المرضى / إدارة واستخدام الدواء / مكافحة العدوى والتعقيم / الرعاية الحرجة والطوارئ / الملف الطبي والتوثيق / إدارة السلامة والمرافق (FMS)",
      "priority": "high",
      "why_hard_to_solve": "شرح لماذا هذه المشكلة مستعصية ولا تُحل بالتدريب البسيط",
      "root_cause_analysis": "تحليل الأسباب الجذرية النظامية للخلل في مسار العمل",
      "prioritization_matrix": {
        "patient_safety_risk": 5,
        "volume_frequency": 4,
        "process_complexity": 5,
        "strategic_alignment": 5,
        "total_score": 19,
        "eligibility_justification": "أكبر أزمة سريرية تعاني منها المستشفى مثبتة بالأدلة الرقمية لشيت مؤشرات المديرية وتقارير المرور."
      },
      "problem_statement": "بيان المشكلة مستنداً لأرقام شيت جوجل وسلبيات المرور",
      "baseline_metrics": "أرقام خط الأساس الحقيقية المستخرجة من شيت مؤشرات جوجل الرسمي",
      "smart_goal": "الهدف الذكي القابل للقياس وموعد الإنجاز المستهدف",
      "evidence_reference": "معايير الهيئة العامة للاعتماد والرقابة الصحية (GAHAR)",
      "target_duration_weeks": 12,
      "kpis": [
        { "name": "مؤشر العملية للالتزام بالمسار", "type": "process", "baseline": "الرقم الحقيقي من شيت جوجل أو قيد التدقيق الأولي", "target": "95%", "frequency": "شهري" },
        { "name": "مؤشر النتيجة السريرية/التشغيلية", "type": "outcome", "baseline": "الرقم الحقيقي من شيت جوجل أو قيد الرصد المرجعي", "target": "المعيار المنشود", "frequency": "شهري" }
      ],
      "interventions": [
        { "step": "إعادة هندسة المسار / وضع بوابة فحص إلزامية Poka-Yoke / بروتوكول تصعيد", "responsible": "المسؤول عن التنفيذ", "duration": "أسبوعين" }
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
        baseline_metrics: p.baseline_metrics || p.baseline || 'مستند إلى شيت مؤشرات الأداء الرسمي بالمديرية',
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
        directorate_notes: `مشروع تحسين جودة مؤسسي مستند إلى تحليل الأزمة الكبرى للمستشفى: (${primaryCrisis.domain_name}) والربط بين تقارير المرور وشيت مؤشرات المديرية.`
      }

      const saved = await this.saveProject(projectRecord)
      savedProjects.push(saved)
    }

    return savedProjects
  }
}
