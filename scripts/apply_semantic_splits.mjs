import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config({ path: '.env.local' })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function applySplits() {
  console.log('=== APPLYING FALSE POSITIVE SPLITS ===\n')

  if (!fs.existsSync('semantic_dry_run_full_report.json')) {
    console.error('Error: semantic_dry_run_full_report.json not found.')
    return
  }

  const data = JSON.parse(fs.readFileSync('semantic_dry_run_full_report.json', 'utf8'))
  const splits = data.proposedSplits || []

  if (splits.length === 0) {
    console.log('No splits to apply.')
    return
  }

  console.log(`Found ${splits.length} items to split (recurrence_group_id -> null)`)

  let successCount = 0
  let errorCount = 0

  // We process in small chunks to avoid DB overload
  for (const split of splits) {
    const findingId = split.findingId

    const { error } = await supabase
      .from('report_findings')
      .update({ recurrence_group_id: null, review_status: 'single' }) // Mark as single since it's distinctly isolated
      .eq('id', findingId)

    if (error) {
      console.error(`Error splitting finding ${findingId}:`, error.message)
      errorCount++
    } else {
      successCount++
    }
  }

  console.log('\n=== MIGRATION RESULTS ===')
  console.log(`Successfully split: ${successCount}`)
  console.log(`Errors: ${errorCount}`)
  console.log('Done.')
}

applySplits().catch(console.error)
