import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createServiceClient } from '../src/lib/supabase.js'

async function run() {
  const sb = createServiceClient()
  const { data: hosp } = await sb.from('hospitals').select('id, name').ilike('name', '%كفر الشيخ العام%').single()
  console.log('Hospital:', hosp.name, hosp.id)

  const { data: depts } = await sb.from('departments').select('id, name').eq('hospital_id', hosp.id)
  console.log('All departments in hospital:', depts.map(d => d.name))

  const generalDepts = depts.filter(d => d.name === 'عام' || d.name === 'عموم المستشفى')

  for (const gd of generalDepts) {
    const { data: findings, error } = await sb.from('report_findings')
      .select('id, original_text, report_id, reports:reports!report_findings_report_id_fkey(id, file_name, inspection_date, inspector_name, raw_text)')
      .eq('department_id', gd.id)
      
    if (error) {
      console.error(error)
      continue
    }

    console.log(`\n========================================`)
    console.log(`Total findings in "${gd.name}" (${gd.id}): ${findings.length}`)

    const byReport = {}
    findings.forEach(f => {
      const repKey = `${f.reports?.file_name || 'بدون ملف'} (تاريخ: ${f.reports?.inspection_date})`
      if (!byReport[repKey]) byReport[repKey] = { id: f.reports?.id, raw: f.reports?.raw_text, list: [] }
      byReport[repKey].list.push(f.original_text)
    })

    for (const [rep, obj] of Object.entries(byReport)) {
      console.log(`\n📄 Report: ${rep} (${obj.list.length} findings):`)
      obj.list.forEach((t, i) => console.log(`   ${i + 1}. ${t.replace(/\n/g, ' ')}`))
      
      console.log(`\n--- First 500 chars of raw report text: ---`)
      console.log(obj.raw ? obj.raw.slice(0, 500) : 'NO RAW TEXT')
      console.log('-------------------------------------------\n')
    }
  }
}

run().catch(console.error)
