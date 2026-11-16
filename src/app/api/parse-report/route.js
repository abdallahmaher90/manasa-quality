import { parseReport } from '@/lib/ai-parser'
import { sanitizeInspectionDate, resolveHospital, normalizeArabicName } from '@/lib/utils'
import { createServiceClient, supabase as supabaseClient } from '@/lib/supabase'

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token)

    if (authError || !user) {
      return Response.json({ error: 'غير مصرح لك' }, { status: 401 })
    }

    const supabase = createServiceClient()
    
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, hospital_id')
      .eq('id', user.id)
      .single()

    const userRole = profile?.role || ''
    const userHospitalId = profile?.hospital_id || ''

    const { text, fileName, fileHash, skipDuplicateError } = await request.json()

    if (!text || text.trim().length < 50) {
      return Response.json({ error: 'النص قصير جداً أو فارغ' }, { status: 400 })
    }

    const { data: allHospitals } = await supabase.from('hospitals').select('id, name')

    // 1. Fast Pre-check: Check if a report with this exact file name already exists in archive
    if (fileName && typeof fileName === 'string') {
      const cleanFileName = fileName.trim()
      const { data: fileMatches } = await supabase
        .from('reports')
        .select('id, hospital_id, inspection_date, file_name, hospitals(id, name)')
        .eq('file_name', cleanFileName)

      if (fileMatches && fileMatches.length > 0) {
        for (const fm of fileMatches) {
          const { count } = await supabase
            .from('report_findings')
            .select('id', { count: 'exact', head: true })
            .eq('report_id', fm.id)
          if (count > 0) {
            const hospName = fm.hospitals?.name || 'المستشفى'
            const dateStr = fm.inspection_date || ''
            if (skipDuplicateError) {
              return Response.json({
                result: {
                  hospital_name: hospName,
                  inspection_date: dateStr,
                  departments: []
                },
                hospitalId: fm.hospital_id,
                isDuplicate: true,
                existingReportId: fm.id,
                message: `موجود مسبقاً في الأرشيف بنفس اسم الملف (${cleanFileName}) - ${hospName} (${dateStr})`
              })
            }
            return Response.json({
              error: `تم العثور على تقرير محفوظ مسبقاً بنفس اسم الملف (${cleanFileName}) لمستشفى ${hospName} في تاريخ ${dateStr}. يرجى التحقق من الأرشيف.`
            }, { status: 409 })
          }
        }
      }
    }

    // 2. Parse report using AI
    const result = await parseReport(text)

    if (result) {
      result.inspection_date = sanitizeInspectionDate(result.inspection_date || text)
    }

    // 3. Resolve Hospital ID with smart resolution rules
    const resolvedHosp = resolveHospital(result?.hospital_name, allHospitals, fileName, text)
    let hospitalId = resolvedHosp ? resolvedHosp.id : null
    if (resolvedHosp) {
      result.hospital_name = resolvedHosp.name
    }

    // 4. Duplicate Check: Hospital + Inspection Date
    if (hospitalId && result.inspection_date) {
      const { data: existingReports } = await supabase
        .from('reports')
        .select('id, file_name, inspection_date')
        .eq('hospital_id', hospitalId)
        .eq('inspection_date', result.inspection_date)

      let existingReport = null
      if (existingReports && existingReports.length > 0) {
        for (const er of existingReports) {
          const { count } = await supabase
            .from('report_findings')
            .select('id', { count: 'exact', head: true })
            .eq('report_id', er.id)
          if (count > 0) {
            existingReport = er
            break
          }
        }
      }
      
      if (existingReport) {
        const hospTitle = resolvedHosp?.name || result.hospital_name || 'المستشفى'
        if (skipDuplicateError) {
          return Response.json({ 
            result, 
            hospitalId, 
            isDuplicate: true, 
            existingReportId: existingReport.id,
            message: `موجود مسبقاً في الأرشيف لنفس المستشفى (${hospTitle}) في نفس التاريخ (${result.inspection_date}).` 
          })
        }
        return Response.json({ 
          error: `تم العثور على تقرير مكرر لنفس المستشفى (${hospTitle}) في نفس التاريخ (${result.inspection_date}). يرجى التحقق من الأرشيف.` 
        }, { status: 409 })
      }
    }

    // Check if the current user has permission for this hospital
    if (hospitalId && userRole !== 'directorate_admin' && userRole !== 'directorate_member') {
      if (userHospitalId !== hospitalId) {
        return Response.json({ 
          error: `لا تملك صلاحية رفع تقرير لهذا المستشفى.` 
        }, { status: 403 })
      }
    }

    return Response.json({ result, hospitalId, isDuplicate: false })
  } catch (error) {
    console.error('Parse report error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
