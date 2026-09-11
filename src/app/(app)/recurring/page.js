'use client'
import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { useToast } from '@/components/Toast'

export default function RecurringPage() {
  const [recurringData, setRecurringData] = useState({ recurringInSameHospital: [], commonAcrossHospitals: [] })
  const [loading, setLoading] = useState(true)
  const { showToast } = useToast()
  const [refreshing, setRefreshing] = useState(false)
  const [filterStatus, setFilterStatus] = useState('active') // 'active' | 'all' | 'resolved'
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedModalData, setSelectedModalData] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [isDirectorate, setIsDirectorate] = useState(true)
  const [resolvingId, setResolvingId] = useState(null)
  const [resolutionNotes, setResolutionNotes] = useState({})
  
  const [activeTab, setActiveTab] = useState('recurring') // 'recurring' | 'common'

  useEffect(() => {
    fetchFindings()
    checkUserRole()
  }, [])

  const checkUserRole = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
        if (profile) {
          setIsDirectorate(['directorate_admin', 'directorate_member'].includes(profile.role))
        }
      }
    } catch (e) {
      console.warn('Role check failed:', e)
    }
  }

  const handleResolveFinding = async (findingId) => {
    try {
      setResolvingId(findingId)
      const note = resolutionNotes[findingId] || 'تم التأكد من التلافي بواسطة الإدارة'

      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/update-finding', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': session ? `Bearer ${session.access_token}` : ''
        },
        body: JSON.stringify({
          findingId,
          action: 'resolve_directorate',
          note,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'فشل في تحديث السلبية')

      if (selectedModalData) {
        const updatedFindings = selectedModalData.hospital.findings.map((f) =>
          f.id === findingId
            ? { ...f, status: 'resolved_confirmed', resolved_date: new Date().toISOString().split('T')[0], resolution_note: note }
            : f
        )
        setSelectedModalData({
          ...selectedModalData,
          hospital: {
            ...selectedModalData.hospital,
            findings: updatedFindings,
          },
        })
      }

      fetchFindings(true)
    } catch (err) {
      showToast('خطأ: ' + err.message, 'error')
    } finally {
      setResolvingId(null)
    }
  }

  const fetchFindings = async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true)
      else setLoading(true)

      const res = await fetch('/api/analytics/recurring')
      const result = await res.json()

      if (!res.ok) throw new Error(result.error || 'Failed to fetch data')

      setRecurringData(result.data)
      setLastUpdated(new Date().toLocaleTimeString('ar-EG'))
    } catch (err) {
      console.error('Error fetching findings:', err)
      showToast('حدث خطأ أثناء جلب البيانات', 'error')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const activeDataList = activeTab === 'recurring' 
    ? recurringData.recurringInSameHospital 
    : recurringData.commonAcrossHospitals

  // Summary Metrics
  const metrics = useMemo(() => {
    let totalIssues = activeDataList.length
    let activeIssues = 0
    let resolvedIssues = 0
    const uniqueHospitals = new Set()

    activeDataList.forEach((f) => {
      if (f.activeCount > 0) activeIssues++
      if (f.isFullyResolved) resolvedIssues++
      f.hospitalsList.forEach((h) => uniqueHospitals.add(h.id))
    })

    return {
      totalIssues,
      activeIssues,
      resolvedIssues,
      totalHospitalsCount: uniqueHospitals.size,
    }
  }, [activeDataList])

  // Filtered Findings
  const filteredFindings = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()

    return activeDataList.filter((f) => {
      // Status Filter
      if (filterStatus === 'active' && f.activeCount === 0) return false
      if (filterStatus === 'resolved' && !f.isFullyResolved) return false

      // Search Filter
      if (q) {
        const matchesText = f.title.toLowerCase().includes(q)
        const matchesHospital = f.hospitalsList.some((h) => h.name.toLowerCase().includes(q))
        return matchesText || matchesHospital
      }

      return true
    })
  }, [activeDataList, filterStatus, searchTerm])

  if (loading) {
    return (
      <div className="loading-state" style={{ minHeight: '50vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div className="loading-spinner" style={{ width: 44, height: 44 }} />
        <span style={{ fontSize: 16, fontWeight: 600 }}>جاري جلب وتحليل محرك السلبيات...</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      {/* Top Header & Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            🚨 السلبيات المجمعة
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
            رصد السلبيات المتكررة داخل المستشفى الواحدة والسلبيات الشائعة عبر عدة مستشفيات.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {lastUpdated && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              آخر تحديث: {lastUpdated}
            </span>
          )}
          <Link
            href="/recurring/print"
            className="btn btn-primary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, textDecoration: 'none' }}
          >
            🖨️ طباعة تقرير
          </Link>
          <button
            onClick={() => fetchFindings(true)}
            disabled={refreshing}
            className="btn btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}
          >
            {refreshing ? '🔄 جاري التحديث...' : '🔄 تحديث البيانات'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 16, borderBottom: '2px solid var(--border)' }}>
        <button
          onClick={() => setActiveTab('recurring')}
          style={{
            padding: '12px 24px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'recurring' ? '3px solid var(--primary)' : '3px solid transparent',
            color: activeTab === 'recurring' ? 'var(--primary)' : 'var(--text-secondary)',
            fontWeight: activeTab === 'recurring' ? 800 : 600,
            fontSize: 16,
            cursor: 'pointer',
            transition: 'all 0.2s',
            marginBottom: -2,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}
        >
          🏥 السلبيات المتكررة ({recurringData.recurringInSameHospital.length})
        </button>
        <button
          onClick={() => setActiveTab('common')}
          style={{
            padding: '12px 24px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'common' ? '3px solid var(--primary)' : '3px solid transparent',
            color: activeTab === 'common' ? 'var(--primary)' : 'var(--text-secondary)',
            fontWeight: activeTab === 'common' ? 800 : 600,
            fontSize: 16,
            cursor: 'pointer',
            transition: 'all 0.2s',
            marginBottom: -2,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}
        >
          🌍 السلبيات الشائعة ({recurringData.commonAcrossHospitals.length})
        </button>
      </div>

      {/* Real-time KPI Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 'var(--space-sm)' }}>
        <div className="stat-card" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>إجمالي المشاكل</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)' }}>{metrics.totalIssues}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
            {activeTab === 'recurring' ? 'متكررة في نفس المستشفى' : 'شائعة بين المستشفيات'}
          </div>
        </div>

        <div className="stat-card" style={{ background: 'var(--bg-card)', border: '1px solid #fca5a5', borderRadius: 'var(--radius-md)', padding: 16 }}>
          <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 4 }}>⚠️ تتطلب متابعة (نشطة)</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#dc2626' }}>{metrics.activeIssues}</div>
          <div style={{ fontSize: 11, color: '#991b1b', marginTop: 4 }}>لم تُحل في مستشفى أو أكثر</div>
        </div>

        <div className="stat-card" style={{ background: 'var(--bg-card)', border: '1px solid #86efac', borderRadius: 'var(--radius-md)', padding: 16 }}>
          <div style={{ fontSize: 12, color: '#15803d', marginBottom: 4 }}>✅ تم تلافيها بالكامل</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#16a34a' }}>{metrics.resolvedIssues}</div>
          <div style={{ fontSize: 11, color: '#166534', marginTop: 4 }}>تلافتها جميع المستشفيات المتأثرة</div>
        </div>

        <div className="stat-card" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>🏥 المستشفيات المرصودة</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--primary)' }}>{metrics.totalHospitalsCount}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>تشترك في هذه الملاحظات</div>
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, background: 'var(--bg-secondary)', padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => setFilterStatus('active')}
            className={`btn btn-sm ${filterStatus === 'active' ? 'btn-danger' : 'btn-outline'}`}
            style={{ fontWeight: 700, borderRadius: 20, fontSize: 12 }}
          >
            🚨 السلبيات النشطة حالياً ({metrics.activeIssues})
          </button>
          <button
            onClick={() => setFilterStatus('all')}
            className={`btn btn-sm ${filterStatus === 'all' ? 'btn-primary' : 'btn-outline'}`}
            style={{ fontWeight: 700, borderRadius: 20, fontSize: 12 }}
          >
            📋 كافة السلبيات ({metrics.totalIssues})
          </button>
          <button
            onClick={() => setFilterStatus('resolved')}
            className={`btn btn-sm ${filterStatus === 'resolved' ? 'btn-success' : 'btn-outline'}`}
            style={{ fontWeight: 700, borderRadius: 20, fontSize: 12 }}
          >
            ✅ تم تلافيها بالكامل ({metrics.resolvedIssues})
          </button>
        </div>

        <div style={{ position: 'relative', minWidth: 260 }}>
          <input
            type="text"
            className="input"
            placeholder="🔍 بحث باسم السلبية أو المستشفى..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ padding: '6px 12px', fontSize: 13, width: '100%', borderRadius: 8 }}
          />
        </div>
      </div>

      {/* Main Content: Recurring Findings */}
      {filteredFindings.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
            {filterStatus === 'active'
              ? 'ممتاز! لا توجد سلبيات نشطة تتطلب متابعة حالياً.'
              : filterStatus === 'resolved'
              ? 'لا توجد سلبيات تم تلافيها بالكامل بعد.'
              : 'لم يتم العثور على سلبيات مطابقة للبحث.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {filteredFindings.map((f, idx) => (
            <div
              key={idx}
              className={`finding-card ${f.isFullyResolved ? 'resolved_confirmed' : f.activeCount > 0 ? 'recurring' : 'resolved_by_hospital'}`}
              style={{
                background: 'var(--bg-primary)',
                padding: '16px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {/* Title & Badges */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                    {f.title}
                  </div>
                  {f.allDepartments?.length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      🏷️ الأقسام: {f.allDepartments.join('، ')}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: 6,
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    🏥 {f.totalHospitals} مستشفيات ({f.totalOccurrences || f.totalHospitals} رصد)
                  </span>

                  {f.activeCount > 0 && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 6,
                        background: '#fee2e2',
                        color: '#b91c1c',
                      }}
                    >
                      🔴 {f.activeCount} لم يتم التلافي
                    </span>
                  )}

                  {f.pendingCount > 0 && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 6,
                        background: '#fef3c7',
                        color: '#b45309',
                      }}
                    >
                      🟡 {f.pendingCount} أبلغت بالتلافي
                    </span>
                  )}

                  {f.resolvedCount > 0 && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 6,
                        background: '#dcfce7',
                        color: '#15803d',
                      }}
                    >
                      🟢 {f.resolvedCount} تم التلافي
                    </span>
                  )}
                </div>
              </div>

              {/* Hospitals Breakdown Pills */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
                  موقف المستشفيات من هذه السلبية:
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {f.hospitalsList.map((h) => {
                    const isResolved = h.issueStatus === 'resolved'
                    const isPending = h.issueStatus === 'pending'

                    const chipStyle = isResolved
                      ? { bg: '#dcfce7', border: '#86efac', text: '#15803d', icon: '✅' }
                      : isPending
                      ? { bg: '#fef3c7', border: '#fde047', text: '#b45309', icon: '🟡' }
                      : { bg: '#fee2e2', border: '#fca5a5', text: '#b91c1c', icon: '🔴' }

                    return (
                      <div
                        key={h.id}
                        onClick={() => setSelectedModalData({ hospital: h, findingText: f.title, canonicalText: f.canonicalClassification })}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '5px 12px',
                          borderRadius: 100,
                          fontSize: 12,
                          fontWeight: 600,
                          background: chipStyle.bg,
                          border: `1px solid ${chipStyle.border}`,
                          color: chipStyle.text,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                        title="اضغط لعرض تفاصيل المرور ونصوص الملاحظة الأصلية في هذا المستشفى"
                      >
                        <span>{chipStyle.icon}</span>
                        <span>{h.name}</span>
                        {h.repeatCount > 1 && (
                          <span style={{ opacity: 0.8, fontSize: 10, background: 'rgba(0,0,0,0.06)', padding: '1px 5px', borderRadius: 4 }}>
                            🔁 متكررة ×{h.repeatCount}
                          </span>
                        )}
                        {isResolved && h.resolvedDate && (
                          <span style={{ fontSize: 10, opacity: 0.85 }}>({h.resolvedDate})</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Hospital Finding Details Modal */}
      {selectedModalData && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.55)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
          onClick={() => setSelectedModalData(null)}
        >
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              maxWidth: 600,
              width: '100%',
              padding: 24,
              boxShadow: 'var(--shadow-lg)',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  🏥 {selectedModalData.hospital.name}
                </h3>
              </div>

              <button
                className="btn btn-outline btn-sm"
                onClick={() => setSelectedModalData(null)}
                style={{ padding: '4px 10px', fontSize: 12 }}
              >
                ✕ إغلاق
              </button>
            </div>

            <div style={{ background: 'var(--bg-secondary)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>المشكلة الجذرية:</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2, lineHeight: 1.5 }}>
                {selectedModalData.findingText}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
                📋 سجل الرصد في هذا المستشفى ({selectedModalData.hospital.findings.length}):
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {selectedModalData.hospital.findings.map((f, i) => (
                  <div
                    key={i}
                    style={{
                      padding: 12,
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ fontSize: 13, color: 'var(--text-main)', lineHeight: 1.5 }}>
                      <strong>نص التقرير الأصلي:</strong> &ldquo;{f.original_text}&rdquo;
                      <br/>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        🏷️ القسم: {f.departments?.name || 'غير محدد'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      <span>📅 تاريخ الرصد: {f.last_seen_date || f.first_seen_date || 'غير محدد'}</span>
                      <span>🔁 الظهور رقم: {f.repeat_count || 1}</span>
                      <span
                        style={{
                          fontWeight: 700,
                          color: f.status === 'resolved_confirmed' ? 'var(--success)' : f.status === 'resolved_by_hospital' ? 'var(--warning)' : 'var(--danger)',
                        }}
                      >
                        الحالة: {f.status === 'resolved_confirmed' ? '✅ تم التلافي' : f.status === 'resolved_by_hospital' ? '🟡 أبلغت المستشفى بالتلافي' : '🔴 قيد المتابعة'}
                      </span>
                    </div>

                    {f.resolution_note && (
                      <div style={{ fontSize: 11, color: 'var(--success-dark)', background: '#dcfce7', padding: '4px 8px', borderRadius: 4, marginTop: 4 }}>
                        <strong>ملاحظة التلافي:</strong> {f.resolution_note} ({f.resolved_date})
                      </div>
                    )}

                    {f.hospital_resolution_note && (
                      <div style={{ fontSize: 11, color: 'var(--warning-dark)', background: '#fef3c7', padding: '4px 8px', borderRadius: 4, marginTop: 4 }}>
                        <strong>رد المستشفى:</strong> {f.hospital_resolution_note}
                      </div>
                    )}

                    {/* Quick Resolve Action for Directorate */}
                    {isDirectorate && f.status !== 'resolved_confirmed' && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input
                            type="text"
                            placeholder="ملاحظة التلافي (اختياري)..."
                            value={resolutionNotes[f.id] || ''}
                            onChange={(e) => setResolutionNotes({ ...resolutionNotes, [f.id]: e.target.value })}
                            className="input"
                            style={{ flex: 1, padding: '4px 8px', fontSize: 12 }}
                          />
                          <button
                            onClick={() => handleResolveFinding(f.id)}
                            disabled={resolvingId === f.id}
                            className="btn btn-success btn-sm"
                            style={{ padding: '4px 12px', fontSize: 12, whiteSpace: 'nowrap', fontWeight: 700 }}
                          >
                            {resolvingId === f.id ? 'جاري الحفظ...' : '✅ تأكيد التلافي'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <Link
                href={`/hospitals/${selectedModalData.hospital.id}`}
                className="btn btn-outline btn-sm"
                style={{ padding: '6px 14px', fontSize: 13, textDecoration: 'none' }}
              >
                🏥 ملف المستشفى
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
