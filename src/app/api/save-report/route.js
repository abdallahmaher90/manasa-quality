import { createServiceClient } from '@/lib/supabase'
import { normalizeFindingsBulk } from '@/lib/ai-parser'

function normalizeArabicName(name) {
  if (!name) return ''
  return name
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ي/g, 'ى')
    .replace(/\s+/g, ' ') // just normalize spaces
    .trim()
}

export async function POST(request) {
  try {
    const { parsedData, rawText, fileName, fileUrl } = await request.json()
    const supabase = createServiceClient()

    // 1. Find or create hospital
    let hospitalId
    const targetNorm = normalizeArabicName(parsedData.hospital_name)
    
    // Fetch all hospitals to do a smart match
    const { data: allHospitals } = await supabase.from('hospitals').select('id, name')
    
    let existingHospital = null
    if (allHospitals) {
      existingHospital = allHospitals.find(h => {
        const dbNorm = normalizeArabicName(h.name)
        return dbNorm === targetNorm
      })
    }

    if (existingHospital) {
      hospitalId = existingHospital.id
    } else {
      const { data: newHospital, error: hospErr } = await supabase
        .from('hospitals')
        .insert({
          name: parsedData.hospital_name,
          governorate: parsedData.governorate,
        })
        .select('id')
        .single()

      if (hospErr) throw new Error('فشل في إنشاء المستشفى: ' + hospErr.message)
      hospitalId = newHospital.id
    }

    // 2. Save the report to archive
    const { data: report, error: reportErr } = await supabase
      .from('reports')
      .insert({
        hospital_id: hospitalId,
        inspector_name: parsedData.inspector_name,
        inspection_date: parsedData.inspection_date,
        raw_text: rawText,
        file_name: fileName,
        file_url: fileUrl,
        signatory_1_name: parsedData.signatory_1_name,
        signatory_1_title: parsedData.signatory_1_title,
        signatory_2_name: parsedData.signatory_2_name,
        signatory_2_title: parsedData.signatory_2_title,
      })
      .select('id')
      .single()

    if (reportErr) throw new Error('فشل في حفظ التقرير: ' + reportErr.message)

    // 3. Process each department and its findings
    for (const dept of parsedData.departments || []) {
      // Find or create department (smart match)
      let deptId
      const targetDeptNorm = normalizeArabicName(dept.name)
      
      const { data: allDepts } = await supabase
        .from('departments')
        .select('id, name')
        .eq('hospital_id', hospitalId)
        
      let existingDept = null
      if (allDepts) {
        existingDept = allDepts.find(d => {
          const dbNorm = normalizeArabicName(d.name)
          return dbNorm.includes(targetDeptNorm) || targetDeptNorm.includes(dbNorm) || dbNorm === targetDeptNorm
        })
      }

      if (existingDept) {
        deptId = existingDept.id
      } else {
        const { data: newDept, error: deptErr } = await supabase
          .from('departments')
          .insert({
            hospital_id: hospitalId,
            name: dept.name,
          })
          .select('id')
          .single()

        if (deptErr) throw new Error('فشل في إنشاء القسم: ' + deptErr.message)
        deptId = newDept.id
      }

      // 4. Process all findings for this department in bulk
      const newFindings = dept.findings || []
      if (newFindings.length > 0) {
        // Get existing open/recurring findings for this department to compare
        const { data: existingFindings } = await supabase
          .from('findings')
          .select('id, canonical_text')
          .eq('department_id', deptId)
          .in('status', ['open', 'recurring'])

        let matchResults = newFindings.map(f => ({ isNew: true, matchedId: null }))

        if (existingFindings && existingFindings.length > 0) {
          const newTexts = newFindings.map(f => f.canonical_text || f.original_text)
          const existingCanons = existingFindings.map(f => ({ id: f.id, text: f.canonical_text }))
          // Bulk check to avoid rate limits
          matchResults = await normalizeFindingsBulk(newTexts, existingCanons)
        }

        // Now save them
        for (let i = 0; i < newFindings.length; i++) {
          const finding = newFindings[i]
          const match = matchResults[i]
          let savedFindingId = null

          if (!match.isNew && match.matchedId) {
            // It's a recurring finding - increment count
            const { data: existingF } = await supabase
              .from('findings')
              .select('repeat_count, status, last_seen_date, last_report_id')
              .eq('id', match.matchedId)
              .single()

            // Only increment if it hasn't been counted for this specific report or date yet
            const isSameReport = existingF?.last_report_id === report.id
            const isSameDate = existingF?.last_seen_date === parsedData.inspection_date

            if (!isSameReport && !isSameDate) {
              await supabase
                .from('findings')
                .update({
                  repeat_count: (existingF?.repeat_count || 1) + 1,
                  status: 'recurring',
                  last_seen_date: parsedData.inspection_date,
                  last_report_id: report.id,
                })
                .eq('id', match.matchedId)
            }

            savedFindingId = match.matchedId
          }

          // If it's a new finding, insert it
          if (!savedFindingId) {
            await supabase
              .from('findings')
              .insert({
                hospital_id: hospitalId,
                department_id: deptId,
                report_id: report.id,
                original_text: finding.original_text,
                canonical_text: finding.canonical_text || finding.original_text,
                corrective_action: finding.corrective_action,
                responsible: finding.responsible,
                deadline: finding.deadline,
                priority: finding.priority || 'medium',
                status: 'open',
                repeat_count: 1,
                first_seen_date: parsedData.inspection_date,
                last_seen_date: parsedData.inspection_date,
                last_report_id: report.id,
              })
          }
        }
      }
    }

    return Response.json({ success: true, hospitalId, reportId: report.id })
  } catch (error) {
    console.error('Save report error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
