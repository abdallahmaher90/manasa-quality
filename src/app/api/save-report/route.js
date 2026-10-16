import { createServiceClient, supabase as supabaseClient } from '@/lib/supabase'
import { VectorMatchingService } from '@/services/vector-matching.service'
import { RecurrenceMatcherService, normalizeRecurrenceKey } from '@/services/recurrence-matcher.service'
import { getCategory, sanitizeInspectionDate, getCanonicalDepartment } from '@/lib/utils'
import { sendNewReportEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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
  let report = null
  let supabase = null
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token)

    if (authError || !user) {
      return Response.json({ error: 'غير مصرح لك للقيام بهذه العملية' }, { status: 401 })
    }

    supabase = createServiceClient()

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, hospital_id')
      .eq('id', user.id)
      .single()

    const userRole = profile?.role || ''
    const userHospitalId = profile?.hospital_id || ''

    const { parsedData, hospitalId: explicitHospitalId, rawText, fileName, fileUrl, fileHash } = await request.json()
    
    if (parsedData) {
      // Ensure multi-day dates or formatted text are converted to a single YYYY-MM-DD date
      parsedData.inspection_date = sanitizeInspectionDate(parsedData.inspection_date || rawText)
    }

    // 1. Find or create hospital
    let hospitalId = explicitHospitalId || null
    if (!hospitalId) {
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
        // Only directorate admin can create a new hospital implicitly
        if (userRole !== 'directorate_admin' && userRole !== 'directorate_member') {
           return Response.json({ error: 'لا تملك صلاحية إضافة مستشفى جديد' }, { status: 403 })
        }
        const { data: newHospital, error: hospErr } = await supabase
          .from('hospitals')
          .insert({
            name: parsedData.hospital_name,
            governorate: parsedData.governorate,
          })
          .select('id')
          .single()
        if (hospErr) throw hospErr
        hospitalId = newHospital.id
      }
    }

    // Permission check for saving to this hospital
    if (userRole !== 'directorate_admin' && userRole !== 'directorate_member') {
      if (userHospitalId !== hospitalId) {
        return Response.json({ error: 'لا تملك صلاحية حفظ تقرير لهذا المستشفى' }, { status: 403 })
      }
    }

    // 2. Prevent duplicate reports for the same hospital & date
    if (hospitalId && parsedData.inspection_date) {
      const { data: existingReports } = await supabase
        .from('reports')
        .select('id')
        .eq('hospital_id', hospitalId)
        .eq('inspection_date', parsedData.inspection_date)

      if (existingReports && existingReports.length > 0) {
        let hasReportWithFindings = false
        for (const er of existingReports) {
          const { count } = await supabase
            .from('findings')
            .select('id', { count: 'exact', head: true })
            .eq('report_id', er.id)
          if (count > 0) {
            hasReportWithFindings = true
            break
          }
        }

        if (hasReportWithFindings) {
          return Response.json({
            error: `تم العثور على تقرير محفوظ مسبقاً لهذا المستشفى في نفس التاريخ (${parsedData.inspection_date}). يرجى التحقق من الأرشيف.`
          }, { status: 409 })
        } else {
          // If existing reports are empty shells from previous failed timeout attempts, clean them up
          for (const er of existingReports) {
            await supabase.from('reports').delete().eq('id', er.id)
          }
        }
      }
    }

    // 3. Save the report to archive
    const { data: insertedReport, error: reportErr } = await supabase
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
    report = insertedReport

    // 3. Initialize matching services once for the whole report
    const matcherService = new VectorMatchingService(supabase)
    const recurrenceMatcher = new RecurrenceMatcherService(supabase)
    await recurrenceMatcher.initializeGroupCache()

    // Process each department and its findings
    for (const dept of parsedData.departments || []) {
      // Find or create department (canonical smart match)
      const canonicalName = getCanonicalDepartment(dept.name)
      let deptId
      
      const { data: allDepts } = await supabase
        .from('departments')
        .select('id, name')
        .eq('hospital_id', hospitalId)
        
      let existingDept = null
      if (allDepts) {
        // 1. Look for canonical match
        existingDept = allDepts.find(d => {
          return d.name === canonicalName || getCanonicalDepartment(d.name) === canonicalName
        })
        // 2. Fallback to substring matching if needed
        if (!existingDept) {
          const targetDeptNorm = normalizeArabicName(dept.name)
          existingDept = allDepts.find(d => {
            const dbNorm = normalizeArabicName(d.name)
            return dbNorm.includes(targetDeptNorm) || targetDeptNorm.includes(dbNorm) || dbNorm === targetDeptNorm
          })
        }
      }

      if (existingDept) {
        deptId = existingDept.id
      } else {
        const { data: newDept, error: deptErr } = await supabase
          .from('departments')
          .insert({
            hospital_id: hospitalId,
            name: canonicalName,
          })
          .select('id')
          .single()

        if (deptErr) throw new Error('فشل في إنشاء القسم: ' + deptErr.message)
        deptId = newDept.id
      }

      // 4. Process all findings for this department
      const newFindings = dept.findings || []
      if (newFindings.length > 0) {
        const category = getCategory(dept.name)

        // Deduplicate locally in this report
        const uniqueFindingsMap = new Map()
        for (const finding of newFindings) {
          const original = (finding.original_text || '').trim()
          if (!uniqueFindingsMap.has(original)) {
            uniqueFindingsMap.set(original, finding)
          }
        }
        const uniqueFindings = Array.from(uniqueFindingsMap.values())

        for (const finding of uniqueFindings) {
          const originalText = finding.original_text
          
          // Layer 3: Broad Canonical Classification (Independent)
          let matchResult = null
          let canonicalId = null
          try {
            matchResult = await matcherService.processFinding(originalText, category)
            canonicalId = matchResult?.canonicalId
            if (canonicalId && matchResult?.matchLog) {
              await matcherService.logMatch(matchResult.matchLog, originalText)
            }
          } catch (e) {
            console.warn('Vector match warning for finding:', e.message)
          }

          // Layer 2: Exact Recurrence Matching (Unified Engine in Fast Mode)
          let recResult = null
          try {
            recResult = await recurrenceMatcher.matchFinding(originalText, dept.name || 'عام', { fastMode: true })
          } catch (e) {
            console.warn('Recurrence match warning for finding:', e.message)
            recResult = {
              decision: 'DISTINCT',
              recurrenceGroupId: null,
              reviewStatus: 'pending_review',
              matchingPolicyVersion: 'FALLBACK_HEURISTIC',
              entity: 'سلبية عامة',
              defect: 'مخالفة',
              reason: 'Local fallback due to matching error: ' + e.message
            }
          }
          let recurrenceGroupId = recResult.recurrenceGroupId
          let reviewStatus = recResult.reviewStatus

          if (!recurrenceGroupId && recResult.decision !== 'REQUIRES_GEMINI') {
            // Distinct or Uncertain: create new independent group
            // (Skipped if REQUIRES_GEMINI, as Gemini will decide whether to create or link)
            const normKey = normalizeRecurrenceKey(originalText)
            const { data: newGrp } = await supabase
              .from('recurrence_groups')
              .insert({
                title: normKey,
                normalized_key: normKey,
                entity: recResult.entity,
                defect: recResult.defect,
                domain: dept.name || 'عام',
                confidence: recResult.decision,
                review_status: reviewStatus,
                matching_policy_version: recResult.matchingPolicyVersion
              })
              .select('id')
              .single()

            if (newGrp) {
              recurrenceGroupId = newGrp.id
            }
          }

          // Save finding with both canonical_finding_id and recurrence_group_id
          const { data: insertedFinding, error: insertError } = await supabase.from('report_findings').insert({
            report_id: report.id,
            hospital_id: hospitalId,
            department_id: deptId,
            canonical_finding_id: canonicalId || null,
            recurrence_group_id: recurrenceGroupId || null,
            matching_policy_version: recResult.matchingPolicyVersion,
            review_status: reviewStatus,
            match_reason: recResult.reason,
            original_text: originalText,
            corrective_action: finding.corrective_action,
            responsible: finding.responsible,
            deadline: finding.deadline,
            priority: finding.priority || 'medium',
            status: 'open'
          }).select('id').single()

          if (!insertError && insertedFinding && recResult.decision === 'REQUIRES_GEMINI') {
            await supabase.from('semantic_adjudication_queue').insert({
              report_finding_id: insertedFinding.id,
              candidate_group_id: recResult.candidateGroupId || null,
              status: 'pending'
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

        // Send emails asynchronously in background so saving never delays or times out
        Promise.resolve().then(async () => {
          try {
            for (const profile of hospitalProfiles) {
              const { data: { user } } = await supabase.auth.admin.getUserById(profile.id)
              if (user?.email) {
                await sendNewReportEmail(user.email, hospitalName, parsedData.inspection_date, reportUrl)
              }
            }
          } catch (e) {
            console.error('Async email error:', e)
          }
        })
      }
    } catch (notifError) {
      console.error('Failed to create notification/email:', notifError)
    }

    return Response.json({ success: true, hospitalId, reportId: report.id })
  } catch (error) {
    console.error('Save report error:', error)
    // Rollback / cleanup newly created empty report if save failed mid-way
    if (report?.id && supabase) {
      try {
        const { count } = await supabase
          .from('findings')
          .select('id', { count: 'exact', head: true })
          .eq('report_id', report.id)
        if (count === 0) {
          console.warn(`[Save Report Rollback]: Deleted orphaned report shell ${report.id}`)
          await supabase.from('reports').delete().eq('id', report.id)
        }
      } catch (rollbackErr) {
        console.error('Failed to rollback empty report:', rollbackErr)
      }
    }
    return Response.json({ error: error.message }, { status: 500 })
  }
}
