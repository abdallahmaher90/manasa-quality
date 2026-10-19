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

export async function GET(request) {
  try {
    const auth = await checkDirectorateAuth(request)
    if (auth.error) return Response.json({ error: auth.error }, { status: auth.status })

    const { searchParams } = new URL(request.url)
    const hospitalId = searchParams.get('hospitalId')
    const status = searchParams.get('status')
    const priority = searchParams.get('priority')

    const service = new ImprovementProjectsService()
    const projects = await service.getProjects({ hospitalId, status, priority })

    return Response.json({ success: true, projects })
  } catch (error) {
    console.error('Error fetching improvement projects:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const auth = await checkDirectorateAuth(request)
    if (auth.error) return Response.json({ error: auth.error }, { status: auth.status })

    const body = await request.json()
    if (!body.hospital_id || !body.title) {
      return Response.json({ error: 'اسم المستشفى وعنوان المشروع مطلوبان' }, { status: 400 })
    }

    const service = new ImprovementProjectsService()
    const saved = await service.saveProject({
      ...body,
      created_by: auth.profile.full_name || auth.user.email
    })

    return Response.json({ success: true, project: saved })
  } catch (error) {
    console.error('Error creating improvement project:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
