import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectReportFindings() {
  const { data: hospitals } = await supabase.from('hospitals').select('id, name');
  const { data: depts } = await supabase.from('departments').select('id, hospital_id, name');
  const { data: rFindings } = await supabase.from('report_findings').select('id, hospital_id, department_id, original_text, hospital_resolution_note, status, review_status');

  const hospMap = Object.fromEntries(hospitals.map(h => [h.id, h.name]));
  const genericDeptNames = ['عام', 'عموم المستشفى', 'قسم عام'];
  const genericDepts = depts.filter(d => genericDeptNames.includes(d.name.trim()));

  console.log('=== REPORT_FINDINGS IN GENERIC DEPTS ===');
  for (const d of genericDepts) {
    const list = rFindings.filter(f => f.department_id === d.id);
    if (list.length === 0) continue;
    const hName = hospMap[d.hospital_id] || 'Unknown';
    const withResp = list.filter(f => f.hospital_resolution_note).length;
    console.log(`Hospital: [${hName}] | Dept: [${d.name}] | Count in report_findings: ${list.length} | With Response: ${withResp}`);
  }
}

inspectReportFindings();
