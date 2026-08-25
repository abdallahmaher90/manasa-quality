import { NextResponse } from 'next/server'
import { createServiceClient, supabase } from '@/lib/supabase'

export async function POST(request) {
  try {
    // 1. Authenticate the request
    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Missing authorization header' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const serviceClient = createServiceClient()

    // 2. Check if user is directorate_admin
    const { data: profile } = await serviceClient.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || profile.role !== 'directorate_admin') {
      return NextResponse.json({ error: 'Forbidden: Requires directorate_admin role' }, { status: 403 })
    }

    // 3. Parse request body
    const { email, password, full_name, role, hospital_id } = await request.json()
    if (!email || !password || !full_name || !role) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (role === 'hospital_user' && !hospital_id) {
      return NextResponse.json({ error: 'Hospital ID is required for hospital users' }, { status: 400 })
    }

    const serviceClient = createServiceClient()

    // 4. Create user via Admin API
    const { data: newUser, error: createError } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role }
    })

    if (createError) {
      return NextResponse.json({ error: createError.message }, { status: 400 })
    }

    // 5. Insert profile
    const { error: profileError } = await serviceClient.from('profiles').upsert({
      id: newUser.user.id,
      full_name,
      role,
      hospital_id: role === 'hospital_user' ? hospital_id : null
    })

    if (profileError) {
      // Rollback user creation if profile fails
      await serviceClient.auth.admin.deleteUser(newUser.user.id)
      return NextResponse.json({ error: 'Failed to create user profile: ' + profileError.message }, { status: 500 })
    }

    return NextResponse.json({ message: 'User created successfully', user: newUser.user })

  } catch (err) {
    console.error('API Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })

    const serviceClient = createServiceClient()

    const { data: profile } = await serviceClient.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || profile.role !== 'directorate_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const targetUserId = searchParams.get('id')

    if (!targetUserId) return NextResponse.json({ error: 'Missing user ID' }, { status: 400 })
    if (targetUserId === user.id) return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 })

    const serviceClient = createServiceClient()

    // Deleting the user from auth.users will cascade to public.profiles if foreign keys are set up correctly
    // But let's delete profile manually just in case
    await serviceClient.from('profiles').delete().eq('id', targetUserId)
    
    const { error: delError } = await serviceClient.auth.admin.deleteUser(targetUserId)
    if (delError) return NextResponse.json({ error: delError.message }, { status: 500 })

    return NextResponse.json({ message: 'User deleted' })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
