import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createServiceClient } from '../src/lib/supabase.js'
import { getCanonicalDepartment } from '../src/lib/utils.js'

async function run() {
  const supabase = createServiceClient()
  console.log('🚀 Starting Intelligent Hospital Department Consolidation...\n')

  const { data: hospitals, error: hospErr } = await supabase.from('hospitals').select('id, name')
  if (hospErr) throw hospErr

  const { data: depts, error: deptErr } = await supabase.from('departments').select('id, name, hospital_id')
  if (deptErr) throw deptErr

  console.log(`📋 Found ${hospitals.length} hospitals and ${depts.length} total department records.`)

  // Fetch all findings with pagination
  let allFindings = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('report_findings')
      .select('id, department_id, hospital_id')
      .range(from, from + 999)
    if (error) throw error
    if (!data || data.length === 0) break
    allFindings = allFindings.concat(data)
    if (data.length < 1000) break
    from += 1000
  }
  console.log(`📋 Loaded ${allFindings.length} total findings for reference.\n`)

  const findingCounts = {}
  allFindings.forEach(f => {
    findingCounts[f.department_id] = (findingCounts[f.department_id] || 0) + 1
  })

  let totalMerges = 0
  let totalReassignedFindings = 0
  let totalDeletedDepts = 0
  let totalRenamedDepts = 0

  for (const h of hospitals) {
    const hospDepts = depts.filter(d => d.hospital_id === h.id)
    const groups = new Map()

    for (const d of hospDepts) {
      const canon = getCanonicalDepartment(d.name)
      if (!groups.has(canon)) {
        groups.set(canon, [])
      }
      groups.get(canon).push({
        id: d.id,
        name: d.name,
        count: findingCounts[d.id] || 0
      })
    }

    const duplicates = []
    groups.forEach((list, canon) => {
      if (list.length > 1) {
        duplicates.push({ canon, list })
      }
    })

    if (duplicates.length > 0) {
      console.log(`\n🏥 [${h.name}] - وجد ${duplicates.length} مجمّع أقسام متطابقة:`)

      for (const { canon, list } of duplicates) {
        // Choose the best target department:
        // 1. One whose name is already equal to canon
        // 2. Or the one with the highest count of findings
        list.sort((a, b) => {
          if (a.name === canon && b.name !== canon) return -1
          if (b.name === canon && a.name !== canon) return 1
          return b.count - a.count
        })

        const target = list[0]
        const others = list.slice(1)

        console.log(`  🔹 القسم المعتمد: [${canon}] (المعرّف الحالي: ${target.id} - باسم: "${target.name}")`)

        // Rename target if needed to canonical name
        if (target.name !== canon) {
          const { error: renameErr } = await supabase
            .from('departments')
            .update({ name: canon })
            .eq('id', target.id)
          if (renameErr) {
            console.error(`     ❌ خطأ أثناء تحديث اسم القسم ${target.id}:`, renameErr.message)
          } else {
            totalRenamedDepts++
            console.log(`     ✏️ تم توحيد اسم القسم الرئيسي إلى: "${canon}"`)
          }
        }

        // Reassign findings from others to target, then delete others
        for (const other of others) {
          console.log(`     🔄 دمج القسم: "${other.name}" (${other.count} سلبية)...`)
          if (other.count > 0) {
            const { data: updated, error: updateErr } = await supabase
              .from('report_findings')
              .update({ department_id: target.id })
              .eq('department_id', other.id)
              .select('id')

            if (updateErr) {
              console.error(`     ❌ خطأ أثناء نقل سلبيات القسم ${other.name}:`, updateErr.message)
              continue
            }
            const movedCount = updated?.length || other.count
            totalReassignedFindings += movedCount
            console.log(`        ✅ تم نقل ${movedCount} سلبية بنجاح إلى [${canon}].`)
          }

          // Delete the duplicate empty department
          const { error: delErr } = await supabase
            .from('departments')
            .delete()
            .eq('id', other.id)

          if (delErr) {
            console.error(`     ❌ خطأ أثناء حذف القسم المكرر ${other.name}:`, delErr.message)
          } else {
            totalDeletedDepts++
            totalMerges++
            console.log(`        🗑️ تم حذف السجل المكرر: "${other.name}".`)
          }
        }
      }
    }
  }

  // Also standardize single departments with minor spelling variations if needed
  for (const d of depts) {
    const canon = getCanonicalDepartment(d.name)
    // Only rename if it's a known canonical mapping and simple spelling cleanup
    if (d.name !== canon && canon !== 'عموم المستشفى') {
      // Check if department still exists
      const { data: exists } = await supabase.from('departments').select('id, name').eq('id', d.id).single()
      if (exists && exists.name === d.name) {
        await supabase.from('departments').update({ name: canon }).eq('id', d.id)
        totalRenamedDepts++
      }
    }
  }

  console.log('\n=============================================')
  console.log('🎉 اكتملت عملية فحص ودمج الأقسام بنجاح!')
  console.log(`✨ إجمالي عمليات الدمج: ${totalMerges}`)
  console.log(`✨ إجمالي السلبيات المعاد توجيهها للقسم الموحد: ${totalReassignedFindings}`)
  console.log(`✨ إجمالي سجلات الأقسام المكررة المحذوفة: ${totalDeletedDepts}`)
  console.log(`✨ إجمالي الأقسام المحسّن مسمياتها: ${totalRenamedDepts}`)
  console.log('=============================================\n')
}

run().catch(err => {
  console.error('Fatal error executing consolidation:', err)
  process.exit(1)
})
