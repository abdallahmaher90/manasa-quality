import { parseReport } from '@/lib/ai-parser'
import { sanitizeInspectionDate } from '@/lib/utils'
import { createServiceClient } from '@/lib/supabase'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

function normalizeArabicName(name) {
  if (!name) return ''
  return name
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ي/g, 'ى')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function POST(request) {
  try {
    const cookieStore = await cookies()
    const supabaseClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // Ignore in route handlers
            }
          },
        },
      }
    )
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser()

    if (authError || !user) {
      return Response.json({ error: 'غير مصرح لك' }, { status: 401 })
    }

    const { text, fileHash } = await request.json()

    if (!text || text.trim().length < 50) {
      return Response.json({ error: 'النص قصير جداً أو فارغ' }, { status: 400 })
    }

    const supabase = createServiceClient()

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
    const userRole = session.user.app_metadata?.user_role || ''
    const userHospitalId = session.user.app_metadata?.user_hospital_id || ''

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
