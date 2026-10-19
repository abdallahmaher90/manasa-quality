import { createServiceClient, supabase as supabaseClient } from '@/lib/supabase'
import { ImprovementProjectsService } from '@/services/improvement-projects.service'

export const dynamic = 'force-dynamic'

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

  const isDirectorate = ['directorate_admin', 'directorate_member'].includes(profile?.role)
  if (!isDirectorate) {
    return { error: 'هذا القسم مخصص لأعضاء إدارة الجودة بالمديرية فقط', status: 403 }
  }

  return { user, profile }
}

export async function GET(request, { params }) {
  try {
    const auth = await checkDirectorateAuth(request)
    if (auth.error) return Response.json({ error: auth.error }, { status: auth.status })

    const { id } = await params
    const service = new ImprovementProjectsService()
    const project = await service.getProjectById(id)

    if (!project) return Response.json({ error: 'المشروع غير موجود' }, { status: 404 })
    return Response.json({ success: true, project })
  } catch (error) {
    console.error('Error fetching project:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}

export async function PATCH(request, { params }) {
  try {
    const auth = await checkDirectorateAuth(request)
    if (auth.error) return Response.json({ error: auth.error }, { status: auth.status })

    const { id } = await params
    const updates = await request.json()

    const service = new ImprovementProjectsService()
    const updated = await service.updateProject(id, updates)

    return Response.json({ success: true, project: updated })
  } catch (error) {
    console.error('Error updating project:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  try {
    const auth = await checkDirectorateAuth(request)
    if (auth.error) return Response.json({ error: auth.error }, { status: auth.status })

    const { id } = await params
    const service = new ImprovementProjectsService()
    await service.deleteProject(id)

    return Response.json({ success: true, message: 'تم حذف المشروع بنجاح' })
  } catch (error) {
    console.error('Error deleting project:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
