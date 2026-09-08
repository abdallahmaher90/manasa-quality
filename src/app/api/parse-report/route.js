import { parseReport } from '@/lib/ai-parser'
import { sanitizeInspectionDate } from '@/lib/utils'
import { createServiceClient, supabase as supabaseClient } from '@/lib/supabase'

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

    const { text, fileHash } = await request.json()

    if (!text || text.trim().length < 50) {
      return Response.json({ error: 'النص قصير جداً أو فارغ' }, { status: 400 })
    }

    // Check if this exact file was already uploaded
    if (fileHash) {
      const { data: existingHash } = await supabase
        .from('reports')
        .select('id')
        .eq('file_hash', fileHash)
        .maybeSingle()
      
      if (existingHash) {
        return Response.json({ error: 'تم رفع هذا الملف مسبقاً في النظام. يرجى التحقق من الأرشيف.' }, { status: 409 })
      }
    }

    const result = await parseReport(text)

    if (result) {
      result.inspection_date = sanitizeInspectionDate(result.inspection_date || text)
    }

    // Check for duplicate report and resolve hospital ID
    const targetNorm = normalizeArabicName(result.hospital_name)
    const { data: allHospitals } = await supabase.from('hospitals').select('id, name')
    
    let hospitalId = null
    if (allHospitals) {
      const existing = allHospitals.find(h => {
        const dbNorm = normalizeArabicName(h.name)
        return dbNorm === targetNorm
      })
      if (existing) hospitalId = existing.id
    }

    if (hospitalId && result.inspection_date) {
      const { data: existingReport } = await supabase
        .from('reports')
        .select('id')
        .eq('hospital_id', hospitalId)
        .eq('inspection_date', result.inspection_date)
        .maybeSingle()
      
      if (existingReport) {
        return Response.json({ 
          error: `تم العثور على تقرير مكرر لنفس المستشفى (${result.hospital_name}) في نفس التاريخ (${result.inspection_date}). يرجى التحقق من الأرشيف.` 
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

    return Response.json({ result, hospitalId })
  } catch (error) {
    console.error('Parse report error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
