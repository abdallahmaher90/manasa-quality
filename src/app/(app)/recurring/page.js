'use client'
import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { getCategory } from '@/lib/utils'
import Link from 'next/link'

export default function RecurringPage() {
  const [crossHospitalRecurring, setCrossHospitalRecurring] = useState([])
  const [expandedDept, setExpandedDept] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filterStatus, setFilterStatus] = useState('active') // 'active' | 'all' | 'resolved'
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedModalData, setSelectedModalData] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [isDirectorate, setIsDirectorate] = useState(true)
  const [resolvingId, setResolvingId] = useState(null)
  const [resolutionNotes, setResolutionNotes] = useState({})

  useEffect(() => {
    fetchCrossHospitalFindings()
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

      const res = await fetch('/api/update-finding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          findingId,
          action: 'resolve_directorate',
          note,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'فشل في تحديث السلبية')

      // Update in-place in selectedModalData
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

      // Re-fetch in background to update counters and chips
      fetchCrossHospitalFindings(true)
    } catch (err) {
      alert('خطأ: ' + err.message)
    } finally {
      setResolvingId(null)
    }
  }

  const fetchCrossHospitalFindings = async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true)
      else setLoading(true)

      // 1. Fetch ALL findings across all hospitals using pagination to avoid 1000 row limits
      let allFindings = []
      let page = 0
      const pageSize = 1000

      while (true) {
        const { data, error } = await supabase
          .from('findings')
          .select(`
            id,
            canonical_text,
            original_text,
            status,
            repeat_count,
            last_seen_date,
            first_seen_date,
            resolved_date,
            resolved_by,
            resolution_note,
            hospital_resolution_note,
            departments (id, name),
            hospitals (id, name, governorate)
          `)
          .range(page * pageSize, (page + 1) * pageSize - 1)

        if (error) throw error
        if (!data || data.length === 0) break
        allFindings = allFindings.concat(data)
        page++
        if (data.length < pageSize) break
      }

      if (allFindings.length > 0) {
        // Group findings by Category -> Canonical Text Key
        const groupedByCategory = {}

        allFindings.forEach((f) => {
          if (!f.hospitals || !f.departments) return
          const category = getCategory(f.departments.name)

          // Standardize text key by removing any [room] tags for cross-hospital matching
          let textKey = (f.canonical_text || f.original_text || '').trim()
          textKey = textKey.replace(/^\[.*?\]\s*/, '')
          if (!textKey) return

          if (!groupedByCategory[category]) {
            groupedByCategory[category] = {}
          }

          if (!groupedByCategory[category][textKey]) {
            groupedByCategory[category][textKey] = {
              text: textKey,
              hospitalsMap: new Map(), // hospitalId -> { hospitalInfo, findings: [] }
            }
          }

          const hospMap = groupedByCategory[category][textKey].hospitalsMap
          if (!hospMap.has(f.hospitals.id)) {
            hospMap.set(f.hospitals.id, {
              id: f.hospitals.id,
              name: f.hospitals.name,
              governorate: f.hospitals.governorate,
              findings: [],
            })
          }

          hospMap.get(f.hospitals.id).findings.push(f)
        })

        // Process and categorize results
        const finalResults = []

        for (const [category, textGroups] of Object.entries(groupedByCategory)) {
          const crossFindings = []

          for (const [text, info] of Object.entries(textGroups)) {
            const hospitalEntries = Array.from(info.hospitalsMap.values())

            // ONLY keep findings that appeared in MULTIPLE distinct hospitals (>= 2)
            if (hospitalEntries.length >= 2) {
              // Analyze hospital statuses for this issue
              let activeCount = 0
              let pendingCount = 0
              let resolvedCount = 0

              const hospitalsList = hospitalEntries.map((h) => {
                // Determine overall hospital status for this issue
                const hasActive = h.findings.some((f) => ['open', 'recurring'].includes(f.status))
                const hasPending = h.findings.some((f) => f.status === 'resolved_by_hospital')
                const allResolved = h.findings.every((f) => f.status === 'resolved_confirmed')

                let status = 'active'
                if (allResolved) {
                  status = 'resolved'
                  resolvedCount++
                } else if (hasPending && !hasActive) {
                  status = 'pending'
                  pendingCount++
                } else {
                  status = 'active'
                  activeCount++
                }

                // Get max repeat count among findings for this hospital
                const maxRepeats = Math.max(...h.findings.map((f) => f.repeat_count || 1))
                const latestDate = h.findings.map((f) => f.last_seen_date).filter(Boolean).sort().reverse()[0]
                const resolvedDate = h.findings.map((f) => f.resolved_date).filter(Boolean).sort().reverse()[0]

                return {
                  ...h,
                  issueStatus: status,
                  repeatCount: maxRepeats,
                  latestDate,
                  resolvedDate,
                }
              })

              // Sort hospitals: Active first, then pending, then resolved
              hospitalsList.sort((a, b) => {
                const weight = { active: 0, pending: 1, resolved: 2 }
                return weight[a.issueStatus] - weight[b.issueStatus]
              })

              crossFindings.push({
                text,
                category,
                totalHospitals: hospitalsList.length,
                activeCount,
                pendingCount,
                resolvedCount,
                isFullyResolved: activeCount === 0 && pendingCount === 0,
                hospitalsList,
              })
            }
          }

          if (crossFindings.length > 0) {
            // Sort findings within category: active ones first, then by total hospitals affected
            crossFindings.sort((a, b) => {
              if (b.activeCount !== a.activeCount) return b.activeCount - a.activeCount
              return b.totalHospitals - a.totalHospitals
            })

            finalResults.push({
              category,
              findings: crossFindings,
              totalActiveIssues: crossFindings.filter((f) => f.activeCount > 0).length,
              totalResolvedIssues: crossFindings.filter((f) => f.isFullyResolved).length,
            })
          }
        }

        // Sort categories by total active findings descending
        finalResults.sort((a, b) => b.totalActiveIssues - a.totalActiveIssues || b.findings.length - a.findings.length)

        setCrossHospitalRecurring(finalResults)
        if (finalResults.length > 0 && !expandedDept) {
          setExpandedDept(finalResults[0].category)
        }
        setLastUpdated(new Date().toLocaleTimeString('ar-EG'))
      }
    } catch (err) {
      console.error('Error fetching cross-hospital findings:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  // Summary Metrics
  const metrics = useMemo(() => {
    let totalIssues = 0
    let activeIssues = 0
    let resolvedIssues = 0
    const uniqueHospitals = new Set()

    crossHospitalRecurring.forEach((dept) => {
      dept.findings.forEach((f) => {
        totalIssues++
        if (f.activeCount > 0) activeIssues++
        if (f.isFullyResolved) resolvedIssues++
        f.hospitalsList.forEach((h) => uniqueHospitals.add(h.id))
      })
    })

    return {
      totalIssues,
      activeIssues,
      resolvedIssues,
      totalHospitalsCount: uniqueHospitals.size,
    }
  }, [crossHospitalRecurring])

  // Filtered Findings
  const filteredCategories = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()

    return crossHospitalRecurring
      .map((dept) => {
        const filteredFindings = dept.findings.filter((f) => {
          // Status Filter
          if (filterStatus === 'active' && f.activeCount === 0) return false
          if (filterStatus === 'resolved' && !f.isFullyResolved) return false

          // Search Filter
          if (q) {
            const matchesText = f.text.toLowerCase().includes(q)
            const matchesHospital = f.hospitalsList.some((h) => h.name.toLowerCase().includes(q))
            const matchesCat = dept.category.toLowerCase().includes(q)
            return matchesText || matchesHospital || matchesCat
          }

          return true
        })

        return {
          ...dept,
          findings: filteredFindings,
        }
      })
      .filter((dept) => dept.findings.length > 0)
  }, [crossHospitalRecurring, filterStatus, searchTerm])

  if (loading) {
    return (
      <div className="loading-state" style={{ minHeight: '50vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div className="loading-spinner" style={{ width: 44, height: 44 }} />
        <span style={{ fontSize: 16, fontWeight: 600 }}>جاري جلب ومطابقة السلبيات المشتركة بين كافة المستشفيات...</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      {/* Top Header & Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            🚨 السلبيات المتكررة المشتركة بين المستشفيات
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
            رصد المشاكل الجذرية الموحدة التي تكررت في أكثر من مستشفى للمتابعة المركزية وتوجيه التدخلات التصحيحية.
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
            🖨️ طباعة تقرير رسمي (Word)
          </Link>
          <button
            onClick={() => fetchCrossHospitalFindings(true)}
            disabled={refreshing}
            className="btn btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}
          >
            {refreshing ? '🔄 جاري التحديث...' : '🔄 تحديث البيانات'}
          </button>
        </div>
      </div>

      {/* Real-time KPI Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-sm)' }}>
        <div className="stat-card" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>إجمالي المشاكل المشتركة</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)' }}>{metrics.totalIssues}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>في مختلف أقسام المستشفيات</div>
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
            📋 كافة السلبيات المشتركة ({metrics.totalIssues})
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

      {/* Main Content: Categories and Recurring Findings */}
      {filteredCategories.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
            {filterStatus === 'active'
              ? 'ممتاز! لا توجد سلبيات نشطة مشتركة تتطلب متابعة حالياً.'
              : filterStatus === 'resolved'
              ? 'لا توجد سلبيات مشتركة تم تلافيها بالكامل بعد.'
              : 'لم يتم العثور على سلبيات مطابقة للبحث.'}
          </div>
          <p style={{ fontSize: 13, marginTop: 4 }}>
            {filterStatus === 'active' ? 'كافة السلبيات المشتركة تم تلافيها أو لا توجد سلبيات تطابق معايير البحث.' : ''}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {filteredCategories.map((dept) => {
            const isExpanded = expandedDept === dept.category

            return (
              <div
                key={dept.category}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-card)',
                  overflow: 'hidden',
                  boxShadow: isExpanded ? 'var(--shadow-sm)' : 'none',
                  transition: 'all 0.2s ease',
                }}
              >
                {/* Accordion Category Header */}
                <div
                  style={{
                    padding: '14px 18px',
                    background: isExpanded ? 'var(--bg-secondary)' : 'var(--bg-card)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                  onClick={() => setExpandedDept(isExpanded ? null : dept.category)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>
                      🏥 {dept.category}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        background: dept.totalActiveIssues > 0 ? '#fee2e2' : '#dcfce7',
                        color: dept.totalActiveIssues > 0 ? '#b91c1c' : '#15803d',
                        padding: '3px 10px',
                        borderRadius: 100,
                        fontWeight: 700,
                      }}
                    >
                      {dept.findings.length} ملاحظات مشتركة ({dept.totalActiveIssues} بحاجة لمتابعة)
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13 }}>
                    <span>{isExpanded ? 'طي الأقسام' : 'عرض التفاصيل'}</span>
                    <span>{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* Expanded Findings List */}
                {isExpanded && (
                  <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid var(--border)' }}>
                    {dept.findings.map((f, idx) => (
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
                          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.6, flex: 1 }}>
                            {f.text}
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
                              🏥 تكررت في {f.totalHospitals} مستشفيات
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
                                  onClick={() => setSelectedModalData({ hospital: h, findingText: f.text, category: dept.category })}
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
                                  title="اضغط لعرض تفاصيل المرور ونصوص الملاحظة في هذا المستشفى"
                                >
                                  <span>{chipStyle.icon}</span>
                                  <span>{h.name}</span>
                                  {h.repeatCount > 1 && (
                                    <span style={{ opacity: 0.8, fontSize: 10, background: 'rgba(0,0,0,0.06)', padding: '1px 5px', borderRadius: 4 }}>
                                      🔁 {h.repeatCount}x
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
              </div>
            )
          })}
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
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                  القسم: {selectedModalData.category}
                </div>
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
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>المشكلة المعيارية الموحدة:</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
                {selectedModalData.findingText}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
                📋 الملاحظات المسجلة في تقرير المرور ({selectedModalData.hospital.findings.length}):
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
                    </div>

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      <span>📅 تاريخ الرصد: {f.last_seen_date || f.first_seen_date || 'غير محدد'}</span>
                      <span>🔁 مرات التكرار: {f.repeat_count || 1}</span>
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
                className="btn btn-primary btn-sm"
                style={{ fontSize: 12, textDecoration: 'none' }}
              >
                الانتقال لصفحة المستشفى ↗
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
