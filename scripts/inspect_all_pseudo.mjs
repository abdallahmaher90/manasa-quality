import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createServiceClient } from '../src/lib/supabase.js'

async function run() {
  const sb = createServiceClient()
  const pseudoNames = [
    'الطبيب', 'التمريض', 'البيئة', 'الطبيب المسؤل', 'التمريض المسؤل',
    'الفريق الطبي', 'الهيئة الطبية', 'سلامة المرضى', 'مسؤل سلامه المرضي',
    'تعريف هوية المرضى', 'مسئول الاحالة', 'مسؤل الاجهزة الطبية',
    'مسؤل الصيلنه', 'الطبيعة', 'الفرز', 'BASEMENT', 'control room',
    'طلمبات المياه', 'المستلزمات', 'المستلزمات الطبية'
  ]

  const { data: depts } = await sb.from('departments')
    .select('id, name, hospital_id, hospitals(name)')
    .in('name', pseudoNames)
  
  let totalFindings = 0
  for (const d of depts) {
    const { data: findings } = await sb.from('report_findings')
      .select('id, original_text')
      .eq('department_id', d.id)
    if (findings.length > 0) {
      console.log(`\n🏥 [${d.hospitals?.name}] Dept: "${d.name}" (${findings.length} findings)`)
      findings.forEach(f => {
        totalFindings++
        console.log(`  * (${f.id}) ${f.original_text.replace(/\n/g, ' ')}`)
      })
    } else {
      console.log(`🏥 [${d.hospitals?.name}] Dept: "${d.name}" (0 findings)`)
    }
  }
  console.log(`\nTotal findings to reassign: ${totalFindings}`)
}

run().catch(console.error)
