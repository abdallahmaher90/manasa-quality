import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createServiceClient } from '../src/lib/supabase.js'

async function run() {
  const sb = createServiceClient()
  const targetNames = [
    'الطبيب', 'الطبيب المسؤل', 'الفريق الطبي', 'الهيئة الطبية',
    'التمريض', 'التمريض المسؤل',
    'البيئة',
    'سلامة المرضى', 'مسؤل سلامه المرضي', 'تعريف هوية المرضى',
    'مسؤل الاجهزة الطبية', 'مسؤل الصيلنه', 'مسئول الاحالة',
    'الطبيعة'
  ]
  
  const { data: depts } = await sb.from('departments')
    .select('id, name, hospital_id, hospitals(name)')
    .in('name', targetNames)
    
  console.log(`Found ${depts.length} pseudo-departments:`)
  
  for (const d of depts) {
    const { data: findings } = await sb.from('report_findings')
      .select('id, original_text, status')
      .eq('department_id', d.id)
      
    console.log(`\n--- [${d.hospitals?.name}] Dept: "${d.name}" (${findings.length} findings) ---`)
    findings.forEach((f, i) => {
      console.log(`  (${i+1}) ${f.original_text.replace(/\n/g, ' ')}`)
    })
  }
}

run().catch(console.error)
