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

    const supabaseAdmin = createServiceClient()

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role, hospital_id')
      .eq('id', user.id)
      .single()

    const userRole = profile?.role || ''
    const userHospitalId = profile?.hospital_id || ''
    const isDirectorate = userRole === 'directorate_admin' || userRole === 'directorate_member'

    // Validate Hospital Identity
    if (!isDirectorate) {
      if (!userHospitalId) {
        return Response.json({ error: 'حساب المستشفى غير مرتبط بمستشفى صالح' }, { status: 403 })
      }
    }

    const { findingId, action, note } = await request.json()
    // action: 'resolve_directorate' | 'resolve_hospital' | 'reject_hospital' | 'mark_recurring'

    let updateData = {}

    switch (action) {
      case 'resolve_directorate':
        if (!isDirectorate) return Response.json({ error: 'صلاحيات غير كافية' }, { status: 403 })
        updateData = {
          status: 'resolved_confirmed',
          resolved_date: new Date().toISOString().split('T')[0],
          resolved_by: 'directorate',
        }
        if (note) updateData.resolution_note = note
        break
      case 'resolve_hospital':
        // Hospital users can do this. Directorate can also do it on behalf of hospital if needed.
        updateData = {
          status: 'resolved_by_hospital',
          hospital_resolution_note: note || null,
          hospital_resolution_date: new Date().toISOString().split('T')[0],
        }
        break
      case 'reject_hospital':
        if (!isDirectorate) return Response.json({ error: 'صلاحيات غير كافية' }, { status: 403 })
        updateData = {
          status: 'open',
          resolved_by: null, 
          resolution_note: null, 
          resolved_date: null,
        }
        break
      case 'mark_recurring':
        if (!isDirectorate) return Response.json({ error: 'صلاحيات غير كافية' }, { status: 403 })
        updateData = { status: 'recurring' }
        break
      default:
        return Response.json({ error: 'إجراء غير معروف' }, { status: 400 })
    }

    // Update using the authenticated client, so RLS guarantees they can only touch allowed rows
    
    let query = supabaseAdmin
      .from('report_findings')
      .update(updateData)
      .eq('id', findingId)

    // Manually enforce hospital boundary since we bypass RLS
    if (isDirectorate) {
      query = query.eq('id', findingId)
    } else {
      query = query.eq('hospital_id', userHospitalId)
    }

    const { data: updatedRows, error } = await query.select('id')

    if (error) throw new Error(error.message)

    if (!updatedRows || updatedRows.length === 0) {
      return Response.json(
        { error: 'السلبية غير موجودة أو لا تملك صلاحية تعديلها' },
        { status: 403 }
      )
    }

    return Response.json({ success: true })
  } catch (error) {
    console.error('Update finding error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
