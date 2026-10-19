import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function testGroqQIP() {
  const { data: hosp } = await supabase.from('hospitals').select('*').ilike('name', '%كفر الشيخ العام%').single();
  const { data: findings } = await supabase.from('v_report_findings')
    .select('id, department_id, original_text, priority, status, repeat_count, departments(name)')
    .eq('hospital_id', hosp.id)
    .limit(50);

  const findingsText = findings.map((f, i) => `${i+1}. [${f.departments?.name || 'عام'}] (أولوية: ${f.priority}, تكرار: ${f.repeat_count}) ${f.original_text}`).join('\n');

  const prompt = `أنت خبير واستشاري أول في إدارة وتوكيد جودة الرعاية الصحية واعتماد المنشآت الصحية (خبير معايير GAHAR و CBAHI و IHI).
المطلوب: فحص تقارير المرور والسلبيات ومؤشرات الأداء لمستشفى: ${hosp.name}.
السلبيات المرصودة:
${findingsText}

قم باقتراح مشروعين تحسين جودة (Quality Improvement Projects - QIPs) مبنية على الأدلة والبراهين ومبنية على تحليل الأداء والسلبيات المرصودة أعلاه.
يجب أن يكون كل مشروع متوافقاً مع منهجية FOCUS-PDCA ومعايير GAHAR.

أرجع النتيجة بصيغة JSON فقط بهذا الشكل:
{
  "projects": [
    {
      "title": "عنوان المشروع",
      "department_name": "القسم المعني",
      "category": "سلامة المرضى / إدارة الدواء / مكافحة العدوى...",
      "priority": "high",
      "problem_statement": "بيان المشكلة وتحليل الأسباب الجذرية من واقع السلبيات",
      "baseline_metrics": "أرقام الأداء الحالي ومعدل السلبيات",
      "smart_goal": "الهدف الذكي القابل للقياس",
      "evidence_reference": "الدليل العلمي ومعيار GAHAR المعني",
      "target_duration_weeks": 12,
      "kpis": [
        { "name": "اسم المؤشر", "type": "process", "baseline": "40%", "target": "95%", "frequency": "شهري" }
      ],
      "interventions": [
        { "step": "خطوة التدخل الإجرائي", "responsible": "المسؤول", "duration": "أسبوعين" }
      ],
      "project_lead": "المسؤول المقترح",
      "team_members": ["عضو 1", "عضو 2"],
      "linked_findings_summary": ["سلبية 1", "سلبية 2"]
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
        { role: 'system', content: 'You are an expert healthcare quality consultant. Output JSON only.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2
    })
  });

  const json = await res.json();
  console.log('Result:', json.choices?.[0]?.message?.content);
}

testGroqQIP();
