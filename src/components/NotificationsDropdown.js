'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

export default function NotificationsDropdown({ profile }) {
  const [isOpen, setIsOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const dropdownRef = useRef(null)
  const router = useRouter()

  useEffect(() => {
    if (profile) {
      fetchNotifications()
    }
  }, [profile])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const fetchNotifications = async () => {
    try {
      const params = new URLSearchParams()
      if (profile.role) params.append('role', profile.role)
      if (profile.hospital_id) params.append('hospital_id', profile.hospital_id)
      params.append('user_id', profile.id)

      const res = await fetch(`/api/notifications?${params.toString()}`)
      const data = await res.json()
      if (data.notifications) {
        setNotifications(data.notifications)
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err)
    } finally {
      setLoading(false)
    }
  }

  const markAsRead = async (id, link) => {
    // Optimistic UI update
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
    
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      })
    } catch (err) {
      console.error('Failed to mark read', err)
    }

    if (link) {
      setIsOpen(false)
      router.push(link)
    }
  }

  const unreadCount = notifications.filter(n => !n.is_read).length

  return (
    <div className="notifications-wrapper" ref={dropdownRef} style={{ position: 'relative' }}>
      <button 
        className="btn btn-ghost btn-sm no-print" 
        onClick={() => setIsOpen(!isOpen)}
        style={{ position: 'relative', fontSize: '1.2rem', padding: '8px' }}
        title="الإشعارات"
      >
        🔔
        {unreadCount > 0 && (
          <span 
            className="badge badge-danger" 
            style={{ 
              position: 'absolute', top: -5, right: -5, 
              background: 'var(--danger)', color: 'white', 
              borderRadius: '50%', width: 20, height: 20, 
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.7rem', fontWeight: 'bold'
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div 
          className="notifications-dropdown glass-card" 
          style={{
            position: 'absolute', top: '100%', left: 0, 
            width: '320px', maxHeight: '400px', overflowY: 'auto',
            zIndex: 1000, marginTop: '10px',
            borderRadius: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)'
          }}
        >
          <div style={{ padding: '15px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.1rem' }}>الإشعارات</h4>
            {unreadCount > 0 && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{unreadCount} غير مقروء</span>}
          </div>

          <div style={{ padding: '10px' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>جاري التحميل...</div>
            ) : notifications.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>لا توجد إشعارات حالياً</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {notifications.map(n => (
                  <div 
                    key={n.id} 
                    onClick={() => markAsRead(n.id, n.link)}
                    style={{
                      padding: '12px',
                      borderRadius: '8px',
                      background: n.is_read ? 'transparent' : 'var(--bg-secondary)',
                      borderLeft: n.is_read ? 'none' : `4px solid ${n.type === 'deadline_warning' ? 'var(--danger)' : 'var(--primary)'}`,
                      cursor: n.link ? 'pointer' : 'default',
                      transition: 'background 0.2s',
                    }}
                    className="notification-item"
                  >
                    <div style={{ fontWeight: 'bold', color: n.type === 'deadline_warning' ? 'var(--danger)' : 'var(--text-main)', fontSize: '0.95rem', marginBottom: '4px' }}>
                      {n.title}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                      {n.message}
                    </div>
                    {n.created_at && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '8px', textAlign: 'left', direction: 'ltr' }}>
                        {new Date(n.created_at).toLocaleString('ar-EG')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
