import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function verify() {
  console.log("Starting Production Verification...")
  
  const results = {}

  // 1. Check legacy findings count
  const { count: findingsCount, error: fErr } = await supabase
    .from('findings')
    .select('*', { count: 'exact', head: true })
  results.findings_count = findingsCount
  console.log("findings count:", findingsCount, fErr ? fErr.message : '')

  // 2. Check report_findings count
  const { count: reportFindingsCount, error: rfErr } = await supabase
    .from('report_findings')
    .select('*', { count: 'exact', head: true })
  results.report_findings_count = reportFindingsCount
  console.log("report_findings count:", reportFindingsCount, rfErr ? JSON.stringify(rfErr) : '')
  
  if (rfErr) {
    results.status_004 = 'FAILED'
  } else {
    results.status_004 = 'SUCCESS'
  }

  // 3. ID mismatch count
  let mismatchCount = -1;
  if (findingsCount !== undefined && reportFindingsCount !== undefined) {
    const { data: fIds } = await supabase.from('findings').select('id')
    const { data: rfIds } = await supabase.from('report_findings').select('id')
    
    if (fIds && rfIds) {
      const setF = new Set(fIds.map(f => f.id))
      const setRf = new Set(rfIds.map(f => f.id))
      let missing = 0
      for (let id of setF) {
        if (!setRf.has(id)) missing++
      }
      mismatchCount = missing
    }
  }
  results.mismatch_count = mismatchCount
  console.log("Mismatch count:", mismatchCount)

  // 4. Count of NULL canonical_finding_id
  const { count: nullCanonicalCount } = await supabase
    .from('report_findings')
    .select('*', { count: 'exact', head: true })
    .is('canonical_finding_id', null)
  results.null_canonical = nullCanonicalCount
  console.log("NULL canonical_finding_id count:", nullCanonicalCount)

  // 5. Existence of غير مصنف
  const { data: unclassified } = await supabase
    .from('canonical_findings')
    .select('*')
    .eq('canonical_text', 'غير مصنف')
  results.unclassified_exists = unclassified && unclassified.length > 0
  console.log("غير مصنف exists:", results.unclassified_exists)

  // 6. v_report_findings
  const { data: viewData, error: viewErr } = await supabase
    .from('v_report_findings')
    .select('*')
    .limit(1)
  
  if (viewErr) {
    results.status_005 = 'FAILED'
    console.log("View error:", viewErr.message)
  } else {
    results.status_005 = 'SUCCESS'
    results.view_sample = !!viewData
    console.log("View query successful. Sample retrieved:", viewData.length)
  }

  // 7. match_canonical_findings RPC
  const dummyVector = new Array(768).fill(0.01)
  const { data: rpcData, error: rpcErr } = await supabase
    .rpc('match_canonical_findings', {
      query_embedding: `[${dummyVector.join(',')}]`,
      match_category: 'عام',
      allowed_statuses: ['active']
    })
  
  if (rpcErr) {
    results.status_006 = 'FAILED'
    console.log("RPC Error:", rpcErr.message)
  } else {
    results.status_006 = 'SUCCESS'
    results.rpc_works = true
    console.log("RPC successful. Results:", rpcData?.length)
  }

  // 8. finding_match_logs existence
  const { data: fmlData, error: fmlErr } = await supabase
    .from('finding_match_logs')
    .select('id')
    .limit(1)
  if (fmlErr) {
    if (results.status_006 !== 'FAILED') results.status_006 = 'FAILED'
  }

  console.log(JSON.stringify(results, null, 2))
}

verify()
