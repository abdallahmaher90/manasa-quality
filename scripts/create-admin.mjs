// Create admin user for Manasa platform
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://tuqxtpwtaluynnmconnr.supabase.co'
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1cXh0cHd0YWx1eW5ubWNvbm5yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzUxODEyOSwiZXhwIjoyMTAzMDk0MTI5fQ.rzo1uIXDOfZ90eS0HeiF2HSLFxI2lU9uQ96NrVxdJEI'

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false }
})

async function createAdminUser() {
  console.log('👤 Creating admin user...\n')

  // Create user in auth
  const { data: authUser, error: authErr } = await sb.auth.admin.createUser({
    email: 'admin@manasa.health',
    password: 'Manasa@2026',
    email_confirm: true,
    user_metadata: {
      full_name: 'مدير المديرية',
      role: 'directorate_admin'
    }
  })

  if (authErr) {
    if (authErr.message.includes('already been registered')) {
      console.log('✅ Admin user already exists!')
      console.log('\n📧 Email: admin@manasa.health')
      console.log('🔑 Password: Manasa@2026')
      return
    }
    console.error('❌ Error creating user:', authErr.message)
    return
  }

  console.log('✅ User created:', authUser.user.id)

  // Upsert profile with directorate_admin role
  const { error: profileErr } = await sb.from('profiles').upsert({
    id: authUser.user.id,
    full_name: 'مدير المديرية',
    role: 'directorate_admin',
    hospital_id: null,
  })

  if (profileErr) {
    console.log('Profile note:', profileErr.message)
  } else {
    console.log('✅ Profile created with directorate_admin role')
  }

  console.log('\n🎉 Setup Complete!')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📧 Email:    admin@manasa.health')
  console.log('🔑 Password: Manasa@2026')
  console.log('🌐 URL:      http://localhost:3000')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

createAdminUser()
