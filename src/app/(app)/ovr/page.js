'use client'
import { useState, useEffect, useMemo } from 'react'
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

export default function OVRPage() {
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)
  const [hospitals, setHospitals] = useState([])
  const [selectedHospitalId, setSelectedHospitalId] = useState('all')
  const [selectedDomain, setSelectedDomain] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 40

  const [summary, setSummary] = useState(null)
  const [records, setRecords] = useState([])

  useEffect(() => {
    initData()
  }, [])

  const initData = async () => {
    setLoading(true)
    try {
      // 1. Get current user and session
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {}

      const { data: { user } } = await supabase.auth.getUser()
      let currentProf = null
      let currentHospId = 'all'

      if (user) {
        const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).single()
        currentProf = prof
        setProfile(prof)
        if (prof?.role === 'hospital_member' && prof?.hospital_id) {
          currentHospId = prof.hospital_id
          setSelectedHospitalId(prof.hospital_id)
        }
      }

      // 2. Fetch Hospitals
      if (currentProf?.role !== 'hospital_member') {
        const { data: hospList } = await supabase.from('hospitals').select('id, name').order('name')
        if (hospList) setHospitals(hospList)
      } else if (currentProf?.hospital_id) {
        const { data: myHosp } = await supabase.from('hospitals').select('id, name').eq('id', currentProf.hospital_id).single()
        if (myHosp) setHospitals([myHosp])
      }

      // 3. Fetch OVR summary with auth
      const sumRes = await fetch('/api/ovr?mode=summary', { headers: authHeaders })
      if (sumRes.ok) {
        const sumData = await sumRes.json()
        setSummary(sumData)
      }

      // 4. Fetch initial records with auth
      await fetchRecords(currentHospId, 'all', '', authHeaders)
    } catch (err) {
      console.error('Failed to init OVR page:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchRecords = async (hospId, domainKey, search, headersOverride = null) => {
    try {
      let headers = headersOverride
      if (!headers) {
        const { data: { session } } = await supabase.auth.getSession()
        headers = session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}
      }

      const params = new URLSearchParams()
      const effectiveHospId = profile?.role === 'hospital_member' ? profile.hospital_id : hospId
      if (effectiveHospId && effectiveHospId !== 'all') params.set('hospitalId', effectiveHospId)
      if (domainKey && domainKey !== 'all') params.set('domain', domainKey)
      if (search) params.set('search', search)
      params.set('limit', '4000') // Fetch all to filter locally fast

      const res = await fetch(`/api/ovr?${params.toString()}`, { headers })
      if (res.ok) {
        const data = await res.json()
        setRecords(data.records || [])
        setPage(1)
      }
    } catch (e) {
      console.error('Error fetching OVR records:', e)
    }
  }

  // Handle hospital change
  const handleHospitalChange = (e) => {
    if (profile?.role === 'hospital_member') return
    const newHospId = e.target.value
    setSelectedHospitalId(newHospId)
    fetchRecords(newHospId, selectedDomain, searchQuery)
  }

  // Handle domain tab change
  const handleDomainChange = (domainKey) => {
    setSelectedDomain(domainKey)
    fetchRecords(selectedHospitalId, domainKey, searchQuery)
  }

  // Handle search
  const handleSearchChange = (e) => {
    const q = e.target.value
    setSearchQuery(q)
    fetchRecords(selectedHospitalId, selectedDomain, q)
  }

  // Calculate current scope statistics
  const currentHospitalSummary = useMemo(() => {
    if (!summary) return null
    if (selectedHospitalId === 'all') {
      return {
        total: summary.total_records || 3532,
        domains: summary.by_domain || {},
        latest: summary.date_max || '2026-10-20'
      }
    }
    const hospInfo = summary.by_hospital?.[selectedHospitalId]
    return hospInfo ? {
      total: hospInfo.count,
      domains: hospInfo.domains,
      latest: hospInfo.latest_incident_date
    } : { total: records.length, domains: {}, latest: '-' }
  }, [summary, selectedHospitalId, records])

  // Dynamic top domain
  const topDomainInfo = useMemo(() => {
    if (!currentHospitalSummary?.domains) return { label: 'الأجهزة والمرافق', count: 0 }
    let maxK = null
    let maxC = -1
    for (const [k, v] of Object.entries(currentHospitalSummary.domains)) {
      const c = typeof v === 'object' ? (v.count || 0) : v
      if (c > maxC) {
        maxC = c
        maxK = k
      }
    }
    const match = DOMAIN_FILTERS.find(d => d.key === maxK)
    return {
      label: match ? match.label : 'عام',
      count: maxC > 0 ? maxC : 0
    }
  }, [currentHospitalSummary])

  // Paginated records
  const totalPages = Math.ceil(records.length / pageSize)
  const paginatedRecords = useMemo(() => {
    const start = (page - 1) * pageSize
    return records.slice(start, start + pageSize)
  }, [records, page, pageSize])

  const isHospitalMember = profile?.role === 'hospital_member'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* Header & Controls */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '20px 24px',
        boxShadow: 'var(--shadow-sm)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '26px' }}>🚨</span>
              <h1 style={{ fontSize: '22px', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                سجل بلاغات الحوادث العارضة (OVR)
              </h1>
            </div>
            <p style={{ margin: '6px 0 0 0', color: 'var(--text-muted)', fontSize: '13.5px' }}>
              {isHospitalMember 
                ? `سجل بلاغات الحوادث العارضة والاقتراب من الخطر (Near Misses) للمنشأة`
                : 'الرصد الشامل لكافة وقائع وأحداث الخطأ والاقتراب من الخطر (Near Misses) للمستشفيات الـ 18 منذ بداية العام'
              }
            </p>
          </div>

          {/* Hospital Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)' }}>المنشأة:</span>
            {isHospitalMember ? (
              <span style={{
                background: 'rgba(30, 64, 175, 0.08)',
                color: 'var(--primary)',
                padding: '6px 14px',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '13.5px',
                border: '1px solid rgba(30, 64, 175, 0.2)'
              }}>
                🏥 {hospitals.find(h => h.id === profile?.hospital_id)?.name || 'المستشفى الخاص بك'}
              </span>
            ) : (
              <select
                value={selectedHospitalId}
                onChange={handleHospitalChange}
                className="form-input"
                style={{
                  minWidth: '240px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '13.5px',
                  background: 'var(--bg-input)'
                }}
              >
                <option value="all">🌐 كل المستشفيات (3,532 بلاغ)</option>
                {hospitals.map(h => {
                  const cnt = summary?.by_hospital?.[h.id]?.count || 0
                  return (
                    <option key={h.id} value={h.id}>
                      {h.name} ({cnt} بلاغ)
                    </option>
                  )
                })}
              </select>
            )}
          </div>
        </div>

        {/* Quick KPI Strip */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '12px',
          paddingTop: '16px',
          borderTop: '1px solid var(--border)'
        }}>
          <div style={{
            background: 'var(--bg-primary)',
            padding: '12px 16px',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <span style={{ fontSize: '24px' }}>📊</span>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>إجمالي البلاغات بالنطاق</div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--primary)' }}>
                {currentHospitalSummary?.total?.toLocaleString('ar-EG') || 0} بلاغ
              </div>
            </div>
          </div>

          <div style={{
            background: 'var(--bg-primary)',
            padding: '12px 16px',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <span style={{ fontSize: '24px' }}>⚙️</span>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>أعلى مجال تسجيلاً للبلاغات</div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#d97706' }}>
                {topDomainInfo.label} ({topDomainInfo.count} بلاغ)
              </div>
            </div>
          </div>

          <div style={{
            background: 'var(--bg-primary)',
            padding: '12px 16px',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <span style={{ fontSize: '24px' }}>📅</span>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>تاريخ أحدث بلاغ مسجل</div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-main)', direction: 'ltr', textAlign: 'right' }}>
                {currentHospitalSummary?.latest || '2026-10-20'}
              </div>
            </div>
          </div>

          <div style={{
            background: 'var(--bg-primary)',
            padding: '12px 16px',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <span style={{ fontSize: '24px' }}>🔍</span>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>تطابق الأدلة الجنائية (QIP)</div>
              <div style={{ fontSize: '14px', fontWeight: 800, color: '#059669' }}>
                جاهز للمضاهاة مع المرور والشيت
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Domain Navigation Tabs */}
      <div style={{
        display: 'flex',
        gap: '8px',
        overflowX: 'auto',
        paddingBottom: '4px',
        scrollbarWidth: 'thin'
      }}>
        {DOMAIN_FILTERS.map(dom => {
          const isActive = selectedDomain === dom.key
          let count = 0
          if (dom.key === 'all') {
            count = currentHospitalSummary?.total || records.length
          } else {
            if (selectedHospitalId === 'all') {
              count = summary?.by_domain?.[dom.key]?.count || 0
            } else {
              count = currentHospitalSummary?.domains?.[dom.key] || 0
            }
          }

          return (
            <button
              key={dom.key}
              onClick={() => handleDomainChange(dom.key)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '9px 16px',
                borderRadius: '30px',
                fontSize: '13px',
                fontWeight: isActive ? 800 : 600,
                border: isActive ? `2px solid ${dom.color}` : '1px solid var(--border)',
                background: isActive ? (dom.key === 'all' ? 'var(--primary)' : dom.color) : 'var(--bg-card)',
                color: isActive ? '#ffffff' : 'var(--text-main)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
                boxShadow: isActive ? 'var(--shadow-sm)' : 'none'
              }}
            >
              <span>{dom.icon}</span>
              <span>{dom.label}</span>
              <span style={{
                background: isActive ? 'rgba(255,255,255,0.25)' : 'var(--bg-input)',
                color: isActive ? '#ffffff' : 'var(--text-muted)',
                padding: '1px 8px',
                borderRadius: '12px',
                fontSize: '11.5px',
                fontWeight: 700
              }}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Search Bar & Result Status */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '16px',
        flexWrap: 'wrap'
      }}>
        <div style={{ position: 'relative', flex: '1', minWidth: '280px' }}>
          <input
            type="text"
            className="form-input"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="🔍 ابحث في نص وصف البلاغ أو الفئة الفرعية (مثال: عطل ماكينة، سقوط مريض، نقص سرنجات...)"
            style={{
              width: '100%',
              padding: '10px 16px',
              borderRadius: '8px',
              fontSize: '13.5px'
            }}
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); fetchRecords(selectedHospitalId, selectedDomain, ''); }}
              style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                fontSize: '14px'
              }}
            >
              ✕
            </button>
          )}
        </div>

        <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>
          عرض <strong>{paginatedRecords.length}</strong> من إجمالي <strong>{records.length}</strong> بلاغ مطابق
        </div>
      </div>

      {/* Records Table / List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <div className="loading-spinner" style={{ margin: '0 auto 16px' }} />
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>جاري تحميل وفهرسة بلاغات الـ OVR...</p>
        </div>
      ) : records.length === 0 ? (
        <div className="empty-state" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', padding: '48px 24px' }}>
          <span className="empty-state-icon" style={{ fontSize: '42px' }}>📭</span>
          <div className="empty-state-title" style={{ fontSize: '16px', fontWeight: 700 }}>لا توجد بلاغات مطابقة</div>
          <p className="empty-state-desc" style={{ color: 'var(--text-muted)', fontSize: '13.5px' }}>
            جرب تغيير معايير البحث أو اختيار مجال آخر لعرض البلاغات
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {paginatedRecords.map((r, idx) => (
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
                transition: 'transform 0.1s ease',
              }}
            >
              {/* Card Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: r.domain_color || 'var(--primary)',
                    background: `${r.domain_color}18`,
                    padding: '3px 10px',
                    borderRadius: '12px'
                  }}>
                    <span>{r.domain_icon || '📋'}</span>
                    <span>{r.domain_label}</span>
                  </span>

                  <span style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    background: 'var(--bg-input)',
                    padding: '3px 10px',
                    borderRadius: '6px'
                  }}>
                    📂 {r.subcategory || 'حدث عارض'}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '12.5px', color: 'var(--text-muted)' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
                    🏥 {r.hospital_name}
                  </span>
                  <span style={{ direction: 'ltr', fontFamily: 'monospace' }}>
                    📅 {r.date}
                  </span>
                </div>
              </div>

              {/* Incident Description */}
              <div style={{
                fontSize: '14px',
                lineHeight: 1.6,
                color: 'var(--text-main)',
                fontWeight: 500,
                padding: '6px 0',
                whiteSpace: 'pre-line'
              }}>
                {r.description}
              </div>
            </div>
          ))}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '12px',
              padding: '20px 0',
              marginTop: '10px'
            }}>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => { setPage(p => p - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                style={{ padding: '6px 14px' }}
              >
                ← الصفحة السابقة
              </button>

              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                صفحة {page} من {totalPages}
              </span>

              <button
                className="btn btn-secondary btn-sm"
                disabled={page >= totalPages}
                onClick={() => { setPage(p => p + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                style={{ padding: '6px 14px' }}
              >
                الصفحة التالية →
              </button>
            </div>
          )}
        </div>
      )}

    </div>
  )
}
