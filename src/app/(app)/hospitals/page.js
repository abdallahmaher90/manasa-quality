'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

const DEPT_ICONS = {
  'الداخلي': '🏥', 'الباطنة': '🏥', 'العناية': '🫀', 'طوارئ': '🚨',
  'أشعة': '☢️', 'معمل': '🔬', 'صيدلة': '💊', 'جراحة': '🔪', 'عمليات': '🔪',
  'أطفال': '👶', 'نساء': '👩', 'عظام': '🦴', 'مكافحة': '🦠', 'كلى': '🫁',
  'default': '🏨',
}

const getDeptIcon = (name) => {
  for (const [key, icon] of Object.entries(DEPT_ICONS)) {
    if (name?.includes(key)) return icon
  }
  return DEPT_ICONS.default
}

export default function HospitalsPage() {
  const [hospitals, setHospitals] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('total')

  useEffect(() => {
    fetchHospitals()
  }, [])

  const fetchHospitals = async () => {
    const { data } = await supabase
      .from('hospitals')
      .select(`
        id, name, governorate,
        findings!findings_hospital_id_fkey(id, status, repeat_count)
      `)
      .order('name')

    if (data) {
      const processed = data.map(h => {
        const open = h.findings?.filter(f => f.status === 'open').length || 0
        const recurring = h.findings?.filter(f => f.status === 'recurring').length || 0
        const resolved = h.findings?.filter(f => f.status === 'resolved_confirmed').length || 0
        const pendingConfirm = h.findings?.filter(f => f.status === 'resolved_by_hospital').length || 0
        return { ...h, open, recurring, resolved, pendingConfirm, total: open + recurring }
      })
      setHospitals(processed)
    }
    setLoading(false)
  }

  const filteredAndSorted = hospitals
    .filter(h => h.name?.includes(search) || h.governorate?.includes(search))
    .sort((a, b) => {
      if (sortBy === 'total') {
        if (b.total !== a.total) return b.total - a.total
        return b.recurring - a.recurring
      }
      if (sortBy === 'recurring') {
        if (b.recurring !== a.recurring) return b.recurring - a.recurring
        return b.total - a.total
      }
      if (sortBy === 'performance') {
        const aCompliance = a.resolved > 0 ? a.resolved / (a.total + a.resolved) : 0
        const bCompliance = b.resolved > 0 ? b.resolved / (b.total + b.resolved) : 0
        if (bCompliance !== aCompliance) return bCompliance - aCompliance
        return a.total - b.total
      }
      return 0
    })

  const getRiskLevel = (h) => {
    if (h.recurring >= 5 || h.total >= 15) return 'critical'
    if (h.recurring >= 2 || h.total >= 8) return 'high'
    if (h.total >= 3) return 'medium'
    return 'good'
  }

  const getRiskLabel = (level) => ({
    critical: { label: 'حرج', class: 'badge-danger' },
    high: { label: 'مرتفع', class: 'badge-warning' },
    medium: { label: 'متوسط', class: 'badge-primary' },
    good: { label: 'جيد', class: 'badge-success' },
  }[level])

  if (loading) {
    return <div className="loading-state"><div className="loading-spinner" /><span>تحميل المستشفيات...</span></div>
  }

  return (
    <div>
      {/* Search */}
      <div style={{ display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)', alignItems: 'center' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            id="hospital-search"
            type="text"
            className="form-input"
            placeholder="ابحث عن مستشفى..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingRight: 40 }}
          />
          <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
            🔍
          </span>
        </div>
        <div className="badge badge-neutral" style={{ fontSize: 14, padding: '8px 16px' }}>
          {filteredAndSorted.length} منشأة
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>الترتيب:</span>
        <button 
          className={`badge ${sortBy === 'total' ? 'badge-danger' : 'badge-neutral'}`} 
          style={{ cursor: 'pointer', border: 'none', padding: '6px 12px', fontSize: 13, fontWeight: sortBy === 'total' ? 700 : 500 }}
          onClick={() => setSortBy('total')}
        >
          🥇 الأعلى في السلبيات
        </button>
        <button 
          className={`badge ${sortBy === 'recurring' ? 'badge-warning' : 'badge-neutral'}`} 
          style={{ cursor: 'pointer', border: 'none', padding: '6px 12px', fontSize: 13, fontWeight: sortBy === 'recurring' ? 700 : 500 }}
          onClick={() => setSortBy('recurring')}
        >
          🔁 الأكثر تكراراً
        </button>
        <button 
          className={`badge ${sortBy === 'performance' ? 'badge-success' : 'badge-neutral'}`} 
          style={{ cursor: 'pointer', border: 'none', padding: '6px 12px', fontSize: 13, fontWeight: sortBy === 'performance' ? 700 : 500 }}
          onClick={() => setSortBy('performance')}
        >
          ✅ الأفضل أداءً
        </button>
      </div>

      {filteredAndSorted.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">🏥</span>
          <div className="empty-state-title">لا توجد منشآت</div>
          <p className="empty-state-desc">ابدأ برفع أول تقرير مرور لإضافة المنشآت الصحية تلقائياً</p>
          <Link href="/upload" className="btn btn-primary">
            <span>📤</span> رفع تقرير
          </Link>
        </div>
      ) : (
        <div className="hospital-list">
          {filteredAndSorted.map((hospital, idx) => {
            const risk = getRiskLevel(hospital)
            const riskInfo = getRiskLabel(risk)
            const complianceRate = hospital.resolved > 0
              ? Math.round((hospital.resolved / (hospital.total + hospital.resolved)) * 100)
              : 0

            return (
              <Link key={hospital.id} href={`/hospitals/${hospital.id}`} style={{ display: 'block', textDecoration: 'none' }}>
                <div 
                  id={`hospital-${hospital.id}`}
                  style={{ 
                    border: '1px solid var(--border)', 
                    borderRadius: 'var(--radius-sm)', 
                    padding: '8px 12px', 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    background: 'var(--bg-card)', 
                    marginBottom: '8px',
                    borderRight: `4px solid ${riskInfo.class === 'badge-danger' ? 'var(--danger)' : riskInfo.class === 'badge-warning' ? 'var(--warning)' : riskInfo.class === 'badge-primary' ? 'var(--primary)' : 'var(--success)'}`,
                    transition: 'var(--transition)'
                  }}
                  className="hover-card"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-muted)', width: 24, textAlign: 'center' }}>
                      {idx + 1}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-main)' }}>{hospital.name}</span>
                        <span style={{ fontSize: 11, padding: '2px 6px' }} className={`badge ${riskInfo.class}`}>{riskInfo.label}</span>
                        {hospital.pendingConfirm > 0 && (
                          <span style={{ fontSize: 11, padding: '2px 6px' }} className="badge badge-warning">⏳ {hospital.pendingConfirm} للرد</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        📍 {hospital.governorate} &nbsp;|&nbsp; 
                        <span style={{ color: complianceRate >= 70 ? 'var(--success)' : complianceRate >= 40 ? 'var(--warning-dark)' : 'var(--danger)' }}>
                           نسبة الالتزام {complianceRate}%
                        </span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 11, textAlign: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 800, color: 'var(--danger)', fontSize: 16 }}>{hospital.open}</span>
                      <span style={{ color: 'var(--text-muted)' }}>مفتوحة</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 800, color: 'var(--warning-dark)', fontSize: 16 }}>{hospital.recurring}</span>
                      <span style={{ color: 'var(--text-muted)' }}>متكررة</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 800, color: 'var(--success)', fontSize: 16 }}>{hospital.resolved}</span>
                      <span style={{ color: 'var(--text-muted)' }}>محلولة</span>
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
