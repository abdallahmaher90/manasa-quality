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

    let client = null
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      client = createServiceClient()
    } else {
      const authHeader = request.headers.get('authorization')
      if (authHeader) {
        client = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          { global: { headers: { Authorization: authHeader } } }
        )
      } else {
        client = supabase
      }
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
