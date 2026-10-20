import { NextResponse } from 'next/server'
import { ovrService } from '@/services/ovr.service'
import { createServiceClient, supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function authenticateUser(request) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return { error: 'يرجى تسجيل الدخول للوصول إلى هذا القسم', status: 401 }
  }

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return { error: 'رمز الدخول غير صالح أو منتهي الصلاحية', status: 401 }
  }

  const serviceClient = createServiceClient()
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('id, role, hospital_id')
    .eq('id', user.id)
    .single()

  if (!profile) {
    return { error: 'ملف المستخدم غير موجود', status: 403 }
  }

  return { user, profile }
}

export async function GET(request) {
  try {
    const auth = await authenticateUser(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { profile } = auth
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('mode') // 'summary' or 'records'
    const domain = searchParams.get('domain')
    const search = searchParams.get('search') || ''
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '50', 10)

    // Strict Hospital Isolation:
    // If the user is a hospital member, strictly lock them to their assigned hospital only!
    const isHospitalUser = profile.role === 'hospital_member'
    const targetHospitalId = isHospitalUser ? profile.hospital_id : searchParams.get('hospitalId')

    // If hospital user has no assigned hospital, deny access
    if (isHospitalUser && !profile.hospital_id) {
      return NextResponse.json({ error: 'حساب المستخدم غير مربوط بأي مستشفى' }, { status: 403 })
    }

    if (mode === 'summary') {
      const fullSummary = await ovrService.getSummary()

      // If hospital user, filter out all other hospitals from the summary
      if (isHospitalUser) {
        const hospSummary = fullSummary.by_hospital?.[profile.hospital_id] || {
          hospital_id: profile.hospital_id,
          count: 0,
          domains: {}
        }

        // Map domain counts specifically for this hospital
        const filteredDomainSummary = {}
        if (fullSummary.by_domain) {
          for (const [dKey, dInfo] of Object.entries(fullSummary.by_domain)) {
            filteredDomainSummary[dKey] = {
              ...dInfo,
              count: hospSummary.domains?.[dKey] || 0
            }
          }
        }

        return NextResponse.json({
          total_records: hospSummary.count || 0,
          date_min: fullSummary.date_min,
          date_max: fullSummary.date_max,
          hospitals_count: 1,
          by_hospital: {
            [profile.hospital_id]: hospSummary
          },
          by_domain: filteredDomainSummary
        })
      }

      // Directorate users can view the full aggregated summary
      return NextResponse.json(fullSummary)
    }

    // Query records strictly using targetHospitalId
    const result = await ovrService.queryOVR({
      hospitalId: targetHospitalId,
      domain,
      search,
      page,
      limit
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error in /api/ovr:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
