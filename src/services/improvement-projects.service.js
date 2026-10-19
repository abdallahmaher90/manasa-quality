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

    // 4. Extract and rank individual candidate problems (Prioritize Recurring & High-Impact)
    const recurringFindings = findings.filter(f => f.repeat_count >= 2 || f.status === 'recurring')
    const highPriorityFindings = findings.filter(f => f.priority === 'high' && !recurringFindings.some(rf => rf.id === f.id))
    const otherFindings = findings.filter(f => !recurringFindings.some(rf => rf.id === f.id) && !highPriorityFindings.some(hf => hf.id === f.id))

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
        type: 'سلبية متكررة (ضعف امتثال مستمر)',
        dept: f.departments?.name || 'عام',
        text: f.original_text,
        repeats: f.repeat_count || 2,
        priority: 'high'
      })
    })

    // Add high-priority critical failures
    targetHigh.slice(0, 15).forEach(f => {
      candidateList.push({
        type: 'سلبية حرجة عالية الخطورة (Safety Risk)',
        dept: f.departments?.name || 'عام',
        text: f.original_text,
        repeats: 1,
        priority: 'high'
      })
    })

    // Add other notable findings if pool is small
    if (candidateList.length < 5) {
      targetOther.slice(0, 5).forEach(f => {
        candidateList.push({
          type: 'ملاحظة تشغيلية',
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

    // AI Prompt - Strictly enforcing Single-Core-Issue Focus
    const systemPrompt = `أنت استشاري أول وخبير توكيد جودة واعتماد مستشفيات (Fellow of IHI, GAHAR Quality Surveyor).
مهمتك إعداد مشاريع تحسين جودة (Quality Improvement Projects - QIPs) نموذجية مبنية على الأداء الفعلي والدليل العلمي ومنهجية FOCUS-PDCA ومعايير GAHAR الوطنية.

قاعدة ذهبية صارمة في إدارة الجودة (The Single-Problem Focus Principle):
- كل مشروع تحسين يجب أن يركز تماماً وبشكل حصري على "مشكلة كبرى واحدة محددة" أو "سلبية متكررة حرجة واحدة" (Single Core Problem).
- يُمنع منعاً باتاً دمج سلبيات مختلفة أو غير متجانسة في مشروع واحد لمجرد أنها وقعت في نفس القسم (مثال خاطئ: مشروع يجمع بين ارتداء القفازات وتوقيع الطبيب وتوثيق التذاكر - هذا تشتيت عشوائي وفشل منهجي).
- مثال صحيح: "مشروع تطبيق وتفعيل سياسة التوافق الدوائي (Medication Reconciliation) لمنع الأخطاء الدوائية عند الدخول والخروج" - يركز حصرياً على مشكلة التوافق الدوائي.
- مثال صحيح: "مشروع منع ومكافحة استخدام الاختصارات الطبية الخطرة والممنوعة (Dangerous Abbreviations) في أقسام الرعاية المركزة".
- مثال صحيح: "مشروع مأمونية نقل وتسليم العينات المخبرية وسلسلة العهدة (Specimen Transport & Chain of Custody) بالمعمل".
- عنوان المشروع والهدف الذكي (SMART Goal) ومؤشرات الأداء (KPIs) وخطة التدخلات (Interventions) يجب أن تكون مخصصة 100% لعلاج الأسباب الجذرية لهذه المشكلة الواحدة دون تشتيت.
أخرج النتيجة بصيغة JSON فقط.`

    const userPrompt = `بيانات أداء المستشفى:
- اسم المستشفى: ${hospital.name}
- عدد تقارير المرور الأخيرة: ${reports?.length || 0} (بتواريخ: ${inspectionDates})
- إجمالي السلبيات المرصودة: ${totalFindingsCount}
- السلبيات المفتوحة قيد الإجراء: ${openFindingsCount}
- السلبيات المتكررة: ${recurringCount}
${focusDepartment ? `- القسم المطلوب التركيز عليه: ${focusDepartment}` : ''}

قائمة المشاكل والسلبيات الحرجة والمتكررة المرشحة للتحسين:
${candidateProblemsText}

المطلوب:
اختر من القائمة أعلاه أهم ${count} مشاكل محورية مختلفة (أولوية للسلبيات المتكررة ثم عالية الخطورة)، وصِغ لكل مشكلة منفصلة "مشروع تحسين جودة مستقل ومكتمل الأركان" (QIP).

متطلبات كل مشروع (مشكلة واحدة فقط لكل مشروع):
1. عنوان المشروع (Title): اسم واضح ومحدد يعكس المشكلة المعالجة والحل المستهدف.
2. بيان المشكلة (Problem Statement): يركز فقط على هذه المشكلة المحددة، تكرارها في تقارير المرور، خطورتها الإكلينيكية، وأرقام خط الأساس (Baseline).
3. الهدف الذكي (SMART Goal): هدف كمي محدد وزمني لاستئصال هذه المشكلة ورفع الامتثال إلى 95% أو تصفير تكرارها.
4. المرجع العلمي (Evidence): معيار GAHAR المباشر وتوصية WHO ذات الصلة بهذه المشكلة.
5. مؤشرات الأداء (KPIs): مؤشر عملية ومؤشر نتيجة يخصان هذه المشكلة الواحدة فقط.
6. خطة التدخلات (FOCUS-PDCA): 3-5 خطوات تنفيذية لمعالجة الأسباب الجذرية للمشكلة.
7. السلبيات المرتبطة (linked_findings_summary): تذكر نص السلبية الواحدة المحددة المستهدفة فقط.

الصيغة المطلوبة (JSON فقط):
{
  "projects": [
    {
      "title": "عنوان محدد لمشروع يعالج مشكلة واحدة فقط",
      "department_name": "القسم المعني",
      "category": "سلامة المرضى / إدارة واستخدام الدواء / مكافحة العدوى والتعقيم / الرعاية الحرجة والطوارئ / الملف الطبي والتوثيق / إدارة السلامة والمرافق (FMS)",
      "priority": "high",
      "problem_statement": "بيان المشكلة وتحليل الأداء الفعلي الخاص بها بالأرقام والمخاطر",
      "baseline_metrics": "الأرقام والنسب المرجعية الحالية لهذه المشكلة قبل التحسين",
      "smart_goal": "الهدف الذكي القابل للقياس وموعد الإنجاز المستهدف",
      "evidence_reference": "الدليل الإرشادي ومعيار GAHAR المعني بالمشكلة",
      "target_duration_weeks": 12,
      "kpis": [
        { "name": "مؤشر العملية للالتزام بالخطوات", "type": "process", "baseline": "0%", "target": "95%", "frequency": "شهري" },
        { "name": "مؤشر النتيجة (Outcome)", "type": "outcome", "baseline": "تكرار السلبية مرتين", "target": "صفر", "frequency": "شهري" }
      ],
      "interventions": [
        { "step": "خطوة التدخل الإجرائي لعلاج السبب الجذري", "responsible": "المسؤول عن التنفيذ", "duration": "أسبوعين" }
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
        directorate_notes: 'مشروع مقترح مبني على تحليل تقارير المرور والسلبيات ومؤشرات الأداء الفعلية للمستشفى.'
      }

      const saved = await this.saveProject(projectRecord)
      savedProjects.push(saved)
    }

    return savedProjects
  }
}
