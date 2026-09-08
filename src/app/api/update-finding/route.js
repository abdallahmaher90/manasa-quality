import { createServerClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase'
import { cookies } from 'next/headers'

export async function POST(request) {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {}
          },
        },
      }
    )
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return Response.json({ error: 'غير مصرح لك' }, { status: 401 })
    }

    const userRole = user.app_metadata?.user_role || ''
    const userHospitalId = user.app_metadata?.user_hospital_id || ''
    const isDirectorate = userRole === 'directorate_admin' || userRole === 'directorate_member'

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
          resolution_note: note,
          resolved_date: new Date().toISOString().split('T')[0],
          resolved_by: 'hospital',
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
    const supabaseAdmin = createServiceClient()
    const { error } = await supabaseAdmin
      .from('report_findings')
      .update(updateData)
      .eq('id', findingId)
      // Manually enforce hospital boundary since we bypass RLS
      .eq(isDirectorate ? 'id' : 'hospital_id', isDirectorate ? findingId : userHospitalId)

    if (error) throw new Error(error.message)

    return Response.json({ success: true })
  } catch (error) {
    console.error('Update finding error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
