import { createServiceClient } from '@/lib/supabase-server'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const hospitalId = searchParams.get('hospital_id')
    const userId = searchParams.get('user_id')
    const role = searchParams.get('role')

    const supabase = createServiceClient()

    // 1. Fetch persisted notifications (e.g. New Reports)
    let query = supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)

    if (role === 'hospital_member') {
      if (hospitalId) {
        query = query.eq('hospital_id', hospitalId)
      } else if (userId) {
        query = query.eq('user_id', userId)
      }
    }

    const { data: persistedNotifs, error: notifError } = await query
    
    if (notifError) {
      console.error('Fetch notifs error:', notifError)
    }

    const notifications = persistedNotifs || []

    // 2. Fetch Dynamic "Deadline Approaching" Notifications
    // Only for hospitals (since they need to fix them)
    if (hospitalId || role !== 'hospital_member') {
      
      let findingsQuery = supabase
        .from('findings')
        .select(`
          id, original_text, canonical_text, deadline, hospital_id,
          hospitals(name)
        `)
        .eq('status', 'open')
        .not('deadline', 'is', null)

      if (role === 'hospital_member' && hospitalId) {
        findingsQuery = findingsQuery.eq('hospital_id', hospitalId)
      }

      const { data: activeFindings } = await findingsQuery

      if (activeFindings) {
        const today = new Date()
        today.setHours(0,0,0,0)

        const warningFindings = activeFindings.filter(f => {
          if (!f.deadline) return false
          // Simple DD/MM/YYYY or YYYY-MM-DD parsing
          let dStr = f.deadline.trim()
          let fDate = null
          
          if (dStr.includes('/')) {
            const parts = dStr.split('/')
            if (parts.length === 3) {
              fDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`)
            }
          } else if (dStr.includes('-')) {
            const parts = dStr.split('-')
            if (parts.length === 3) {
               if (parts[0].length === 4) {
                 fDate = new Date(dStr)
               } else {
                 fDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`)
               }
            }
          }

          if (!fDate || isNaN(fDate)) return false

          const diffTime = fDate.getTime() - today.getTime()
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

          // If deadline is within 3 days or already passed
          return diffDays <= 3
        })

        // Inject dynamic notifications
        warningFindings.forEach(wf => {
          notifications.unshift({
            id: `dyn-${wf.id}`, // Fake ID
            hospital_id: wf.hospital_id,
            title: '⚠️ تحذير: موعد نهائي اقترب أو انتهى',
            message: `السلبية: "${wf.canonical_text || wf.original_text}" الخاصة بـ ${wf.hospitals?.name || 'مستشفاك'} مهلتها تنتهي في ${wf.deadline}. يرجى التلافي فوراً!`,
            type: 'deadline_warning',
            is_read: false, // Cannot be read until resolved
            created_at: new Date().toISOString(),
            link: role === 'hospital_member' ? `/hospitals/${wf.hospital_id}` : '/dashboard'
          })
        })
      }
    }

    return Response.json({ notifications })
  } catch (error) {
    console.error('Notifications API Error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}

// Mark as read
export async function PATCH(request) {
  try {
    const { id } = await request.json()
    const supabase = createServiceClient()
    
    // Ignore dynamic notifications
    if (!id || String(id).startsWith('dyn-')) {
      return Response.json({ success: true })
    }

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)

    if (error) throw error

    return Response.json({ success: true })
  } catch (error) {
    console.error('Mark read error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
