import { createServiceClient } from '@/lib/supabase'
import { normalizeFindingsBulk, matchAndCanonicalizeFindingsBulk } from '@/lib/ai-parser'
import { getCategory, sanitizeInspectionDate } from '@/lib/utils'
import { sendNewReportEmail } from '@/lib/email'

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

    if (parsedData) {
      // Ensure multi-day dates or formatted text are converted to a single YYYY-MM-DD date
      parsedData.inspection_date = sanitizeInspectionDate(parsedData.inspection_date || rawText)
    }

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
        const category = getCategory(dept.name)

        // 4a. Fetch platform-wide canonical texts for this category to ensure cross-hospital standardization
        let existingPlatformCanonicals = []
        try {
          const { data: catSample } = await supabase
            .from('findings')
            .select('canonical_text, departments(name)')
            .limit(350)

          if (catSample) {
            existingPlatformCanonicals = [...new Set(
              catSample
                .filter(f => getCategory(f.departments?.name) === category)
                .map(f => f.canonical_text)
                .filter(Boolean)
            )]
          }
        } catch (e) {
          console.warn('Could not fetch platform canonicals:', e)
        }

        // 4b. Match and standardize new findings against platform canonical library
        const standardizedFindings = await matchAndCanonicalizeFindingsBulk(
          newFindings,
          existingPlatformCanonicals,
          category
        )

        // 4c. Save each finding: check if this specific hospital already has this canonical issue in this department
        for (let i = 0; i < standardizedFindings.length; i++) {
          const finding = standardizedFindings[i]
          const targetCanonical = (finding.canonical_text || finding.original_text).trim()

          // Check if this hospital already has this finding in this department
          const { data: hospitalExisting } = await supabase
            .from('findings')
            .select('id, repeat_count, status, last_seen_date, last_report_id')
            .eq('hospital_id', hospitalId)
            .eq('department_id', deptId)
            .eq('canonical_text', targetCanonical)
            .maybeSingle()

          if (hospitalExisting) {
            // It's a recurring finding in this hospital - increment repeat count
            const isSameReport = hospitalExisting.last_report_id === report.id
            const isSameDate = hospitalExisting.last_seen_date === parsedData.inspection_date

            if (!isSameReport && !isSameDate) {
              await supabase
                .from('findings')
                .update({
                  repeat_count: (hospitalExisting.repeat_count || 1) + 1,
                  status: 'recurring',
                  last_seen_date: parsedData.inspection_date,
                  last_report_id: report.id,
                  // Clear resolution fields since it reoccurred
                  resolved_by: null,
                  resolved_date: null,
                  resolution_note: null,
                  hospital_resolution_note: null,
                  hospital_resolution_date: null
                })
                .eq('id', hospitalExisting.id)
            }
          } else {
            // New finding for this hospital: insert with standardized canonical_text
            await supabase
              .from('findings')
              .insert({
                hospital_id: hospitalId,
                department_id: deptId,
                report_id: report.id,
                original_text: finding.original_text,
                canonical_text: targetCanonical,
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

    // --- CREATE NOTIFICATION FOR HOSPITAL ---
    try {
      await supabase.from('notifications').insert({
        hospital_id: hospitalId,
        title: 'تقرير مرور جديد 📋',
        message: `تم رفع تقرير مرور جديد بتاريخ ${parsedData.inspection_date}`,
        type: 'new_report',
        link: `/archive`
      })

      // Send Emails
      const { data: hospitalProfiles } = await supabase
        .from('profiles')
        .select('id, hospitals(name)')
        .eq('hospital_id', hospitalId)

      if (hospitalProfiles && hospitalProfiles.length > 0) {
        const hospitalName = hospitalProfiles[0]?.hospitals?.name || 'المستشفى'
        // Need absolute URL for the email link
        const host = request.headers.get('host')
        const protocol = host.includes('localhost') ? 'http' : 'https'
        const reportUrl = `${protocol}://${host}/archive`

        for (const profile of hospitalProfiles) {
          const { data: { user } } = await supabase.auth.admin.getUserById(profile.id)
          if (user?.email) {
            await sendNewReportEmail(user.email, hospitalName, parsedData.inspection_date, reportUrl)
          }
        }
      }
    } catch (notifError) {
      console.error('Failed to create notification/email:', notifError)
    }

    return Response.json({ success: true, hospitalId, reportId: report.id })
  } catch (error) {
    console.error('Save report error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
