import { createServiceClient } from '@/lib/supabase'
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

    // 4. Group Findings by Department
    const deptStats = {}
    findings.forEach(f => {
      const dName = f.departments?.name || 'عموم المستشفى'
      if (!deptStats[dName]) {
        deptStats[dName] = { total: 0, open: 0, recurring: 0, high: 0, samples: [] }
      }
      deptStats[dName].total++
      if (['open', 'recurring'].includes(f.status)) deptStats[dName].open++
      if (f.repeat_count >= 2 || f.status === 'recurring') deptStats[dName].recurring++
      if (f.priority === 'high') deptStats[dName].high++
      if (deptStats[dName].samples.length < 8) deptStats[dName].samples.push(f.original_text)
    })

    const topDepts = Object.entries(deptStats)
      .sort((a, b) => (b[1].recurring * 3 + b[1].open * 2 + b[1].high * 2) - (a[1].recurring * 3 + a[1].open * 2 + a[1].high * 2))
      .slice(0, 8)

    // Format findings summary for AI
    const inspectionDates = reports?.map(r => r.inspection_date).filter(Boolean).slice(0, 5).join(' و ') || 'زيارات متعددة'
    const totalFindingsCount = findings.length
    const openFindingsCount = findings.filter(f => ['open', 'recurring'].includes(f.status)).length
    const recurringCount = findings.filter(f => f.repeat_count >= 2 || f.status === 'recurring').length

    let deptSummaryText = topDepts.map(([name, s]) => {
      return `* قسم [${name}]: إجمالي السلبيات ${s.total} (المفتوحة: ${s.open}، المتكررة: ${s.recurring}، عالية الأولوية: ${s.high})
  أبرز السلبيات المرصودة في التقارير:
  - ${s.samples.slice(0, 4).join('\n  - ')}`
    }).join('\n\n')

    // AI Prompt
    const systemPrompt = `أنت خبير واستشاري أول في إدارة وتوكيد جودة الرعاية الصحية واعتماد المستشفيات (Fellow of IHI, GAHAR & CBAHI Quality Surveyor).
مهمتك إعداد مشاريع تحسين جودة (Quality Improvement Projects - QIPs) واقعية، مبنية على الدليل العلمي ومبنية على تحليل الأداء الفعلي المستخرج من تقارير المرور الرسمية.
يجب أن ترتكز المشاريع على معايير الجودة والاعتماد المصرية (GAHAR) وحلول منظمة الصحة العالمية لسلامة المرضى (WHO Patient Safety Solutions) ومنهجية FOCUS-PDCA.
أخرج النتيجة بصيغة JSON فقط.`

    const userPrompt = `بيانات أداء المستشفى:
- اسم المستشفى: ${hospital.name}
- عدد تقارير المرور الأخيرة: ${reports?.length || 0} (بتواريخ: ${inspectionDates})
- إجمالي السلبيات المرصودة: ${totalFindingsCount}
- السلبيات المفتوحة قيد الإجراء: ${openFindingsCount}
- السلبيات المتكررة (ضعف الامتثال): ${recurringCount}
${focusDepartment ? `- القسم المطلوب التركيز عليه بصفة خاصة: ${focusDepartment}` : ''}

تحليل تركز السلبيات في الأقسام والعيوب التشغيلية:
${deptSummaryText}

المطلوب:
صياغة عدد ${count} مشاريع تحسين جودة رئيسية استراتيجية (QIPs) تعالج أكثر المشاكل الجذرية إلحاحاً بالمستشفى.

شروط كل مشروع:
1. أن يستند تماماً إلى السلبيات الفعلية المذكورة أعلاه.
2. صياغة مبررات المشروع وبيان المشكلة (Problem Statement) متضمناً أرقام الأداء الحالية (Baseline).
3. وضع هدف ذكي قابل للقياس ومحدد زمنياً (SMART Goal).
4. تحديد المرجع العلمي ومعايير الاعتماد المعنية (GAHAR Standard / WHO).
5. وضع مؤشرات أداء (KPIs) لقياس نجاح المشروع (مؤشر عملية ومؤشر نتيجة).
6. وضع خطة تدخلات إجرائية (FOCUS-PDCA Interventions) بخطوات تنفيذية ومسؤول ومدى زمني.

الصيغة المطلوبة (JSON فقط):
{
  "projects": [
    {
      "title": "عنوان مشروع التحسين (واضح ودقيق)",
      "department_name": "القسم أو الأقسام المعنية",
      "category": "سلامة المرضى / إدارة الدواء / مكافحة العدوى / الرعاية الحرجة / السلامة وإدارة المرافق",
      "priority": "high",
      "problem_statement": "بيان المشكلة وتحليل الأداء الفعلي بالأرقام",
      "baseline_metrics": "الأرقام والنسب المرجعية الحالية قبل التحسين",
      "smart_goal": "الهدف الذكي القابل للقياس وموعد الإنجاز المستهدف",
      "evidence_reference": "الدليل الإرشادي ومعيار GAHAR المعني",
      "target_duration_weeks": 12,
      "kpis": [
        { "name": "اسم المؤشر", "type": "process", "baseline": "35%", "target": "95%", "frequency": "شهري" },
        { "name": "مؤشر النتيجة", "type": "outcome", "baseline": "3 حوادث/شهر", "target": "صفر", "frequency": "شهري" }
      ],
      "interventions": [
        { "step": "خطوة التدخل الإجرائي", "responsible": "المسؤول عن التنفيذ", "duration": "أسبوعين" }
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
