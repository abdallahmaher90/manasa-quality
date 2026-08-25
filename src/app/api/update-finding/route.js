import { createServiceClient } from '@/lib/supabase'

export async function POST(request) {
  try {
    const { findingId, action, note } = await request.json()
    // action: 'resolve_directorate' | 'resolve_hospital' | 'reject_hospital' | 'mark_recurring'
    const supabase = createServiceClient()

    let updateData = {}

    switch (action) {
      case 'resolve_directorate':
        updateData = {
          status: 'resolved_confirmed',
          resolved_date: new Date().toISOString().split('T')[0],
          resolved_by: 'directorate',
          resolution_note: note,
        }
        break
      case 'resolve_hospital':
        updateData = {
          status: 'resolved_by_hospital',
          hospital_resolution_note: note,
          hospital_resolution_date: new Date().toISOString().split('T')[0],
        }
        break
      case 'reject_hospital':
        // Hospital said resolved, but directorate rejected - mark as recurring
        const { data: f } = await supabase
          .from('findings')
          .select('repeat_count')
          .eq('id', findingId)
          .single()
        updateData = {
          status: 'recurring',
          repeat_count: (f?.repeat_count || 1) + 1,
          resolved_by: null,
        }
        break
      case 'mark_recurring':
        const { data: f2 } = await supabase
          .from('findings')
          .select('repeat_count')
          .eq('id', findingId)
          .single()
        updateData = {
          status: 'recurring',
          repeat_count: (f2?.repeat_count || 1) + 1,
        }
        break
      default:
        return Response.json({ error: 'إجراء غير معروف' }, { status: 400 })
    }

    const { error } = await supabase
      .from('findings')
      .update(updateData)
      .eq('id', findingId)

    if (error) throw new Error(error.message)

    return Response.json({ success: true })
  } catch (error) {
    console.error('Update finding error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
