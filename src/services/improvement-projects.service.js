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

    // 4. Extract and rank candidate problems using GAHAR Prioritization & Care Bundling Engine
    // Filter out trivial one-step physical maintenance or procurement fixes (Just-Do-It tasks)
    const isTrivialTask = (text) => {
      const lower = (text || '').toLowerCase()
      const trivialTerms = [
        'جرس استدعاء', 'جرس التمريض', 'لا يوجد ترمومتر غرفة', 'ترمومتر غرفة',
        'لمبة مكسورة', 'البوابة مكسورة', 'كالون مكسور', 'تسريب صنبور',
        'كرسي مكسور', 'مفتاح كهرباء', 'دهان الحائط', 'تربيزة مكسورة',
        'بلاط مكسر', 'أرضيات بدون بلاط', 'بوسترات غسل', 'بوسترات race',
        'كارت فحص لطفاية', 'شطب وكشط ف السجل', 'غير مرقمة', 'حشائش وأكياس زبالة'
      ]
      return trivialTerms.some(term => lower.includes(term))
    }

    const eligibleFindings = findings.filter(f => !isTrivialTask(f.original_text))

    // Define 6 Master Clinical Care Bundles for systematic grouping
    const bundleDefinitions = [
      {
        id: 'emergency_triage_resuscitation',
        domain: 'مسار فرز الطوارئ والتقييم السريري والإنعاش القلبي الرئوي (Emergency Triage & Resuscitation Bundle)',
        category: 'الرعاية الحرجة والطوارئ',
        dept: 'قسم الطوارئ والاستقبال',
        keywords: ['فرز', 'استقبال', 'علامات حيوية', 'تذكرة', 'كراش', 'إنعاش', 'طوارئ', 'جلافز', 'وصفة', 'أدوية الطوارئ']
      },
      {
        id: 'medication_safety_reconciliation',
        domain: 'منظومة السلامة الدوائية الشاملة والتوافق الدوائي وحوكمة الأدوية الحرجة (Medication Safety, Reconciliation & HAM/LASA Bundle)',
        category: 'إدارة واستخدام الدواء',
        dept: 'قسم الصيدلية',
        keywords: ['توافق دوائي', 'أدوية', 'صيدلية', 'كراش', 'متشابهة', 'عالية الخطورة', 'ثلاجة', 'تبريد', 'lasa', 'ham', 'أمبولات', 'تخزين']
      },
      {
        id: 'infection_control_isolation',
        domain: 'حوكمة غرف العزل الطبي وتطبيق حزمة مكافحة العدوى والوقاية من التفشي الوبائي (Clinical Isolation & Outbreak Prevention Bundle)',
        category: 'مكافحة العدوى والتعقيم',
        dept: 'مكافحة العدوى والعزل الطبي',
        keywords: ['عزل', 'مرافقين', 'غسيل أيدي', 'وقايات شخصية', 'جلافز', 'تطهير', 'نفايات', 'بلاعة', 'عدوى', 'أوتوكلاف', 'مزارع']
      },
      {
        id: 'lab_biosafety_critical_results',
        domain: 'الأمان الحيوي وإدارة العينات والنتائج الحرجة وكواشف المعمل (Laboratory Biosafety & Critical Results Bundle)',
        category: 'سلامة المرضى',
        dept: 'المعمل وبنك الدم',
        keywords: ['معمل', 'عينات', 'كواشف', 'نتائج حرجة', 'ماسة', 'مواد خطرة', 'مزارع بكتيرية', 'ثلاجة المعمل']
      },
      {
        id: 'facility_oxygen_safety',
        domain: 'سلامة شبكة وأسطوانات الأكسجين الطبي وإدارة المخاطر البيئية والنفايات (Medical Oxygen Safety & Environmental Risk Bundle)',
        category: 'إدارة السلامة والمرافق (FMS)',
        dept: 'إدارة السلامة والمرافق (FMS)',
        keywords: ['أكسجين', 'أسطوانات', 'شبكة الغازات', 'غرفة النفايات', 'حريق', 'غازات طبية']
      },
      {
        id: 'clinical_documentation_handover',
        domain: 'حوكمة التوثيق السريري واكتمال الملف الطبي والتسليم والتسلم (Clinical Documentation & Handover Governance Bundle)',
        category: 'الملف الطبي والتوثيق',
        dept: 'الإدارة الطبية والسجلات',
        keywords: ['ملف طبي', 'توثيق', 'تذاكر', 'تسليم وتسلم', 'handover', 'اختصارات', 'تعريف المريض']
      }
    ]

    // Cluster eligible findings into clinical bundles
    const clinicalBundles = bundleDefinitions.map(b => {
      const matched = eligibleFindings.filter(f => {
        const text = (f.original_text || '').toLowerCase()
        const dept = (f.departments?.name || '').toLowerCase()
        if (focusDepartment && !dept.includes(focusDepartment.toLowerCase()) && !b.dept.toLowerCase().includes(focusDepartment.toLowerCase())) {
          return false
        }
        return b.keywords.some(kw => text.includes(kw) || dept.includes(kw))
      })

      const recurringCount = matched.filter(f => f.repeat_count >= 2 || f.status === 'recurring').length
      const highCount = matched.filter(f => f.priority === 'high').length
      const priorityScore = (recurringCount * 3) + (highCount * 2) + matched.length

      return {
        ...b,
        findings: matched,
        findingsCount: matched.length,
        recurringCount,
        highCount,
        priorityScore
      }
    }).filter(b => b.findingsCount > 0)
      .sort((a, b) => b.priorityScore - a.priorityScore)

    // Build the formatted bundles description for the AI prompt
    const candidateBundlesText = clinicalBundles.slice(0, 6).map((b, idx) => {
      const findingsSummary = b.findings.slice(0, 8).map(f => {
        const rep = (f.repeat_count >= 2 || f.status === 'recurring') ? ' [متكررة]' : ''
        const prio = f.priority === 'high' ? ' [حرجة]' : ''
        return `     • (${f.departments?.name || b.dept})${rep}${prio}: "${f.original_text}"`
      }).join('\n')

      return `${idx + 1}. [حزمة إكلينيكية / مسار معقد]: ${b.domain}
   - القسم المعني: ${b.dept}
   - التصنيف: ${b.category}
   - إجمالي السلبيات المرصودة في هذا المسار: ${b.findingsCount} (منها ${b.highCount} حرجة و ${b.recurringCount} متكررة)
   - السلبيات المرصودة التي تمثل الخلل النظامي في هذا المسار:
${findingsSummary}`
    }).join('\n\n')

    const inspectionDates = reports?.map(r => r.inspection_date).filter(Boolean).slice(0, 5).join(' و ') || 'زيارات متعددة'
    const totalFindingsCount = findings.length
    const openFindingsCount = findings.filter(f => ['open', 'recurring'].includes(f.status)).length
    const recurringCount = findings.filter(f => f.repeat_count >= 2 || f.status === 'recurring').length

    // AI Prompt - Strictly enforcing GAHAR QIP Selection & Care Bundling Methodology
    const systemPrompt = `أنت استشاري أول وخبير توكيد جودة واعتماد مستشفيات ومراجع معتمد (GAHAR Senior Quality Surveyor & Fellow of IHI).
مهمتك تقييم واختيار وتصميم مشاريع تحسين جودة استراتيجية (Quality Improvement Projects - QIPs) مبنية على الدليل العلمي ومنهجية FOCUS-PDCA، مع تطبيق حزم التدابير الإكلينيكية (Clinical Care Bundles).

قواعد صارمة لاختيار وتصميم مشاريع التحسين (Strict Quality Rules):
1. قاعدة حزم التدابير الإكلينيكية الشاملة (Care Bundling Principle) - إلزامي:
   - يُمنع منعاً باتاً صياغة مشروع تحسين على ملاحظة تفتيشية جزئية أو سلوك فردي منفصل (مثل: ارتداء قفازات فقط، أو كروت تعريف الكراش فقط، أو تعليق لافتة، أو ترقيم دفاتر).
   - كل مشروع يجب أن يصاغ كـ «حزمة تدابير إكلينيكية متكاملة (Care Bundle)» أو «مسار سريري/تشغيلي استراتيجي» يعالج المنظومة ككل، ويدمج كافة الملاحظات المترابطة المرصودة في هذا المسار تحت مظلة واحدة في حقل (linked_findings_summary).
   - أمثلة إلزامية:
     * بدلاً من "مشروع ارتداء القفازات": يصاغ «مشروع حزمة أمان ومأمونية مسار الفرز السريري والتقييم الأولي واكتمال العلامات الحيوية بالطوارئ (Emergency Clinical Triage Bundle)»، ليعالج معاً غياب الواقيات الشخصية، وإهمال توثيق العلامات الحيوية، ونقص بيانات الوصفة الطبية.
     * بدلاً من "مشروع كروت الكراش": يصاغ «مشروع الحوكمة الشاملة لجاهزية عربات الطوارئ وسرعة الإنعاش القلبي الرئوي (Resuscitation Readiness Bundle)»، ليعالج القوائم ومحاضر الفتح وتحديث الأدوية والتنسيق مع الصيدلية.

2. عتبة الأثر السريري العالي (High Clinical Impact Threshold):
   - يجب أن تستهدف المشاريع القضايا الحيوية التي تمنع الوفيات والأحداث الجسيمة (Sentinel Events) والعدوى المتقاطعة والأخطاء الدوائية الحرجة وفق معايير GAHAR وأهداف سلامة المرضى الدولية (IPSGs).

3. مؤشرات النتيجة الحقيقية (Clinical Outcome KPIs):
   - يجب أن يقيس مؤشر النتيجة (Outcome KPI) أثراً سريرياً أو تشغيلياً جوهرياً (مثل خفض معدل العدوى المكتسبة، خفض زمن بدء علاج الإنعاش إلى أقل من 5 دقائق، تصفير أخطاء التوافق الدوائي، رفع اكتمال الفرز السريري لـ 95%).

أخرج النتيجة بصيغة JSON فقط.`

    const userPrompt = `بيانات أداء المستشفى:
- اسم المستشفى: ${hospital.name}
- عدد تقارير المرور الأخيرة: ${reports?.length || 0} (بتواريخ: ${inspectionDates})
- إجمالي السلبيات المرصودة: ${totalFindingsCount}
- السلبيات المفتوحة قيد الإجراء: ${openFindingsCount}
- السلبيات المتكررة المؤهلة: ${recurringCount}
${focusDepartment ? `- القسم المطلوب التركيز عليه: ${focusDepartment}` : ''}

قائمة حزم المسارات الإكلينيكية والتشغيلية الكبرى المرشحة لمصفوفة الأولويات:
${candidateBundlesText}

المطلوب:
طبّق مصفوفة الأولويات المعتمدة لاختيار بالضبط عدد (${count}) حزم إكلينيكية/تشغيلية كبرى مختلفة من القائمة أعلاه (يجب أن يحتوي حقل "projects" على مصفوفة بها بالضبط ${count} عناصر لمشاريع مختلفة)، وصِغ لكل حزمة "ميثاق مشروع تحسين جودة متكامل ومبني على الدليل العلمي وحزم التدابير (Care Bundles)".

متطلبات كل مشروع:
1. عنوان المشروع (Title): اسم عربي رصين ومعبر لحزمة التدابير أو المسار الاستراتيجي المعالج (مع إمكانية ذكر المصطلح الإنجليزي بين قوسين).
2. مبررات الاختيار وتقييم مصفوفة الأولويات (Prioritization Matrix Scoring):
   - درجة الخطورة السريرية (patient_safety_risk) من 1 إلى 5
   - حجم وتكرار المشكلة (volume_frequency) من 1 إلى 5
   - تعقيد المسار والحاجة لتغيير سلوكي (process_complexity) من 1 إلى 5
   - التوافق الاستراتيجي مع معايير GAHAR (strategic_alignment) من 1 إلى 5
   - مبرر الأهلية (eligibility_justification): شرح موجز لماذا يستحق هذا المسار فتح مشروع تحسين كامل.
3. بيان المشكلة (Problem Statement): يشرح الخلل النظامي في هذا المسار والسلبيات المرتبطة به ومخاطره وخط الأساس.
4. الهدف الذكي (SMART Goal): محدد كمياً وزمنياً لمعالجة حزمة التدابير ورفع الامتثال إلى 95% أو خفض المخاطر.
5. المرجع العلمي (Evidence Reference): معيار GAHAR المباشر المعني وتوصية WHO ذات الصلة.
6. مؤشرات الأداء (KPIs): مؤشر عملية ومؤشر نتيجة إكلينيكي حقيقي مخصصان لهذه الحزمة.
7. خطة التدخلات (FOCUS-PDCA): خطوات لمعالجة الأسباب الجذرية للمسار (تدريب، سياسات، نماذج، تدقيق).
8. السلبيات المرتبطة (linked_findings_summary): قائمة نصوص السلبيات المرصودة المترابطة التي تعالجها هذه الحزمة.

الصيغة المطلوبة (JSON فقط - مصفوفة projects تحتوي على ${count} مشروع):
{
  "projects": [
    {
      "title": "عنوان حزمة التدابير أو المسار الإكلينيكي الشامل",
      "department_name": "القسم المعني",
      "category": "سلامة المرضى / إدارة واستخدام الدواء / مكافحة العدوى والتعقيم / الرعاية الحرجة والطوارئ / الملف الطبي والتوثيق / إدارة السلامة والمرافق (FMS)",
      "priority": "high",
      "prioritization_matrix": {
        "patient_safety_risk": 5,
        "volume_frequency": 4,
        "process_complexity": 5,
        "strategic_alignment": 5,
        "total_score": 19,
        "eligibility_justification": "مسار إكلينيكي معقد عالي الخطورة يتطلب حزمة تدابير وتغييراً سلوكياً وتدريباً مستمراً."
      },
      "problem_statement": "بيان المشكلة وتحليل الخلل في المسار وربطه بالسلبيات المرصودة",
      "baseline_metrics": "أرقام ونسب خط الأساس قبل التحسين",
      "smart_goal": "الهدف الذكي القابل للقياس وموعد الإنجاز المستهدف",
      "evidence_reference": "الدليل الإرشادي ومعيار GAHAR المعني بالمشكلة",
      "target_duration_weeks": 12,
      "kpis": [
        { "name": "مؤشر العملية للالتزام بحزمة التدابير", "type": "process", "baseline": "20%", "target": "95%", "frequency": "شهري" },
        { "name": "مؤشر النتيجة السريرية/التشغيلية", "type": "outcome", "baseline": "معدل الحوادث أو العدوى الحالي", "target": "الهدف المنشود", "frequency": "شهري" }
      ],
      "interventions": [
        { "step": "خطوة التدخل الإجرائي لعلاج السبب الجذري", "responsible": "المسؤول عن التنفيذ", "duration": "أسبوعين" }
      ],
      "project_lead": "المسؤول المقترح عن قيادة المشروع بالمستشفى",
      "team_members": ["عضو 1", "عضو 2", "عضو 3"],
      "linked_findings_summary": ["نص السلبية 1", "نص السلبية 2"]
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
