'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function UsersPage() {
  const [users, setUsers] = useState([])
  const [hospitals, setHospitals] = useState([])
  const [loading, setLoading] = useState(true)
  const [currentUserRole, setCurrentUserRole] = useState(null)
  
  const [showAddForm, setShowAddForm] = useState(false)
  const [formData, setFormData] = useState({
    full_name: '', email: '', password: '', role: 'hospital_member', hospital_id: ''
  })
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    checkAccessAndFetchData()
  }, [])

  async function checkAccessAndFetchData() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (profile) setCurrentUserRole(profile.role)

    if (profile?.role === 'directorate_admin') {
      await Promise.all([fetchUsers(), fetchHospitals()])
    }
    setLoading(false)
  }

  async function fetchUsers() {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, role, hospitals(name)')
      .order('created_at', { ascending: false })
    
    // Auth users email isn't directly exposed in profiles unless we add it. 
    // We'll just show names and roles.
    setUsers(data || [])
  }

  async function fetchHospitals() {
    const { data } = await supabase.from('hospitals').select('id, name').order('name')
    setHospitals(data || [])
  }

  async function handleAddUser(e) {
    e.preventDefault()
    setSubmitting(true)
    setErrorMsg('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('لا توجد جلسة نشطة')

      const res = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify(formData)
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'حدث خطأ أثناء الإنشاء')

      setShowAddForm(false)
      setFormData({ full_name: '', email: '', password: '', role: 'hospital_member', hospital_id: '' })
      fetchUsers()
      alert('تم إنشاء المستخدم بنجاح!')
    } catch (err) {
      setErrorMsg(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteUser(userId, name) {
    if (!window.confirm(`هل أنت متأكد من حذف المستخدم "${name}" نهائياً؟`)) return

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/users?id=${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'فشل الحذف')
      
      setUsers(users.filter(u => u.id !== userId))
    } catch (err) {
      alert(err.message)
    }
  }

  if (loading) return <div className="loading-state"><div className="loading-spinner"/><span>تحميل...</span></div>

  if (currentUserRole !== 'directorate_admin') {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">⛔</span>
        <div className="empty-state-title">صلاحيات غير كافية</div>
        <p className="empty-state-desc">هذه الصفحة مخصصة لمدير النظام فقط (Directorate Admin).</p>
      </div>
    )
  }

  const roleLabels = {
    'directorate_admin': 'مدير نظام',
    'directorate_member': 'فريق المديرية',
    'hospital_member': 'مستخدم مستشفى'
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 'var(--space-xl)' }}>
        <div className="card-header" style={{ borderBottom: 'none', paddingBottom: 0 }}>
          <h2 className="card-title">👥 إدارة المستخدمين والصلاحيات</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? 'إلغاء' : '➕ إضافة مستخدم جديد'}
          </button>
        </div>

        {showAddForm && (
          <div style={{ padding: 'var(--space-lg)', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', margin: 'var(--space-md) var(--space-xl)' }}>
            <form onSubmit={handleAddUser} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
              <div className="form-group">
                <label className="form-label">الاسم بالكامل</label>
                <input type="text" required className="form-input" value={formData.full_name} onChange={e => setFormData({...formData, full_name: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">البريد الإلكتروني</label>
                <input type="email" required className="form-input" dir="ltr" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">كلمة المرور (6 أحرف على الأقل)</label>
                <input type="password" required className="form-input" dir="ltr" minLength={6} value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">نوع الصلاحية</label>
                <select className="form-select" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})}>
                  <option value="hospital_member">مستخدم مستشفى (محدود)</option>
                  <option value="directorate_member">فريق المديرية (صلاحيات كاملة)</option>
                  <option value="directorate_admin">مدير نظام (مع إدارة الحسابات)</option>
                </select>
              </div>
              {formData.role === 'hospital_member' && (
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label">اختر المستشفى التابع له</label>
                  <select className="form-select" required value={formData.hospital_id} onChange={e => setFormData({...formData, hospital_id: e.target.value})}>
                    <option value="">-- اختر مستشفى --</option>
                    {hospitals.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                </div>
              )}
              
              {errorMsg && <div className="alert alert-danger" style={{ gridColumn: '1 / -1' }}>{errorMsg}</div>}
              
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 'var(--space-sm)' }}>
                <button type="submit" className="btn btn-success" disabled={submitting}>
                  {submitting ? 'جاري الإنشاء...' : 'حفظ المستخدم'}
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="mobile-table-card" style={{ overflowX: 'auto', padding: 'var(--space-xl)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-muted)', fontSize: 13 }}>
                <th style={{ padding: '12px' }}>الاسم</th>
                <th style={{ padding: '12px' }}>الصلاحية</th>
                <th style={{ padding: '12px' }}>جهة العمل</th>
                <th style={{ padding: '12px', width: 100 }}>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '12px', fontWeight: 700 }}>{u.full_name}</td>
                  <td style={{ padding: '12px' }}>
                    <span className={`badge ${u.role === 'directorate_admin' ? 'badge-danger' : u.role === 'directorate_member' ? 'badge-primary' : 'badge-neutral'}`}>
                      {roleLabels[u.role] || u.role}
                    </span>
                  </td>
                  <td style={{ padding: '12px', color: 'var(--text-muted)' }}>
                    {u.role === 'hospital_member' ? (u.hospitals?.name || 'غير محدد') : 'المديرية'}
                  </td>
                  <td style={{ padding: '12px' }}>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDeleteUser(u.id, u.full_name)} title="حذف المستخدم">
                      🗑️ حذف
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
