import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectAllDepartmentsAndFindings() {
  const { data: hospitals } = await supabase.from('hospitals').select('id, name');
  const { data: depts } = await supabase.from('departments').select('id, hospital_id, name');
  const { data: findings } = await supabase.from('findings')
    .select('id, hospital_id, department_id, original_text, hospital_resolution_note, status, report_id');
  const { data: reports } = await supabase.from('reports').select('id, file_name');

  const hospMap = Object.fromEntries(hospitals.map(h => [h.id, h.name]));
  const repMap = Object.fromEntries(reports.map(r => [r.id, r.file_name]));

  // Let's inspect findings in generic depts:
  const genericDeptNames = ['عام', 'عموم المستشفى', 'قسم عام'];
  const targets = depts.filter(d => genericDeptNames.includes(d.name.trim()));

  console.log('=== FINDINGS IN GENERIC DEPTS ===');
  for (const d of targets) {
    const fList = findings.filter(f => f.department_id === d.id);
    if (fList.length === 0) continue;
    const hName = hospMap[d.hospital_id] || 'Unknown';
    console.log(`\n========================================`);
    console.log(`HOSPITAL: ${hName} | DEPT: ${d.name} (${fList.length} findings)`);
    console.log(`========================================`);
    fList.forEach((f, idx) => {
      const fn = repMap[f.report_id] || 'unknown_file';
      const hasResp = f.hospital_resolution_note ? `[HAS RESPONSE: ${f.hospital_resolution_note.substring(0, 30)}...]` : '';
      console.log(`${idx + 1}. [${fn}] ${f.original_text.substring(0, 70)} ${hasResp}`);
    });
  }

  // Also check if there are other departments with weird names
  console.log('\n=== CHECKING ALL OTHER DEPT NAMES ACROSS HOSPITALS ===');
  const allDeptNames = [...new Set(depts.map(d => d.name.trim()))];
  console.log(allDeptNames.sort());
}

inspectAllDepartmentsAndFindings();
