'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/Sidebar'
import Link from 'next/link'
import NotificationsDropdown from '@/components/NotificationsDropdown'

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
      if (!pathname.startsWith(allowedPath) && !pathname.startsWith('/archive')) {
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
      <div className="app-layout">
        {/* Skeleton Sidebar */}
        <div className="sidebar" style={{ opacity: 0.7 }}>
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon skeleton" style={{ width: 42, height: 42, borderRadius: 8, background: 'var(--border)' }}></div>
            <div className="sidebar-logo-text" style={{ flex: 1, gap: 8, display: 'flex', flexDirection: 'column' }}>
              <div className="skeleton" style={{ height: 16, width: '80%', background: 'var(--border)', borderRadius: 4 }}></div>
              <div className="skeleton" style={{ height: 10, width: '50%', background: 'var(--border)', borderRadius: 4 }}></div>
            </div>
          </div>
          <div className="sidebar-nav" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 24 }}>
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="skeleton" style={{ height: 20, width: '100%', background: 'var(--border)', borderRadius: 4 }}></div>
            ))}
          </div>
        </div>
        
        <div className="main-content">
          {/* Skeleton Header */}
          <header className="header" style={{ opacity: 0.7 }}>
            <div className="skeleton" style={{ height: 24, width: 200, background: 'var(--border)', borderRadius: 4 }}></div>
          </header>
          <main className="page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="loading-spinner" />
          </main>
        </div>
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

          <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {profile && <NotificationsDropdown profile={profile} />}
            
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
