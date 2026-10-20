'use client'
import { useState, useEffect, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

const DOMAIN_FILTERS = [
  { key: 'all', label: 'كل البلاغات', icon: '🌐', color: 'var(--primary)' },
  { key: 'facility_equipment', label: 'الأجهزة والمرافق', icon: '⚙️', color: '#d97706' },
  { key: 'clinical_operations', label: 'كفاءة العمل والبروتوكولات', icon: '📋', color: '#475569' },
  { key: 'medical_records', label: 'السجلات الطبية والتوثيق', icon: '📁', color: '#2563eb' },
  { key: 'infection_control', label: 'مكافحة العدوى والتعقيم', icon: '🦠', color: '#059669' },
  { key: 'critical_care', label: 'النتائج الحرجة والطوارئ', icon: '🚨', color: '#e11d48' },
  { key: 'patient_safety', label: 'سلامة وأمان المرضى', icon: '🛡️', color: '#dc2626' },
  { key: 'medication_safety', label: 'سلامة وإدارة الأدوية', icon: '💊', color: '#7c3aed' },
]

export default function HospitalOVRPage() {
  const { id } = useParams()
  const router = useRouter()
  const [hospital, setHospital] = useState(null)
  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState(null)
  const [records, setRecords] = useState([])
  const [selectedDomain, setSelectedDomain] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 35

  useEffect(() => {
    loadHospitalData()
  }, [id])

  const loadHospitalData = async () => {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {}

      // Check user role & strict hospital isolation
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: prof } = await supabase.from('profiles').select('role, hospital_id').eq('id', user.id).single()
        if (prof) {
          setUserRole(prof.role)
          if (prof.role === 'hospital_member' && prof.hospital_id && prof.hospital_id !== id) {
            // Strictly forbid opening other hospitals' OVR, redirect to user's assigned hospital!
            router.replace(`/hospitals/${prof.hospital_id}/ovr`)
            return
          }
        }
      }

      const { data: hosp } = await supabase.from('hospitals').select('*').eq('id', id).single()
      setHospital(hosp)

      const res = await fetch(`/api/ovr?hospitalId=${id}&limit=4000`, { headers: authHeaders })
      if (res.ok) {
        const data = await res.json()
        setRecords(data.records || [])
      }
    } catch (e) {
      console.error('Error loading hospital OVR:', e)
    } finally {
      setLoading(false)
    }
  }

  // Filter records
  const filteredRecords = useMemo(() => {
    let list = records
    if (selectedDomain !== 'all') {
      list = list.filter(r => r.domain_key === selectedDomain)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(r => 
        (r.description && r.description.toLowerCase().includes(q)) ||
        (r.subcategory && r.subcategory.toLowerCase().includes(q))
      )
    }
    return list
  }, [records, selectedDomain, searchQuery])

  // Domain breakdown
  const domainCounts = useMemo(() => {
    const counts = {}
    records.forEach(r => {
      counts[r.domain_key] = (counts[r.domain_key] || 0) + 1
    })
    return counts
  }, [records])

  // Pagination
  const totalPages = Math.ceil(filteredRecords.length / pageSize)
  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredRecords.slice(start, start + pageSize)
  }, [filteredRecords, page, pageSize])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* Header */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '20px 24px',
        boxShadow: 'var(--shadow-sm)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: 48, height: 48, borderRadius: '8px',
            background: 'rgba(239, 68, 68, 0.1)', color: '#dc2626',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '24px', flexShrink: 0
          }}>🚨</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 style={{ fontSize: '20px', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                بلاغات الحوادث العارضة (OVR)
              </h1>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>- {hospital?.name || 'جاري التحميل...'}</span>
            </div>
            <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '13px' }}>
              إجمالي {records.length} بلاغ مسجل للمنشأة منذ بداية عام 2026
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <Link href={`/hospitals/${id}`} className="btn btn-secondary btn-sm" style={{ padding: '6px 14px' }}>
            ← العودة للمستشفى
          </Link>
          {userRole !== 'hospital_member' && (
            <Link href="/ovr" className="btn btn-ghost btn-sm" style={{ padding: '6px 14px' }}>
              🌐 كل المستشفيات
            </Link>
          )}
        </div>
      </div>

      {/* Domain Tabs */}
      <div style={{
        display: 'flex',
        gap: '8px',
        overflowX: 'auto',
        paddingBottom: '4px',
        scrollbarWidth: 'thin'
      }}>
        {DOMAIN_FILTERS.map(dom => {
          const isActive = selectedDomain === dom.key
          const count = dom.key === 'all' ? records.length : (domainCounts[dom.key] || 0)
          if (count === 0 && dom.key !== 'all') return null

          return (
            <button
              key={dom.key}
              onClick={() => { setSelectedDomain(dom.key); setPage(1); }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                borderRadius: '30px',
                fontSize: '13px',
                fontWeight: isActive ? 800 : 600,
                border: isActive ? `2px solid ${dom.color}` : '1px solid var(--border)',
                background: isActive ? (dom.key === 'all' ? 'var(--primary)' : dom.color) : 'var(--bg-card)',
                color: isActive ? '#ffffff' : 'var(--text-main)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease'
              }}
            >
              <span>{dom.icon}</span>
              <span>{dom.label}</span>
              <span style={{
                background: isActive ? 'rgba(255,255,255,0.25)' : 'var(--bg-input)',
                color: isActive ? '#ffffff' : 'var(--text-muted)',
                padding: '1px 8px',
                borderRadius: '12px',
                fontSize: '11px',
                fontWeight: 700
              }}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Search Input */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <input
          type="text"
          className="form-input"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          placeholder="🔍 ابحث في بلاغات هذه المنشأة..."
          style={{ width: '100%', maxWidth: '400px', padding: '9px 14px', borderRadius: '8px', fontSize: '13px' }}
        />
        <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', fontWeight: 600 }}>
          عرض <strong>{paginated.length}</strong> من <strong>{filteredRecords.length}</strong> بلاغ
        </div>
      </div>

      {/* Record Cards */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <div className="loading-spinner" style={{ margin: '0 auto 16px' }} />
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>جاري تحميل بلاغات الـ OVR للمنشأة...</p>
        </div>
      ) : filteredRecords.length === 0 ? (
        <div className="empty-state" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', padding: '40px 20px' }}>
          <span className="empty-state-icon" style={{ fontSize: '36px' }}>📭</span>
          <div className="empty-state-title" style={{ fontSize: '15px', fontWeight: 700 }}>لا توجد بلاغات تطابق البحث</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {paginated.map((r, idx) => (
            <div
              key={r.id || idx}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRight: `4px solid ${r.domain_color || 'var(--primary)'}`,
                borderRadius: '8px',
                padding: '14px 18px',
                boxShadow: 'var(--shadow-sm)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    color: r.domain_color || 'var(--primary)',
                    background: `${r.domain_color}18`,
                    padding: '3px 10px',
                    borderRadius: '12px'
                  }}>
                    {r.domain_icon} {r.domain_label}
                  </span>
                  <span style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    background: 'var(--bg-input)',
                    padding: '3px 10px',
                    borderRadius: '6px'
                  }}>
                    📂 {r.subcategory}
                  </span>
                </div>
                <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', direction: 'ltr', fontFamily: 'monospace' }}>
                  📅 {r.date}
                </div>
              </div>

              <div style={{ fontSize: '13.5px', lineHeight: 1.6, color: 'var(--text-main)', fontWeight: 500, whiteSpace: 'pre-line' }}>
                {r.description}
              </div>
            </div>
          ))}

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', padding: '16px 0' }}>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => { setPage(p => p - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              >
                ← السابق
              </button>
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                صفحة {page} من {totalPages}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page >= totalPages}
                onClick={() => { setPage(p => p + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              >
                التالي →
              </button>
            </div>
          )}
        </div>
      )}

    </div>
  )
}
