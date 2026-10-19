import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function seedInitialQIPs() {
  const { data: hosp } = await supabase.from('hospitals').select('*').ilike('name', '%كفر الشيخ العام%').single();
  console.log('Generating for:', hosp.name);

  const { data: findings } = await supabase
    .from('v_report_findings')
    .select('id, department_id, original_text, priority, status, repeat_count, departments(name)')
    .eq('hospital_id', hosp.id);

  const findingsSample = findings.slice(0, 40).map((f, i) => `${i+1}. [${f.departments?.name || 'عام'}] ${f.original_text}`).join('\n');

  const systemPrompt = `أنت خبير واستشاري أول في إدارة وتوكيد جودة الرعاية الصحية واعتماد المستشفيات (Fellow of IHI, GAHAR & CBAHI Quality Surveyor).
مهمتك إعداد مشاريع تحسين جودة (Quality Improvement Projects - QIPs) واقعية، مبنية على الدليل العلمي ومبنية على تحليل الأداء الفعلي المستخرج من تقارير المرور الرسمية.
يجب أن ترتكز المشاريع على معايير الجودة والاعتماد المصرية (GAHAR) وحلول منظمة الصحة العالمية لسلامة المرضى (WHO Patient Safety Solutions) ومنهجية FOCUS-PDCA.
أخرج النتيجة بصيغة JSON فقط.`;

  const userPrompt = `بيانات أداء المستشفى:
- اسم المستشفى: ${hosp.name}
- إجمالي السلبيات المرصودة: ${findings.length}
- السلبيات المفتوحة: ${findings.filter(f => ['open', 'recurring'].includes(f.status)).length}

عينة من السلبيات المرصودة في تقارير المرور:
${findingsSample}

المطلوب:
صياغة عدد 3 مشاريع تحسين جودة رئيسية استراتيجية (QIPs) تعالج أكثر المشاكل الجذرية إلحاحاً بالمستشفى في:
1. السلامة الدوائية والأقسام الحرجة (الصيدلية، العناية المركزة)
2. مكافحة العدوى والبيئة الاستشفائية والسلامة المهنية (التعقيم، المطبخ، النفايات)
3. التوثيق الطبي والملف السريري وإدارة النتائج الحرجة (المعمل، التذاكر الطبية)

الصيغة المطلوبة (JSON فقط):
{
  "projects": [
    {
      "title": "عنوان مشروع التحسين",
      "department_name": "القسم المعني",
      "category": "سلامة المرضى / إدارة الدواء / مكافحة العدوى...",
      "priority": "high",
      "problem_statement": "بيان المشكلة وتحليل الأداء الفعلي بالأرقام",
      "baseline_metrics": "الأرقام والنسب المرجعية الحالية قبل التحسين",
      "smart_goal": "الهدف الذكي القابل للقياس",
      "evidence_reference": "الدليل العلمي ومعيار GAHAR المعني",
      "target_duration_weeks": 12,
      "kpis": [
        { "name": "اسم المؤشر", "type": "process", "baseline": "40%", "target": "95%", "frequency": "شهري" }
      ],
      "interventions": [
        { "step": "خطوة التدخل الإجرائي", "responsible": "المسؤول عن التنفيذ", "duration": "أسبوعين" }
      ],
      "project_lead": "المسؤول المقترح عن قيادة المشروع بالمستشفى",
      "team_members": ["عضو 1", "عضو 2", "عضو 3"],
      "linked_findings_summary": ["نص السلبية 1", "نص السلبية 2"]
    }
  ]
}`;

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
  });

  const aiResponse = await res.json();
  const parsed = JSON.parse(aiResponse.choices?.[0]?.message?.content || '{}');
  const list = parsed.projects || [];
  console.log('AI Generated count:', list.length);

  for (const p of list) {
    const id = crypto.randomUUID();
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + ((p.target_duration_weeks || 12) * 7));

    const record = {
      id,
      hospital_id: hosp.id,
      hospital_name: hosp.name,
      title: p.title,
      department_name: p.department_name,
      category: p.category || 'سلامة المرضى',
      priority: p.priority || 'high',
      status: 'approved', // Pre-approve these as exemplary projects
      problem_statement: p.problem_statement,
      baseline_metrics: p.baseline_metrics,
      smart_goal: p.smart_goal,
      evidence_reference: p.evidence_reference,
      target_completion_date: targetDate.toISOString().split('T')[0],
      kpis: p.kpis || [],
      interventions: p.interventions || [],
      project_lead: p.project_lead || hosp.quality_head_name || 'فريق الجودة بالمستشفى',
      team_members: p.team_members || [],
      estimated_duration_weeks: p.target_duration_weeks || 12,
      linked_findings_summary: p.linked_findings_summary || [],
      directorate_notes: 'مشروع معتمد من إدارة الجودة بالمديرية استناداً لمخرجات تحليل تقارير المرور الرسمية.',
      created_by: 'مديرية الشئون الصحية بكفر الشيخ',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await supabase.from('settings').upsert({
      key: `improvement_project:${id}`,
      value: JSON.stringify(record)
    }, { onConflict: 'key' });

    console.log(`Saved Project [${p.title}] (ID: ${id})`);
  }

  console.log('Done seeding initial QIPs.');
}

seedInitialQIPs();
