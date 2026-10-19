import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function testAnalysis() {
  const { data: hosp } = await supabase.from('hospitals').select('*').ilike('name', '%كفر الشيخ العام%').single();
  const { data: findings } = await supabase.from('v_report_findings')
    .select('id, department_id, original_text, priority, status, repeat_count, departments(name)')
    .eq('hospital_id', hosp.id);

  console.log(`Hospital: ${hosp.name} | Total findings: ${findings.length}`);

  // Summary by department
  const byDept = {};
  findings.forEach(f => {
    const dName = f.departments?.name || 'غير محدد';
    if (!byDept[dName]) byDept[dName] = { total: 0, open: 0, recurring: 0, high: 0, samples: [] };
    byDept[dName].total++;
    if (['open', 'recurring'].includes(f.status)) byDept[dName].open++;
    if (f.repeat_count >= 2 || f.status === 'recurring') byDept[dName].recurring++;
    if (f.priority === 'high') byDept[dName].high++;
    if (byDept[dName].samples.length < 5) byDept[dName].samples.push(f.original_text);
  });

  console.log('Top Problematic Departments:');
  const sortedDepts = Object.entries(byDept).sort((a, b) => b[1].total - a[1].total).slice(0, 6);
  for (const [name, stats] of sortedDepts) {
    console.log(`- ${name}: Total: ${stats.total}, Open: ${stats.open}, Recurring: ${stats.recurring}`);
    console.log(`  Samples: ${stats.samples.slice(0, 2).join(' | ')}`);
  }
}

testAnalysis();
