import { createServiceClient } from '../lib/supabase.js'
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

  // 2. Get single project
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

    const { data: row, error } = await this.supabase
      .from('settings')
      .select('*')
      .eq('key', `improvement_project:${id}`)
      .maybeSingle()

    if (error) throw error
    if (!row) return null
    return JSON.parse(row.value)
  }

  // 3. Save / Insert Project
  async saveProject(projectData) {
    const id = projectData.id || crypto.randomUUID()
    const now = new Date().toISOString()
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

  // 6. AI Generation: Analyze hospital performance and generate evidence-based projects
  async generateProjectsForHospital(hospitalId, options = {}) {
    const { count = 3, focusDepartment = null } = options

    // 1. Fetch Hospital
    const { data: hospital, error: hospErr } = await this.supabase
      .from('hospitals')
      .select('*')
      .eq('id', hospitalId)
      .single()

    if (hospErr || !hospital) throw new Error('المستشفى غير موجود')

    // 2. Fetch Reports
    const { data: reports } = await this.supabase
      .from('reports')
      .select('id, inspection_date, inspector_name, file_name')
      .eq('hospital_id', hospitalId)
      .order('inspection_date', { ascending: false })
      .limit(10)

    // 3. Fetch Findings
    let findingsQuery = this.supabase
      .from('v_report_findings')
      .select('id, department_id, original_text, priority, status, repeat_count, departments(name)')
      .eq('hospital_id', hospitalId)

    const { data: findings } = await findingsQuery
    if (!findings || findings.length === 0) {
      throw new Error('لا توجد سلبيات مسجلة لهذا المستشفى لإجراء تحليل مشاريع التحسين عليها.')
    }

    // 4. Extract and rank candidate problems using GAHAR Prioritization & Single-Problem Focus
    // Filter out trivial one-step physical maintenance, routine clerical audits, and simple supervisory PPE compliance
    const isNonQipTask = (text) => {
      const lower = (text || '').toLowerCase()
      
      // 1. Routine physical maintenance, housekeeping, furniture, procurement
      const maintenanceTerms = [
        'جرس استدعاء', 'جرس التمريض', 'ترمومتر', 'لمبة', 'بوابة', 'كالون', 'صنبور', 'سباكة',
        'كرسي', 'مفتاح كهرباء', 'دهان', 'تربيزة', 'بلاط', 'أرضيات', 'حشائش', 'بلاعة',
        'شفاط', 'مضخه', 'دولاب', 'أرفف', 'توفير كراسي', 'توفير غرفه ارشيف', 'توفير مستلزمات غسيل',
        'حوض مطابق', 'حقيبة انسكابات', 'سجل cpr'
      ]
      if (maintenanceTerms.some(term => lower.includes(term))) return true

      // 2. Posters, stickers, labels, warning signs (Just-Do-It printing/placement)
      const posterTerms = [
        'بوستر', 'بوسترات', 'race', 'pass', 'كارت فحص', 'كروت التعريف', 'طفايه الحريق', 'ماسة المواد', 'ماسة كيميائية'
      ]
      if (posterTerms.some(term => lower.includes(term))) return true

      // 3. Isolated supervisory PPE reminders / individual worker habit (solved by head nurse supervision/in-service training)
      const supervisoryPpeTerms = [
        'دون قفازات', 'بدون قفازات', 'ارتداء قفازات', 'كمامة', 'مريلة', 'جاون', 'نقل المرضي بمرافقه التمريض', 'الابرون معلق'
      ]
      if (supervisoryPpeTerms.some(term => lower.includes(term))) return true

      // 4. Routine clerical single-field signatures, numbering, stamps, scratch-outs
      const clericalTerms = [
        'توقيع الاطباء في بعض النماذج احادي', 'توقيع الصيدلى على الادويه في بعض الملفات',
        'شطب وكشط', 'غير مرقمة', 'اعتماد دفتر', 'سجل المشورة', 'كتابه عليه التوقيع'
      ]
      if (clericalTerms.some(term => lower.includes(term))) return true

      return false
    }

    // Measure high-impact systemic clinical weight
    const getSystemicClinicalWeight = (text) => {
      const lower = (text || '').toLowerCase()
      let weight = 0
      
      // Core GAHAR & WHO Clinical / Patient Safety Pathways
      if (lower.includes('توافق دوائي')) weight += 15
      if (lower.includes('جلطات') || lower.includes('vte')) weight += 15
      if (lower.includes('نتائج حرجة') || lower.includes('النتائج الحرجه')) weight += 15
      if (lower.includes('عاليه الخطوره') || lower.includes('عالية الخطورة') || lower.includes('أدوية عالية')) weight += 12
      if (lower.includes('غرفه العزل') || lower.includes('غرفة العزل') || lower.includes('العزل')) weight += 12
      if (lower.includes('care plan') || lower.includes('خطة الرعاية') || lower.includes('خطة العلاج')) weight += 12
      if (lower.includes('جرعات') && lower.includes('أشعة')) weight += 10
      if (lower.includes('أوتوكلاف') || lower.includes('تعقيم المزارع')) weight += 10
      if (lower.includes('تقييم السقوط')) weight += 8
      if (lower.includes('الوصفه الدوائيه') || lower.includes('الوصفة الدوائية')) weight += 8

      return weight
    }

    const eligibleFindings = findings.filter(f => !isNonQipTask(f.original_text))

    // Filter by department if requested
    let targetFindings = eligibleFindings
    if (focusDepartment) {
      const matchDept = (d) => (d || '').toLowerCase().includes(focusDepartment.toLowerCase())
      targetFindings = eligibleFindings.filter(f => matchDept(f.departments?.name))
    }

    // Rank individual candidate problems: prioritize Systemic Clinical Weight + High Risk + Recurring
    const rankedCandidates = targetFindings.map(f => {
      const isRecurring = f.repeat_count >= 2 || f.status === 'recurring'
      const isHigh = f.priority === 'high'
      const systemicWeight = getSystemicClinicalWeight(f.original_text)
      const score = (isRecurring ? 5 : 0) + (isHigh ? 4 : 1) + systemicWeight
      return {
        id: f.id,
        dept: f.departments?.name || 'عام',
        text: f.original_text,
        priority: f.priority || 'medium',
        repeat_count: f.repeat_count || 1,
        systemicWeight,
        score
      }
    }).sort((a, b) => b.score - a.score)

    // Deduplicate very similar text to ensure distinct issues
    const seenTexts = new Set()
    const uniqueCandidates = []
    for (const c of rankedCandidates) {
      const normalized = c.text.trim().toLowerCase()
      if (!seenTexts.has(normalized)) {
        seenTexts.add(normalized)
        uniqueCandidates.push(c)
      }
    }

    // Prepare prioritized candidate problems text (Top 10 distinct systemic issues)
    const candidateProblemsText = uniqueCandidates.slice(0, 10).map((c, idx) => {
      const rep = c.repeat_count >= 2 ? ` [متكررة ${c.repeat_count} مرات]` : ''
      const prio = c.priority === 'high' ? ' [أولوية قصوى]' : ''
      const sys = c.systemicWeight > 0 ? ' [مسار إكلينيكي عالي الأثر]' : ''
      return `${idx + 1}. [${c.dept}]${rep}${prio}${sys}: "${c.text}"`
    }).join('\n')

    const inspectionDates = reports?.map(r => r.inspection_date).filter(Boolean).slice(0, 5).join(' و ') || 'زيارات متعددة'
    const totalFindingsCount = findings.length
    const openFindingsCount = findings.filter(f => ['open', 'recurring'].includes(f.status)).length
    const recurringCount = findings.filter(f => f.repeat_count >= 2 || f.status === 'recurring').length

    // AI Prompt - Strictly enforcing Single Problem per QIP & GAHAR Prioritization
    const systemPrompt = `أنت استشاري أول وخبير توكيد جودة واعتماد مستشفيات ومراجع معتمد (GAHAR Senior Quality Surveyor & Fellow of IHI).
مهمتك تقييم واختيار وتصميم مشاريع تحسين جودة مؤسسية كبرى (Quality Improvement Projects - QIPs) مبنية على الدليل العلمي ومنهجية FOCUS-PDCA ومعايير GAHAR الوطنية.

قواعد صارمة لاختيار وتصميم مشاريع التحسين المؤسسية (Strict QIP Selection Rules):
1. قاعدة المشكلة المحورية الواحدة الحصرية (Strict Single Core Problem Focus):
   - كل مشروع تحسين يجب أن يركز 100% وبشكل حصري ومستقل على قضية إكلينيكية كبرى واحدة محددة فقط من قائمة المشاكل المرشحة.
   - يُمنع منعاً باتاً دمج أو جمع عدة مشاكل مختلفة في مشروع واحد.
   - حقل (linked_findings_summary) يجب أن يحتوي حصراً على مصفوفة بها نص المشكلة الواحدة المحددة المستهدفة فقط (عنصر واحد فقط بالمصفوفة).

2. التمييز الحاسم بين "مشروع التحسين المؤسسي QIP" وبين "المهام الإشرافية والتدريب البسيط Just-Do-It / CAPA":
   - ممنوع منعاً باتاً فتح مشروع تحسين لملاحظة إشرافية بسيطة أو سلوك فردي يُحل بتوجيه إشرافي مباشر أو تدريب سريع (مثل: ممرضة لا ترتدي قفازات، طبيب لم يوقع، أو شراء أداة، أو إصلاح جرس/دهان، أو لصق ورقة). هذه إجراءات تصحيحية يومية روتينية وليست مشاريع تحسين!
   - مشروع التحسين المؤسسي (QIP) مخصص حصرياً للمشاكل السريرية والتشغيلية النظامية المعقدة (Systemic Multidisciplinary Clinical Pathways) التي تؤثر مباشرة على معدلات الوفيات، والمضاعفات، وسلامة المرضى، وتتطلب إعادة هندسة مسار عمل كامل يشترك فيه عدة تخصصات (أطباء، تمريض، صيادلة، معامل، جودة) على مدار 8-12 أسبوعاً، مثل:
     * بروتوكول تقييم ومنع الجلطات الوريدية (VTE Prophylaxis & Risk Assessment).
     * منظومة التوافق الدوائي الشامل (Medication Reconciliation) لمنع التعارضات الدوائية القاتلة.
     * منظومة وقوائم النتائج الحرجة وسرعة الإبلاغ المغلق (Critical Value Notification System).
     * حوكمة ومأمونية الأدوية عالية الخطورة والمتشابهة (High-Alert Medications & LASA Safety).
     * مسارات وضوابط غرف العزل الطبي للأمراض المعدية ومنع التفشي الوبائي.
     * الخطة العلاجية والتوثيق الطبي متعدد التخصصات بالعناية المركزة (ICU Multidisciplinary Care Plan).

3. معايير الأولوية الخمسة المعتمدة دولياً للاختيار (GAHAR Prioritization Matrix):
   - High Risk: عالية الخطورة ومسببة للمضاعفات أو الوفاة (مثل الجلطات الوريدية، أمان الدواء، النتائج الحرجة).
   - High Volume: عالية الحجم والتكرار وتؤثر على قطاع واسع من المنومين.
   - Problem-Prone & Process Complexity: مسار عمل معقد يشترك فيه أطراف متعددة وعرضة للتباين والخطأ.
   - Strategic Alignment: توافق مباشر مع معايير GAHAR وأهداف سلامة المرضى الدولية.

4. المصطلحات الطبية المعتمدة:
   - استخدم حصراً مصطلح «التوافق الدوائي» لترجمة Medication Reconciliation.
   - استخدم مصطلح «تقييم ومنع الجلطات الوريدية (VTE)».
   - استخدم مصطلح «الإبلاغ الفوري المغلق عن النتائج الحرجة (Critical Results Reporting)».

أخرج النتيجة بصيغة JSON فقط.`

    const userPrompt = `بيانات أداء المستشفى:
- اسم المستشفى: ${hospital.name}
- عدد تقارير المرور الأخيرة: ${reports?.length || 0} (بتواريخ: ${inspectionDates})
- إجمالي السلبيات المرصودة: ${totalFindingsCount}
- السلبيات المفتوحة قيد الإجراء: ${openFindingsCount}
- السلبيات المتكررة المؤهلة: ${recurringCount}
${focusDepartment ? `- القسم المطلوب التركيز عليه: ${focusDepartment}` : ''}

قائمة المشاكل والسلبيات السريرية والتشغيلية الكبرى المرشحة (مشاكل كبرى مستقلة):
${candidateProblemsText}

المطلوب:
اختر من القائمة أعلاه بالضبط عدد (${count}) مشاكل كبرى محورية مختلفة (أولوية للسلبيات عالية الخطورة والمتكررة)، وصِغ لكل مشكلة منفصلة "مشروع تحسين جودة مستقل ومكتمل الأركان" (QIP).

متطلبات كل مشروع (مشكلة واحدة منفصلة تماماً لكل مشروع):
1. عنوان المشروع (Title): اسم واضح ومحدد يعكس المشكلة الواحدة والحل المستهدف بدقة.
2. مبررات الاختيار وتقييم مصفوفة الأولويات (Prioritization Matrix Scoring):
   - درجة الخطورة السريرية (patient_safety_risk) من 1 إلى 5
   - حجم وتكرار المشكلة (volume_frequency) من 1 إلى 5
   - تعقيد المسار والحاجة لتغيير سلوكي (process_complexity) من 1 إلى 5
   - التوافق الاستراتيجي مع معايير GAHAR (strategic_alignment) من 1 إلى 5
   - مبرر الأهلية (eligibility_justification): شرح موجز لماذا تستحق هذه المشكلة الواحدة فتح مشروع تحسين كامل.
3. بيان المشكلة (Problem Statement): يركز حصرياً على هذه القضية المحددة، تكرارها، مسبباتها، خطورتها السريرية، وأرقام خط الأساس (Baseline).
4. الهدف الذكي (SMART Goal): هدف كمي محدد وزمني لاستئصال هذه المشكلة ورفع الامتثال إلى 95% أو تصفير تكرارها.
5. المرجع العلمي (Evidence Reference): معيار GAHAR المباشر المعني وتوصية WHO ذات الصلة بهذه المشكلة.
6. مؤشرات الأداء (KPIs): مؤشر عملية ومؤشر نتيجة مخصصان لهذه المشكلة الواحدة فقط.
7. خطة التدخلات (FOCUS-PDCA): خطوات لمعالجة الأسباب الجذرية للمشكلة.
8. السلبيات المرتبطة (linked_findings_summary): مصفوفة بها نص المشكلة الواحدة المحددة المستهدفة فقط (عنصر واحد فقط بالمصفوفة - ممنوع جمع سلبيات أخرى).

الصيغة المطلوبة (JSON فقط - مصفوفة projects تحتوي على ${count} مشروع مستقل):
{
  "projects": [
    {
      "title": "عنوان محدد لمشروع يعالج مشكلة واحدة كبرى فقط",
      "department_name": "القسم المعني",
      "category": "سلامة المرضى / إدارة واستخدام الدواء / مكافحة العدوى والتعقيم / الرعاية الحرجة والطوارئ / الملف الطبي والتوثيق / إدارة السلامة والمرافق (FMS)",
      "priority": "high",
      "prioritization_matrix": {
        "patient_safety_risk": 5,
        "volume_frequency": 4,
        "process_complexity": 5,
        "strategic_alignment": 5,
        "total_score": 19,
        "eligibility_justification": "مسار إكلينيكي عالي الخطورة يتطلب تحليلاً للأسباب وتغييراً في الممارسات التدريبية والسياسات ويتبع معايير الاعتماد الوطنية."
      },
      "problem_statement": "بيان المشكلة وتحليل الأداء الفعلي الخاص بها بالأرقام والمخاطر",
      "baseline_metrics": "الأرقام والنسب المرجعية الحالية لهذه المشكلة قبل التحسين",
      "smart_goal": "الهدف الذكي القابل للقياس وموعد الإنجاز المستهدف",
      "evidence_reference": "الدليل الإرشادي ومعيار GAHAR المعني بالمشكلة",
      "target_duration_weeks": 12,
      "kpis": [
        { "name": "مؤشر العملية للالتزام بالخطوات", "type": "process", "baseline": "20%", "target": "95%", "frequency": "شهري" },
        { "name": "مؤشر النتيجة السريرية/التشغيلية", "type": "outcome", "baseline": "حوادث متكررة", "target": "صفر", "frequency": "شهري" }
      ],
      "interventions": [
        { "step": "خطوة التدخل الإجرائي لعلاج السبب الجذري", "responsible": "المسؤول عن التنفيذ", "duration": "أسبوعين" }
      ],
      "project_lead": "المسؤول المقترح عن قيادة المشروع بالمستشفى",
      "team_members": ["عضو 1", "عضو 2", "عضو 3"],
      "linked_findings_summary": ["نص المشكلة الواحدة المحددة فقط"]
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
        baseline_metrics: p.baseline_metrics || p.baseline || 'خط الأساس قيد القياس والتحليل',
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
        directorate_notes: 'مشروع مقترح مبني على تحليل تقارير المرور وتطبيق مصفوفة أولويات GAHAR وحزم التدابير السريرية (Care Bundles).'
      }

      const saved = await this.saveProject(projectRecord)
      savedProjects.push(saved)
    }

    return savedProjects
  }
}
