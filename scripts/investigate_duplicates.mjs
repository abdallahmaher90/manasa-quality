import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envPath = '.env.local'
const envContent = fs.readFileSync(envPath, 'utf8')
const envVars = Object.fromEntries(envContent.split('\n').map(line => {
  const [key, ...value] = line.split('=')
  return [key, value.join('=').trim()]
}).filter(([key]) => key && !key.startsWith('#')))

const supabaseUrl = envVars['NEXT_PUBLIC_SUPABASE_URL']
const supabaseServiceKey = envVars['SUPABASE_SERVICE_ROLE_KEY']

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function run() {
  const { data: findings, error } = await supabase
    .from('findings')
    .select('id, report_id, department_id, canonical_text, original_text, created_at, hospitals(name), departments(name)')
    .like('canonical_text', '%التوقيعات الثنائية%')

  if (error) {
    console.error("Error:", error)
    return
  }

  console.log(`Found ${findings.length} findings.`)
  for (const f of findings) {
    console.log(`ID: ${f.id}`)
    console.log(`Report: ${f.report_id}`)
    console.log(`Dept: ${f.department_id} (${f.departments?.name})`)
    console.log(`Hospital: ${f.hospitals?.name}`)
    console.log(`Canonical: "${f.canonical_text}"`)
    console.log(`Original: "${f.original_text}"`)
    console.log('---')
  }
}
run()
