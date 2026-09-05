import { parseReport } from '@/lib/ai-parser'
import { sanitizeInspectionDate } from '@/lib/utils'
import { createServiceClient } from '@/lib/supabase'

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
    const { text } = await request.json()

    if (!text || text.trim().length < 50) {
      return Response.json({ error: 'النص قصير جداً أو فارغ' }, { status: 400 })
    }

    const result = await parseReport(text)

    if (result) {
      result.inspection_date = sanitizeInspectionDate(result.inspection_date || text)
    }

    // Check for duplicate report
    const supabase = createServiceClient()
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

    return Response.json({ result })
  } catch (error) {
    console.error('Parse report error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
