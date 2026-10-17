import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectHospitalDepts() {
  const { data: hospitals } = await supabase.from('hospitals').select('id, name');
  const { data: depts } = await supabase.from('departments').select('id, hospital_id, name');

  for (const h of hospitals) {
    const hDepts = depts.filter(d => d.hospital_id === h.id).map(d => d.name);
    console.log(`\n[${h.name}] (Total: ${hDepts.length} depts):`);
    console.log(hDepts.join(' | '));
  }
}

inspectHospitalDepts();
