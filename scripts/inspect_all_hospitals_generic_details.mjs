import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectAll() {
  const { data: hospitals } = await supabase.from('hospitals').select('id, name');
  const { data: depts } = await supabase.from('departments').select('id, hospital_id, name');
  const { data: rFindings } = await supabase.from('report_findings')
    .select('id, hospital_id, department_id, original_text, hospital_resolution_note, status, report_id');
  const { data: reports } = await supabase.from('reports').select('id, file_name');

  const hospMap = Object.fromEntries(hospitals.map(h => [h.id, h.name]));
  const repMap = Object.fromEntries(reports.map(r => [r.id, r.file_name]));

  const genericDeptNames = ['عام', 'عموم المستشفى', 'قسم عام'];
  const genericDepts = depts.filter(d => genericDeptNames.includes(d.name.trim()));

  for (const d of genericDepts) {
    const list = rFindings.filter(f => f.department_id === d.id);
    if (list.length === 0) continue;
    const hName = hospMap[d.hospital_id] || 'Unknown';
    console.log(`\n======================================================`);
    console.log(`HOSPITAL: ${hName} | DEPT: ${d.name} (${list.length} in report_findings)`);
    console.log(`======================================================`);
    list.forEach((f, idx) => {
      const resp = f.hospital_resolution_note ? `[RESPONSE: ${f.hospital_resolution_note.substring(0, 35)}...]` : '[NO RESPONSE]';
      const fn = repMap[f.report_id] || 'unknown';
      console.log(`${idx + 1}. [${fn}] ${f.original_text.substring(0, 75)} | ${resp}`);
    });
  }
}

inspectAll();
