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

    // 4. Extract and rank candidate problems using GAHAR Prioritization Criteria
    // Filter out trivial one-step physical maintenance or procurement fixes (Just-Do-It tasks)
    const isTrivialTask = (text) => {
      const lower = (text || '').toLowerCase()
      const trivialTerms = [
        'جرس استدعاء', 'جرس التمريض لا يعمل', 'لا يوجد ترمومتر غرفة',
        'لمبة مكسورة', 'البوابة مكسورة', 'كالون مكسور', 'تسريب صنبور',
        'كرسي مكسور', 'مفتاح كهرباء', 'دهان الحائط', 'تربيزة مكسورة'
      ]
      return trivialTerms.some(term => lower.includes(term))
    }

    const eligibleFindings = findings.filter(f => !isTrivialTask(f.original_text))

    const recurringFindings = eligibleFindings.filter(f => f.repeat_count >= 2 || f.status === 'recurring')
    const highPriorityFindings = eligibleFindings.filter(f => f.priority === 'high' && !recurringFindings.some(rf => rf.id === f.id))
    const otherFindings = eligibleFindings.filter(f => !recurringFindings.some(rf => rf.id === f.id) && !highPriorityFindings.some(hf => hf.id === f.id))

    // Filter by department if requested
    let targetRecurring = recurringFindings
    let targetHigh = highPriorityFindings
    let targetOther = otherFindings

    if (focusDepartment) {
      const matchDept = (d) => (d || '').toLowerCase().includes(focusDepartment.toLowerCase())
      targetRecurring = recurringFindings.filter(f => matchDept(f.departments?.name))
      targetHigh = highPriorityFindings.filter(f => matchDept(f.departments?.name))
      targetOther = otherFindings.filter(f => matchDept(f.departments?.name))
    }

    // Prepare prioritized candidate problems list
    const candidateList = []
    
    // Add recurring problems first
    targetRecurring.forEach(f => {
      candidateList.push({
        type: 'سلبية متكررة معقدة (ضعف امتثال مستمر في مسار إكلينيكي)',
        dept: f.departments?.name || 'عام',
        text: f.original_text,
        repeats: f.repeat_count || 2,
        priority: 'high'
      })
    })

    // Add high-priority critical failures
    targetHigh.slice(0, 15).forEach(f => {
      candidateList.push({
        type: 'سلبية حرجة عالية الخطورة السريرية (High Clinical Risk)',
        dept: f.departments?.name || 'عام',
        text: f.original_text,
        repeats: 1,
        priority: 'high'
      })
    })

    // Add other notable clinical findings if pool is small
    if (candidateList.length < 5) {
      targetOther.slice(0, 5).forEach(f => {
        candidateList.push({
          type: 'ملاحظة سريرية تنظيمية',
          dept: f.departments?.name || 'عام',
          text: f.original_text,
          repeats: 1,
          priority: f.priority || 'medium'
        })
      })
    }

    const inspectionDates = reports?.map(r => r.inspection_date).filter(Boolean).slice(0, 5).join(' و ') || 'زيارات متعددة'
    const totalFindingsCount = findings.length
    const openFindingsCount = findings.filter(f => ['open', 'recurring'].includes(f.status)).length
    const recurringCount = recurringFindings.length

    const candidateProblemsText = candidateList.map((c, idx) => {
      return `${idx + 1}. [${c.dept}] (${c.type}): "${c.text}"`
    }).join('\n')

    // AI Prompt - Strictly enforcing GAHAR QIP Selection & Prioritization Methodology
    const systemPrompt = `أنت استشاري أول وخبير توكيد جودة واعتماد مستشفيات ومراجع معتمد (GAHAR Senior Quality Surveyor & Fellow of IHI).
مهمتك تقييم واختيار وتصميم مشاريع تحسين جودة استراتيجية (Quality Improvement Projects - QIPs) مبنية على الدليل العلمي ومنهجية FOCUS-PDCA ومعايير GAHAR الوطنية.

قواعد صارمة لاختيار مشروع التحسين (QIP Selection & Eligibility Rules):
1. التمييز الحاسم بين "مشروع التحسين QIP" وبين "مهام الصيانة والإصلاح الفوري Just-Do-It / Quick Fix":
   - لا يجوز أبداً فتح مشروع تحسين لمهمة صيانة روتينية أو شراء جهاز مفرد (مثل إصلاح جرس تمريض، تركيب كالون، شراء ترمومتر وتعليقه، دهان حائط). هذه مهام صيانة فورية وليست مشاريع جودة.
   - مشروع التحسين يجب أن يستهدف "مساراً إكلينيكياً أو تشغيلياً معقداً" (Complex Clinical Process) يتطلب تحليلاً للأسباب الجذرية (Root Cause Analysis)، وتغييراً في سلوك وممارسات الفرق الطبية والتمريضية، وتطبيق حزم تدابير علاجية وتدريب وسياسات ومتابعة مؤشرات على مدار أسابيع.

2. معايير الأولوية الخمسة المعتمدة دولياً للاختيار (GAHAR Prioritization Matrix):
   - High Risk: عالية الخطورة على حياة المرضى ومسببة للأحداث الجسيمة (مثل أمان الدواء، التعقيم، الإنعاش، بنك الدم).
   - High Volume: عالية الحجم والتكرار وتؤثر على شريحة واسعة من المرضى يومياً (مثل فرز الطوارئ، التوثيق الطبي).
   - Problem-Prone: مسار معقد عرضة للتباين والخطأ البشري (مثل التوافق الدوائي، التسليم والتسلم Handover).
   - Strategic & GAHAR Mandate: توافق مباشر مع الأهداف الوطنية لسلامة المرضى (NPSGs).

3. تركيز المشكلة الواحدة (Single Core Problem Focus):
   - كل مشروع تحسين يجب أن يركز 100% وبشكل حصري على مشكلة كبرى واحدة محددة الأبعاد (ممنوع خلط سلبيات متعددة في مشروع واحد).
أخرج النتيجة بصيغة JSON فقط.`

    const userPrompt = `بيانات أداء المستشفى:
- اسم المستشفى: ${hospital.name}
- عدد تقارير المرور الأخيرة: ${reports?.length || 0} (بتواريخ: ${inspectionDates})
- إجمالي السلبيات المرصودة: ${totalFindingsCount}
- السلبيات المفتوحة قيد الإجراء: ${openFindingsCount}
- السلبيات المتكررة المؤهلة: ${recurringCount}
${focusDepartment ? `- القسم المطلوب التركيز عليه: ${focusDepartment}` : ''}

قائمة المشاكل والسلبيات السريرية والتنظيمية المرشحة لمصفوفة الأولويات:
${candidateProblemsText}

المطلوب:
طبّق مصفوفة الأولويات المعتمدة لاختيار أهم ${count} مشاكل كبرى حقيقية تستحق فتح مشروع تحسين جودة كامل (استبعد أي مهام صيانة أو تصليح فوري)، وصِغ لكل مشكلة "ميثاق مشروع تحسين جودة متكامل ومبني على الدليل العلمي".

متطلبات كل مشروع:
1. عنوان المشروع (Title): اسم واضح ومحدد يعكس المشكلة والحل المستهدف بدقة.
2. مبررات الاختيار وتقييم مصفوفة الأولويات (Prioritization Matrix Scoring):
   - درجة الخطورة السريرية (patient_safety_risk) من 1 إلى 5
   - حجم وتكرار المشكلة (volume_frequency) من 1 إلى 5
   - تعقيد المسار والحاجة لتغيير سلوكي (process_complexity) من 1 إلى 5
   - التوافق الاستراتيجي مع معايير GAHAR (strategic_alignment) من 1 إلى 5
   - مبرر الأهلية (eligibility_justification): شرح موجز لماذا تستحق هذه القضية فتح مشروع تحسين كامل.
3. بيان المشكلة (Problem Statement): يركز حصرياً على هذه القضية، مسبباتها، وتكرارها، وخطورتها، وخط الأساس (Baseline).
4. الهدف الذكي (SMART Goal): محدد كمياً وزمنياً لمعالجة المشكلة ورفع الامتثال إلى 95% أو تصفير تكرارها.
5. المرجع العلمي (Evidence Reference): معيار GAHAR المباشر المعني وتوصية WHO ذات الصلة.
6. مؤشرات الأداء (KPIs): مؤشر عملية ومؤشر نتيجة مخصصان لهذه المشكلة الواحدة.
7. خطة التدخلات (FOCUS-PDCA): خطوات لمعالجة الأسباب الجذرية للمشكلة.
8. السلبيات المرتبطة (linked_findings_summary): تذكر نص السلبية الواحدة المحددة المستهدفة فقط.

الصيغة المطلوبة (JSON فقط):
{
  "projects": [
    {
      "title": "عنوان محدد لمشروع يعالج قضية سريرية/تشغيلية محورية",
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
      "problem_statement": "بيان المشكلة وتحليل الأداء الفعلي بالأرقام والمخاطر",
      "baseline_metrics": "أرقام ونسب خط الأساس قبل التحسين",
      "smart_goal": "الهدف الذكي القابل للقياس وموعد الإنجاز المستهدف",
      "evidence_reference": "الدليل الإرشادي ومعيار GAHAR المعني بالمشكلة",
      "target_duration_weeks": 12,
      "kpis": [
        { "name": "مؤشر العملية للالتزام بالبروتوكول", "type": "process", "baseline": "20%", "target": "95%", "frequency": "شهري" },
        { "name": "مؤشر النتيجة السريرية/التشغيلية", "type": "outcome", "baseline": "حوادث متكررة", "target": "صفر", "frequency": "شهري" }
      ],
      "interventions": [
        { "step": "خطوة التدخل الإجرائي لمعالجة السبب الجذري", "responsible": "المسؤول عن التنفيذ", "duration": "أسبوعين" }
      ],
      "project_lead": "المسؤول المقترح عن قيادة المشروع بالمستشفى",
      "team_members": ["عضو 1", "عضو 2", "عضو 3"],
      "linked_findings_summary": ["نص المشكلة أو السلبية الواحدة المحددة"]
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
        temperature: 0.15
      })
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Groq AI Error (${res.status}): ${errText}`)
    }

    const aiResponse = await res.json()
    const content = aiResponse.choices?.[0]?.message?.content || '{}'
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
        title: p.title,
        department_name: p.department_name,
        category: p.category || 'سلامة المرضى',
        priority: p.priority || 'high',
        status: 'draft',
        problem_statement: p.problem_statement,
        baseline_metrics: p.baseline_metrics,
        smart_goal: p.smart_goal,
        evidence_reference: p.evidence_reference,
        target_completion_date: targetDate.toISOString().split('T')[0],
        kpis: p.kpis || [],
        interventions: p.interventions || [],
        project_lead: p.project_lead || hospital.quality_head_name || 'فريق الجودة بالمستشفى',
        team_members: p.team_members || [],
        estimated_duration_weeks: p.target_duration_weeks || 12,
        linked_findings_summary: p.linked_findings_summary || [],
        prioritization_matrix: p.prioritization_matrix || null,
        directorate_notes: 'مشروع مقترح مبني على تحليل تقارير المرور وتطبيق مصفوفة أولويات GAHAR.'
      }

      const saved = await this.saveProject(projectRecord)
      savedProjects.push(saved)
    }

    return savedProjects
  }
}
