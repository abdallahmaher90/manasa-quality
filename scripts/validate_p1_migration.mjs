import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY // Need service role to bypass RLS for counting

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function validateMigration() {
  console.log('--- بدء فحص الـ Migration للمرحلة P1 ---')

  try {
    // 1. عدد reports قبل وبعد
    const { count: reportsCount, error: err1 } = await supabase.from('reports').select('*', { count: 'exact', head: true })
    if (err1) throw err1
    console.log(`✅ عدد التقارير الكلي (Reports): ${reportsCount}`)

    // 2. عدد findings القديمة
    const { count: oldFindingsCount, error: err2 } = await supabase.from('findings').select('*', { count: 'exact', head: true })
    if (err2) throw err2
    console.log(`✅ عدد السلبيات في الجدول القديم (Findings): ${oldFindingsCount}`)

    // 3. عدد canonical findings الناتجة
    const { count: canonicalCount, error: err3 } = await supabase.from('canonical_findings').select('*', { count: 'exact', head: true })
    if (err3) throw err3
    console.log(`✅ عدد السلبيات المرجعية (Canonical Findings): ${canonicalCount}`)

    // 4. عدد report findings الناتجة
    const { count: reportFindingsCount, error: err4 } = await supabase.from('report_findings').select('*', { count: 'exact', head: true })
    if (err4) throw err4
    console.log(`✅ عدد سلبيات التقارير (Report Findings): ${reportFindingsCount}`)

    // 5. مقارنة الأعداد
    if (oldFindingsCount !== reportFindingsCount) {
      console.warn(`⚠️ تحذير: عدد السجلات المنقولة (${reportFindingsCount}) لا يتطابق مع الجدول القديم (${oldFindingsCount})!`)
      
      // Calculate missing
      const diff = oldFindingsCount - reportFindingsCount
      console.log(`❌ عدد السجلات التي فشل نقلها: ${diff}`)
    } else {
      console.log(`✅ تم نقل جميع السجلات بنجاح (${reportFindingsCount} سجل). عدد الفشل: 0`)
    }

    // 6. فحص الـ Orphans
    const { data: orphans } = await supabase
      .from('report_findings')
      .select('id, canonical_finding_id')
      .is('canonical_finding_id', null)
    
    if (orphans && orphans.length > 0) {
      console.warn(`⚠️ تحذير: يوجد ${orphans.length} سجلات Orphans (بدون canonical).`)
    } else {
      console.log(`✅ عدد الـ Orphans (سجلات بلا مرجع): 0`)
    }

    console.log('-------------------------------------------')
    console.log('الفحص اكتمل.')
    
  } catch (error) {
    console.error('❌ حدث خطأ أثناء الفحص:', error)
  }
}

validateMigration()
