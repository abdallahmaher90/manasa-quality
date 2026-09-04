import { createServiceClient, supabase } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'

export async function POST(request) {
  try {
    const {
      hospitalId,
      director_name,
      director_phone,
      quality_head_name,
      quality_head_phone,
      quality_team
    } = await request.json()

    if (!hospitalId) {
      return Response.json({ error: 'معرف المستشفى مطلوب' }, { status: 400 })
    }

    // Securely check user authorization
    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return Response.json({ error: 'غير مصرح' }, { status: 401 })
    }

    // Verify user identity using anon client
    const userClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user } } = await userClient.auth.getUser()
    
    if (!user) {
      return Response.json({ error: 'غير مصرح' }, { status: 401 })
    }

    // Verify user role/hospital
    const { data: profile } = await userClient
      .from('profiles')
      .select('role, hospital_id')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return Response.json({ error: 'صلاحيات غير كافية' }, { status: 403 })
    }

    // Allow if directorate, OR if hospital_member updating their OWN hospital
    const isDirectorate = ['directorate_admin', 'directorate_member'].includes(profile.role)
    const isOwnHospital = profile.role === 'hospital_member' && profile.hospital_id === hospitalId

    if (!isDirectorate && !isOwnHospital) {
      return Response.json({ error: 'لا تملك صلاحية تعديل هذا المستشفى' }, { status: 403 })
    }

    let client = null
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      client = createServiceClient()
    } else {
      client = userClient
    }

    const { error } = await client
      .from('hospitals')
      .update({
        director_name: director_name ?? '',
        director_phone: director_phone ?? '',
        quality_head_name: quality_head_name ?? '',
        quality_head_phone: quality_head_phone ?? '',
        quality_team: Array.isArray(quality_team) ? quality_team : []
      })
      .eq('id', hospitalId)

    if (error) {
      console.error('Supabase update hospital error:', error)
      throw new Error(error.message)
    }

    return Response.json({ success: true })
  } catch (error) {
    console.error('Update hospital team error:', error)
    return Response.json({ error: error.message || 'حدث خطأ أثناء تحديث البيانات' }, { status: 500 })
  }
}
