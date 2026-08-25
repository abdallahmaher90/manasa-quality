'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

export default function ArchivePage() {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterHospital, setFilterHospital] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [hospitals, setHospitals] = useState([])
  const [user, setUser] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    fetchUser()
    fetchReports()
    fetchHospitals()
  }, [])

  const fetchUser = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (authUser) {
      const { data } = await supabase.from('profiles').select('*').eq('id', authUser.id).single()
      setUser(data)
    }
  }

  const fetchReports = async () => {
    const { data } = await supabase
      .from('reports')
      .select(`
        id, inspection_date, inspector_name, file_name, created_at,
        hospitals(id, name, governorate)
      `)
      .order('inspection_date', { ascending: false })
    setReports(data || [])
    setLoading(false)
  }

  const fetchHospitals = async () => {
    const { data } = await supabase.from('hospitals').select('id, name').order('name')
    setHospitals(data || [])
  }

  const filtered = reports.filter(r => {
    const matchSearch = !search ||
      r.hospitals?.name?.includes(search) ||
      r.inspector_name?.includes(search)
    const matchHospital = !filterHospital || r.hospitals?.id === filterHospital
    
    let matchDate = true
    if (startDate || endDate) {
      const reportDate = new Date(r.inspection_date)
      reportDate.setHours(0,0,0,0) // Normalize to start of day
      
      if (startDate) {
        const sDate = new Date(startDate)
        sDate.setHours(0,0,0,0)
        if (sDate > reportDate) matchDate = false
      }
      if (endDate) {
        const eDate = new Date(endDate)
        eDate.setHours(23,59,59,999)
        if (eDate < reportDate) matchDate = false
      }
    }

    return matchSearch && matchHospital && matchDate
  })

  const groupedByMonth = filtered.reduce((acc, r) => {
    const date = new Date(r.inspection_date)
    const key = date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long' })
    if (!acc[key]) acc[key] = []
    acc[key].push(r)
    return acc
  }, {})

  const formatDate = (d) => new Date(d).toLocaleDateString('ar-EG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  const handleDeleteReport = async (reportId) => {
    if (!window.confirm('⚠️ هل أنت متأكد من مسح هذا التقرير؟\nسيتم مسح جميع السلبيات المرتبطة به نهائياً ولن تظهر للمستشفى.')) return
    
    setDeletingId(reportId)
    try {
      // 1. Delete associated findings first
      await supabase.from('findings').delete().eq('report_id', reportId)
      
      // 2. Delete the report
      const { error } = await supabase.from('reports').delete().eq('id', reportId)
      if (error) throw error
      
      // 3. Remove from UI
      setReports(prev => prev.filter(r => r.id !== reportId))
    } catch (err) {
      alert('حدث خطأ أثناء المسح: ' + err.message)
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) return <div className="loading-state"><div className="loading-spinner" /><span>تحميل الأرشيف...</span></div>

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
          <input
            id="archive-search"
            type="text"
            className="form-input"
            placeholder="بحث عن منشأة أو قائم بالمرور..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>🔍</span>
        </div>
        <select
          id="archive-filter-hospital"
          className="form-select"
          style={{ width: 'auto', minWidth: 150 }}
          value={filterHospital}
          onChange={(e) => setFilterHospital(e.target.value)}
        >
          <option value="">كل المنشآت</option>
          {hospitals.map(h => (
            <option key={h.id} value={h.id}>{h.name}</option>
          ))}
        </select>
        
        <div style={{ display: 'flex', gap: 'var(--space-xs)', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>من</span>
          <input
            type="date"
            className="form-input"
            style={{ width: 'auto', padding: '6px 12px' }}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>إلى</span>
          <input
            type="date"
            className="form-input"
            style={{ width: 'auto', padding: '6px 12px' }}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <div className="badge badge-neutral" style={{ fontSize: 14, padding: '8px 16px', display: 'flex', alignItems: 'center' }}>
          {filtered.length} تقرير
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">🗂️</span>
          <div className="empty-state-title">لا توجد تقارير بعد</div>
          <p className="empty-state-desc">ابدأ برفع أول تقرير مرور ليظهر في الأرشيف هنا</p>
          <Link href="/upload" className="btn btn-primary">📤 رفع تقرير</Link>
        </div>
      ) : (
        <div>
          {Object.entries(groupedByMonth).map(([month, monthReports]) => (
            <div key={month} style={{ marginBottom: 'var(--space-xl)' }}>
              <div style={{
                fontSize: 13, fontWeight: 700, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: 1,
                marginBottom: 'var(--space-md)',
                display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
              }}>
                <div style={{ height: 1, flex: 1, background: 'var(--border)' }} />
                📅 {month}
                <div style={{ height: 1, flex: 1, background: 'var(--border)' }} />
              </div>
              {monthReports.map(report => (
                <div key={report.id} className="archive-item" id={`report-${report.id}`}>
                  <div className="archive-date">
                    <div className="archive-day">{new Date(report.inspection_date).getDate()}</div>
                    <div className="archive-month">
                      {new Date(report.inspection_date).toLocaleDateString('ar-EG', { month: 'short' })}
                    </div>
                  </div>
                  <div className="archive-info">
                    <div className="archive-hospital">{report.hospitals?.name}</div>
                    <div className="archive-inspector">
                      👤 {report.inspector_name} &nbsp;|&nbsp;
                      📍 {report.hospitals?.governorate} &nbsp;|&nbsp;
                      📅 {formatDate(report.inspection_date)}
                    </div>
                    {report.file_name && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        📎 {report.file_name}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-sm)', flexShrink: 0 }}>
                    {user?.role && ['directorate_admin', 'directorate_member'].includes(user.role) && (
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDeleteReport(report.id)}
                        disabled={deletingId === report.id}
                        title="مسح التقرير وسلبياته"
                      >
                        {deletingId === report.id ? '...' : '🗑️'}
                      </button>
                    )}
                    <Link
                      href={`/archive/${report.id}`}
                      className="btn btn-ghost btn-sm"
                      id={`view-report-${report.id}`}
                    >
                      👁️ عرض
                    </Link>
                    <Link
                      href={`/archive/${report.id}/print`}
                      className="btn btn-accent btn-sm"
                      id={`print-report-${report.id}`}
                    >
                      🖨️ طباعة
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
