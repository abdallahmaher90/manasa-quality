'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navItems = [
  {
    section: 'الرئيسية',
    items: [
      { href: '/dashboard', icon: '📊', label: 'الرئيسية' },
      { href: '/recurring', icon: '🚨', label: 'السلبيات المتكررة' },
      { href: '/hospitals', icon: '🏥', label: 'المستشفيات' },
    ]
  },
  {
    section: 'التقارير',
    items: [
      { href: '/upload', icon: '📤', label: 'رفع تقرير جديد' },
      { href: '/archive', icon: '🗂️', label: 'أرشيف التقارير' },
    ]
  },
  {
    section: 'التحليلات',
    items: [
      { href: '/cross-report', icon: '📋', label: 'تقرير مقارن بالأقسام' },
      { href: '/statistics', icon: '📈', label: 'الإحصائيات' },
    ]
  },
  {
    section: 'إدارة النظام',
    roles: ['directorate_admin', 'directorate_member'],
    items: [
      { href: '/settings', icon: '⚙️', label: 'الإعدادات' },
    ]
  }
]

export default function Sidebar({ user, isOpen, onClose }) {
  const pathname = usePathname()

  const getInitials = (name) => {
    if (!name) return 'م'
    const parts = name.replace('د/', '').replace('د\\', '').trim().split(' ')
    return parts[0]?.[0] || 'م'
  }

  const getRoleLabel = (role) => {
    const labels = {
      directorate_admin: 'مدير المديرية',
      directorate_member: 'عضو فريق المرور',
      hospital_admin: 'مدير جودة المستشفى',
      hospital_member: 'عضو فريق المستشفى',
    }
    return labels[role] || 'مستخدم'
  }

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      <button className="mobile-close-sidebar-btn" onClick={onClose}>✕</button>
      
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">🛡️</div>
        <div className="sidebar-logo-text">
          <span className="sidebar-logo-title">منصة الجودة</span>
          <span className="sidebar-logo-subtitle">إدارة سلامة المرضى</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {navItems.map((section) => {
          if (section.roles && !section.roles.includes(user?.role)) return null
          
          return (
            <div key={section.section} className="sidebar-section">
              <div className="sidebar-section-label">{section.section}</div>
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={`sidebar-link ${pathname === item.href || pathname.startsWith(item.href + '/') ? 'active' : ''}`}
                >
                  <span className="sidebar-link-icon">{item.icon}</span>
                  <span>{item.label}</span>
                  {item.badge && <span className="sidebar-badge">{item.badge}</span>}
                </Link>
              ))}
            </div>
          )
        })}
      </nav>

      {/* User Footer */}
      <div className="sidebar-footer">
        <div className="user-info">
          <div className="user-avatar">
            {getInitials(user?.full_name || 'مستخدم')}
          </div>
          <div>
            <div className="user-name">{user?.full_name || 'مستخدم'}</div>
            <div className="user-role">{getRoleLabel(user?.role)}</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
