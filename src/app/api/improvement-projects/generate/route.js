import { createServiceClient, supabase as supabaseClient } from '@/lib/supabase'
import { ImprovementProjectsService } from '@/services/improvement-projects.service'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function checkDirectorateAuth(request) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader) return { error: 'Unauthorized', status: 401 }

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token)

  if (authError || !user) {
    return { error: 'غير مصرح لك للقيام بهذه العملية', status: 401 }
  }

  const supabase = createServiceClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, hospital_id')
    .eq('id', user.id)
    .single()

  const isDirectorateAdmin = profile?.role === 'directorate_admin'
  if (!isDirectorateAdmin) {
    return { error: 'هذا القسم مخصص لمدير المديرية فقط حالياً قيد المراجعة', status: 403 }
  }

  return { user, profile }
}

export async function POST(request) {
  try {
    const auth = await checkDirectorateAuth(request)
    if (auth.error) return Response.json({ error: auth.error }, { status: auth.status })

    const { hospitalId, focusDepartment, count = 3 } = await request.json()

    if (!hospitalId) {
      return Response.json({ error: 'معرّف المستشفى مطلوب لتوليد مشاريع التحسين' }, { status: 400 })
    }

    const projectCount = Number(count)
    if (!Number.isInteger(projectCount) || projectCount < 1 || projectCount > 3) {
      return Response.json({ error: 'عدد المشاريع يجب أن يكون من 1 إلى 3' }, { status: 400 })
    }
    if (focusDepartment !== null && focusDepartment !== undefined &&
        (typeof focusDepartment !== 'string' || focusDepartment.trim().length > 100)) {
      return Response.json({ error: 'اسم القسم غير صالح' }, { status: 400 })
    }

    const service = new ImprovementProjectsService()
    // Generate a bounded number of drafts, anchored to the selected evidence clusters.
    const projects = await service.generateProjectsForHospital(hospitalId, {
      count: projectCount,
      focusDepartment: focusDepartment?.trim() || null
    })

    return Response.json({
      success: true,
      message: `تم بنجاح توليد ${projects.length} مشاريع تحسين جودة مبنية على الأدلة والتحليل الفعلي للأداء.`,
      projects
    })
  } catch (error) {
    console.error('Error generating improvement projects:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
