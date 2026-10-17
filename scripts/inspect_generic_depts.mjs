import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectGenericDepts() {
  const { data: hospitals } = await supabase.from('hospitals').select('id, name');
  const { data: depts } = await supabase.from('departments').select('id, hospital_id, name');
  const { data: findings } = await supabase.from('findings').select('id, hospital_id, department_id, original_text, hospital_resolution_note, status, repeat_count');

  const hospMap = Object.fromEntries(hospitals.map(h => [h.id, h.name]));

  const genericKeywords = ['عام', 'عموم', 'اخرى', 'أخرى', 'ملاحظات', 'متنوع', 'عامة', 'عام المستشفى'];
  
  const findingsByDept = {};
  const findingsWithRespByDept = {};

  findings.forEach(f => {
    findingsByDept[f.department_id] = (findingsByDept[f.department_id] || 0) + 1;
    if (f.hospital_resolution_note) {
      findingsWithRespByDept[f.department_id] = (findingsWithRespByDept[f.department_id] || 0) + 1;
    }
  });

  const matchingDepts = depts.filter(d => {
    const n = d.name.trim();
    return genericKeywords.some(k => n === k || n.startsWith('قسم ' + k) || n.includes('عموم المستشفى') || n === 'قسم عام');
  });

  console.log('--- Generic Departments Found ---');
  for (const d of matchingDepts) {
    const count = findingsByDept[d.id] || 0;
    const respCount = findingsWithRespByDept[d.id] || 0;
    const hName = hospMap[d.hospital_id] || 'Unknown Hospital';
    console.log(`Hospital: [${hName}] | Dept: [${d.name}] | Total Findings: ${count} | With Hospital Response: ${respCount}`);
  }
}

inspectGenericDepts();
