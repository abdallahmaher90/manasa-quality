'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/Sidebar'
import Link from 'next/link'

const pageTitles = {
  '/dashboard': 'الرئيسية',
  '/recurring': 'السلبيات المتكررة (مجمعة بالأقسام)',
  '/hospitals': 'المستشفيات',
  '/upload': 'رفع تقرير جديد',
  '/archive': 'أرشيف التقارير',
  '/cross-report': 'تقرير مقارن',
  '/statistics': 'الإحصائيات',
}

export default function AppLayout({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      router.push('/')
      return
    }
    setUser(authUser)

    // Fetch user profile
    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .single()

    setProfile(profileData)
    setLoading(false)
  }

  useEffect(() => {
    if (!profile) return
    if (profile.role === 'hospital_member') {
      const allowedPath = `/hospitals/${profile.hospital_id}`
      if (!pathname.startsWith(allowedPath)) {
        router.push(allowedPath)
      }
    }
  }, [pathname, profile, router])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const getPageTitle = () => {
    // Check exact match first
    if (pageTitles[pathname]) return pageTitles[pathname]
    // Check prefix matches
    for (const [path, title] of Object.entries(pageTitles)) {
      if (pathname.startsWith(path + '/')) return title
    }
    return 'منصة الجودة'
  }

  if (loading) {
    return (
      <div className="loading-state" style={{ minHeight: '100vh' }}>
        <div className="loading-spinner" />
        <span>جاري التحقق من الهوية...</span>
      </div>
    )
  }

  return (
    <div className="app-layout">
      {/* Mobile Overlay */}
      <div 
        className={`mobile-overlay ${isSidebarOpen ? 'active' : ''}`} 
        onClick={() => setIsSidebarOpen(false)}
      ></div>

      <Sidebar user={profile} isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      
      <div className="main-content">
        {/* Header */}
        <header className="header">
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button 
              className="mobile-menu-btn no-print" 
              onClick={() => setIsSidebarOpen(true)}
            >
              ☰
            </button>
            <div>
              <div className="header-title">{getPageTitle()}</div>
              <div className="header-breadcrumb">
                <span>🏠 منصة الجودة</span>
                <span>›</span>
                <span>{getPageTitle()}</span>
              </div>
            </div>
          </div>

          <div className="header-actions">
            {profile?.role !== 'hospital_member' && (
              <Link href="/upload" className="btn btn-primary btn-sm no-print" id="header-upload-btn">
                <span>📤</span>
                رفع تقرير
              </Link>
            )}
            <button
              id="header-logout-btn"
              onClick={handleLogout}
              className="btn btn-ghost btn-sm no-print"
            >
              <span>🚪</span>
              خروج
            </button>
          </div>
        </header>

        {/* Main Page Content */}
        <main className="page-content">
          {children}
        </main>
      </div>
    </div>
  )
}
