'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import {
  ChartIcon,
  ArrowPathIcon,
  CheckIcon,
  XMarkIcon,
  ExclamationCircleIcon,
  SparklesIcon,
  HospitalIcon
} from '@/components/Icons'

export default function KpiTrackingPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [userProfile, setUserProfile] = useState(null)

  // View & Filter states
  const [activeTab, setActiveTab] = useState('by-month') // 'by-month' | 'matrix' | 'ranking'
  const [selectedMonth, setSelectedMonth] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all') // 'all' | 'missing_only' | 'perfect_only'
  const [includeCurrentMonth, setIncludeCurrentMonth] = useState(false)
  const [toastMessage, setToastMessage] = useState('')

  const showToast = useCallback((msg) => {
    setToastMessage(msg)
    setTimeout(() => {
      setToastMessage('')
    }, 3500)
  }, [])

  const checkAuthAndFetch = useCallback(async (forceRefresh = false) => {
    await Promise.resolve()
    try {
      if (forceRefresh) {
        setRefreshing(true)
      }
      setError('')

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError('يرجى تسجيل الدخول أولاً')
        return
      }

      // 1. Get profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('id', session.user.id)
        .single()

      setUserProfile(profile)

      if (profile?.role !== 'directorate_admin') {
        setLoading(false)
        setRefreshing(false)
        return
      }

      // 2. Fetch KPI tracking data from API
      const url = `/api/kpi-tracking?includeCurrent=${includeCurrentMonth}&refresh=${forceRefresh}`
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      })

      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'فشل في جلب بيانات متابعة المؤشرات')
      }

      setData(json)

      // Set default selected month to latest evaluated month
      if (json.meta?.evaluatedMonths && json.meta.evaluatedMonths.length > 0) {
        const evalMonths = json.meta.evaluatedMonths
        setSelectedMonth(prev => (prev && evalMonths.includes(prev) ? prev : evalMonths[evalMonths.length - 1]))
      }

    } catch (err) {
      console.error('KPI tracking fetch error:', err)
      setError(err.message || 'حدث خطأ أثناء تحميل البيانات')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [includeCurrentMonth])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkAuthAndFetch()
  }, [checkAuthAndFetch])

  const handleRefresh = () => {
    checkAuthAndFetch(true)
  }

  // Copy list of missing hospitals for the selected month
  const handleCopyMissingList = (monthNum, monthName, missingList) => {
    if (!missingList || missingList.length === 0) return

    const year = data?.meta?.targetYear || '2026'
    let text = `📋 بيان المستشفيات التي لم تسجل مؤشرات شهر ${monthName} (${monthNum}) لسنة ${year}:\n`
    text += `العدد الإجمالي: ${missingList.length} مستشفى\n\n`

    missingList.forEach((h, idx) => {
      text += `${idx + 1}. ${h.name}`
      if (h.director_name) text += ` - المدير: ${h.director_name}`
      if (h.director_phone) text += ` (${h.director_phone})`
      if (h.quality_head_name) text += ` - مسؤول الجودة: ${h.quality_head_name}`
      if (h.quality_head_phone) text += ` (${h.quality_head_phone})`
      text += '\n'
    })

    text += `\n*منصة إدارة سلامة المرضى والجودة - مديرية الشؤون الصحية*`

    navigator.clipboard.writeText(text)
      .then(() => showToast(`✅ تم نسخ قائمة المتأخرين لشهر ${monthName} إلى الحافظة بنجاح`))
      .catch(() => showToast('❌ تعذر النسخ، يرجى المحاولة يدوياً'))
  }

  // Copy WhatsApp Reminder Message
  const handleCopyWhatsAppReminder = (monthNum, monthName, missingList) => {
    if (!missingList || missingList.length === 0) return

    const year = data?.meta?.targetYear || '2026'
    let text = `🚨 *تنبيه عاجل ومهم - إدارة الجودة وسلامة المرضى بالمديرية*\n\n`
    text += `السادة مديري ومسؤولي الجودة بالمستشفيات،\n`
    text += `نحيطكم علماً بأنه بمراجعة شيت مؤشرات الأداء لشهر *${monthName} (شهر ${monthNum} / ${year})*، تبين عدم تسجيل المؤشرات الخاصة بالمستشفيات التالية:\n\n`

    missingList.forEach((h, idx) => {
      text += `▫️ *${h.name}*\n`
    })

    text += `\nيرجى سرعة استكمال إدخال المؤشرات على الرابط المعتمد خلال 24 ساعة لانتظام التقارير الشهرية ولوحة المتابعة.\n`
    text += `شاكرين تعاونكم المستمر حرصاً على جودة وسلامة الخدمة الطبية.`

    navigator.clipboard.writeText(text)
      .then(() => showToast(`💬 تم نسخ رسالة تذكير الواتساب لشهر ${monthName} بنجاح`))
      .catch(() => showToast('❌ تعذر النسخ، يرجى المحاولة يدوياً'))
  }

  // Filtered hospitals for matrix
  const filteredMatrix = useMemo(() => {
    if (!data?.hospitalsMatrix) return []
    return data.hospitalsMatrix.filter(h => {
      const matchesSearch = !searchQuery || h.name.includes(searchQuery.trim())
      if (!matchesSearch) return false

      if (statusFilter === 'missing_only') {
        return h.missingMonthsCount > 0
      }
      if (statusFilter === 'perfect_only') {
        return h.missingMonthsCount === 0
      }
      return true
    })
  }, [data, searchQuery, statusFilter])

  // Current month summary object
  const currentMonthSummary = useMemo(() => {
    if (!data?.monthsSummary || !selectedMonth) return null
    return data.monthsSummary.find(m => m.month === selectedMonth) || null
  }, [data, selectedMonth])

  // If user is not directorate_admin
  if (!loading && userProfile && userProfile.role !== 'directorate_admin') {
    return (
      <div style={{ maxWidth: 640, margin: '60px auto', textAlign: 'center' }}>
        <div className="card" style={{ padding: 'var(--space-2xl)', borderTop: '4px solid var(--danger)' }}>
          <div style={{ fontSize: 48, marginBottom: 'var(--space-md)' }}>🔒</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 'var(--space-sm)' }}>
            عذراً، هذه الصفحة غير مصرح بها
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6, marginBottom: 'var(--space-lg)' }}>
            هذا القسم مخصص ومحصور حصرياً لمدير المديرية لمتابعة التزام المستشفيات بالمؤشرات الشهرية من شيت جوجل.
          </p>
          <Link href="/dashboard" className="btn btn-primary" style={{ display: 'inline-flex' }}>
            العودة للرئيسية
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="kpi-tracking-container" style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 'var(--space-3xl)' }}>
      
      {/* Toast Notification */}
      {toastMessage && (
        <div 
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--text-primary)',
            color: '#fff',
            padding: '12px 24px',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-lg)',
            fontSize: 14,
            fontWeight: 600,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            animation: 'fadeIn 0.2s ease-out'
          }}
        >
          {toastMessage}
        </div>
      )}

      {/* Page Header */}
      <div className="page-header mb-lg" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span 
              className="badge" 
              style={{ 
                background: 'rgba(0, 122, 135, 0.12)', 
                color: 'var(--primary-dark)', 
                fontWeight: 700, 
                fontSize: 11,
                padding: '4px 10px',
                borderRadius: 100,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4
              }}
            >
              <span>🛡️</span>
              <span>خاص بمدير المديرية</span>
            </span>

            {data?.meta?.targetYear && (
              <span className="badge badge-primary" style={{ fontSize: 11 }}>
                سنة {data.meta.targetYear}
              </span>
            )}
            
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              (بدأ الاحتساب من شهر 5)
            </span>
          </div>

          <h1 style={{ fontSize: 24, fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
            متابعة تسجيل المؤشرات الشهرية
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            رصد انتظام المستشفيات في إدخال مؤشرات الأداء عبر شيت جوجل وتحديد المتأخرين شهراً بشهر
          </p>
        </div>

        {/* Action Controls */}
        <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => window.print()}
            className="btn btn-outline btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            title="طباعة التقرير"
          >
            <span>🖨️</span>
            <span>طباعة</span>
          </button>

          <button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            className="btn btn-primary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <ArrowPathIcon className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'جاري التحديث...' : 'تحديث من الشيت'}</span>
          </button>
        </div>
      </div>

      {/* Loading Skeleton */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="skeleton" style={{ height: 100, width: '100%', borderRadius: 'var(--radius-lg)' }} />
          <div className="skeleton" style={{ height: 350, width: '100%', borderRadius: 'var(--radius-lg)' }} />
        </div>
      )}

      {/* Error Alert */}
      {error && !loading && (
        <div className="card mb-lg" style={{ borderRight: '4px solid var(--danger)', background: '#fef2f2' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24 }}>⚠️</span>
            <div>
              <h3 style={{ color: 'var(--danger)', fontSize: 15, fontWeight: 700, margin: 0 }}>تنبيه</h3>
              <p style={{ color: '#991b1b', fontSize: 13, margin: '4px 0 0 0' }}>{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      {!loading && data && (
        <>
          {/* Top KPI Summary Cards */}
          <div className="grid grid-cols-4 mb-lg" style={{ gap: 16 }}>
            {/* Total Hospitals */}
            <div className="card" style={{ padding: '16px 20px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                إجمالي المستشفيات
              </div>
              <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--text-primary)' }}>
                {data.stats.totalHospitals}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                مستشفى تابعة للمديرية
              </div>
            </div>

            {/* Overall Compliance */}
            <div className="card" style={{ padding: '16px 20px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                متوسط الالتزام الإجمالي
              </div>
              <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--primary)' }}>
                {data.stats.overallComplianceRate}%
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                من شهر 5 حتى أحدث شهر مستحق
              </div>
            </div>

            {/* Perfect Compliance */}
            <div className="card" style={{ padding: '16px 20px', position: 'relative', overflow: 'hidden', borderRight: '3px solid var(--success)' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                ملتزمة بالكامل (100%)
              </div>
              <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--success)' }}>
                {data.stats.perfectHospitalsCount}
              </div>
              <div style={{ fontSize: 11, color: 'var(--success-dark)', marginTop: 4 }}>
                سجلت في كافة الشهور دون انقطاع
              </div>
            </div>

            {/* Delinquent / Critical */}
            <div className="card" style={{ padding: '16px 20px', position: 'relative', overflow: 'hidden', borderRight: '3px solid var(--danger)' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                متأخرة / متعثرة
              </div>
              <div style={{ fontSize: 28, fontWeight: 900, color: data.stats.criticalHospitalsCount > 0 ? 'var(--danger)' : 'var(--warning)' }}>
                {data.stats.criticalHospitalsCount + data.stats.warningHospitalsCount}
              </div>
              <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>
                منها {data.stats.criticalHospitalsCount} مستشفى تأخرت بشدة (شهرين+)
              </div>
            </div>
          </div>

          {/* Toggle for Current Month & Options */}
          <div 
            className="no-print card mb-md" 
            style={{ 
              padding: '12px 18px', 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              flexWrap: 'wrap', 
              gap: 12,
              background: 'var(--bg-glass)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label 
                style={{ 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  gap: 8, 
                  fontSize: 13, 
                  fontWeight: 600, 
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
              >
                <input
                  type="checkbox"
                  checked={includeCurrentMonth}
                  onChange={(e) => setIncludeCurrentMonth(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: 'var(--primary)', cursor: 'pointer' }}
                />
                <span>تضمين شهر {data.meta?.currentCalendarMonth} (الشهر الحالي الجاري) في التقييم</span>
              </label>
              {!includeCurrentMonth && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-primary)', padding: '2px 8px', borderRadius: 4 }}>
                  (المعروض حالياً: الشهور المنتهية من شهر 5 حتى شهر {data.meta?.maxMonthToEvaluate})
                </span>
              )}
            </div>

            {/* Navigation Tabs */}
            <div style={{ display: 'inline-flex', background: 'var(--bg-primary)', padding: 4, borderRadius: 'var(--radius-md)' }}>
              <button
                onClick={() => setActiveTab('by-month')}
                style={{
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: activeTab === 'by-month' ? 'var(--bg-card)' : 'transparent',
                  color: activeTab === 'by-month' ? 'var(--primary)' : 'var(--text-muted)',
                  boxShadow: activeTab === 'by-month' ? 'var(--shadow-sm)' : 'none',
                  transition: 'var(--transition)'
                }}
              >
                📅 المستشفيات غير المسجلة حسب الشهر
              </button>

              <button
                onClick={() => setActiveTab('matrix')}
                style={{
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: activeTab === 'matrix' ? 'var(--bg-card)' : 'transparent',
                  color: activeTab === 'matrix' ? 'var(--primary)' : 'var(--text-muted)',
                  boxShadow: activeTab === 'matrix' ? 'var(--shadow-sm)' : 'none',
                  transition: 'var(--transition)'
                }}
              >
                📊 المصفوفة الشاملة (كل الشهور)
              </button>

              <button
                onClick={() => setActiveTab('ranking')}
                style={{
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: activeTab === 'ranking' ? 'var(--bg-card)' : 'transparent',
                  color: activeTab === 'ranking' ? 'var(--primary)' : 'var(--text-muted)',
                  boxShadow: activeTab === 'ranking' ? 'var(--shadow-sm)' : 'none',
                  transition: 'var(--transition)'
                }}
              >
                🏆 تقييم التزام المستشفيات
              </button>
            </div>
          </div>

          {/* ========================================================= */}
          {/* VIEW 1: BY MONTH (Focus on Missing Hospitals) */}
          {/* ========================================================= */}
          {activeTab === 'by-month' && (
            <div>
              {/* Month Selector Tabs */}
              <div 
                className="no-print mb-md" 
                style={{ 
                  display: 'flex', 
                  gap: 10, 
                  overflowX: 'auto', 
                  paddingBottom: 6 
                }}
              >
                {data.monthsSummary.map(m => {
                  const isSelected = m.month === selectedMonth
                  const hasMissing = m.missingCount > 0

                  return (
                    <button
                      key={m.month}
                      onClick={() => setSelectedMonth(m.month)}
                      style={{
                        padding: '10px 18px',
                        borderRadius: 'var(--radius-lg)',
                        border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border)',
                        background: isSelected ? 'var(--bg-card)' : 'var(--bg-secondary)',
                        cursor: 'pointer',
                        textAlign: 'right',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        minWidth: 140,
                        transition: 'var(--transition)',
                        boxShadow: isSelected ? 'var(--shadow-md)' : 'none'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 800, fontSize: 14, color: isSelected ? 'var(--primary)' : 'var(--text-primary)' }}>
                          {m.monthName} ({m.month})
                        </span>
                        {m.isCurrentMonth && (
                          <span style={{ fontSize: 9, background: 'rgba(0,122,135,0.1)', color: 'var(--primary)', padding: '2px 5px', borderRadius: 4 }}>
                            الحالي
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        {hasMissing ? (
                          <span style={{ color: 'var(--danger)', fontWeight: 700 }}>
                            {m.missingCount} لم تسجل ⚠️
                          </span>
                        ) : (
                          <span style={{ color: 'var(--success)', fontWeight: 700 }}>
                            اكتمل التسجيل (100%) ✅
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Selected Month Header Banner */}
              {currentMonthSummary && (
                <div 
                  className="card mb-md" 
                  style={{ 
                    padding: '20px 24px',
                    background: currentMonthSummary.missingCount > 0 
                      ? 'linear-gradient(135deg, rgba(254, 242, 242, 0.9) 0%, rgba(255, 255, 255, 0.95) 100%)' 
                      : 'linear-gradient(135deg, rgba(240, 253, 244, 0.9) 0%, rgba(255, 255, 255, 0.95) 100%)',
                    borderRight: currentMonthSummary.missingCount > 0 ? '4px solid var(--danger)' : '4px solid var(--success)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <h2 style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
                          شهر {currentMonthSummary.monthName} (شهر {currentMonthSummary.month})
                        </h2>
                        {currentMonthSummary.isCurrentMonth && (
                          <span className="badge badge-primary">الشهر الحالي الجاري</span>
                        )}
                      </div>
                      
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8, fontSize: 13 }}>
                        <span style={{ color: 'var(--success-dark)', fontWeight: 700 }}>
                          ✅ تم التسجيل: {currentMonthSummary.registeredCount} مستشفى ({currentMonthSummary.complianceRate}%)
                        </span>
                        <span>•</span>
                        <span style={{ color: currentMonthSummary.missingCount > 0 ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 700 }}>
                          ❌ لم تسجل: {currentMonthSummary.missingCount} مستشفى
                        </span>
                      </div>
                    </div>

                    {/* Copy & Reminder Action Buttons */}
                    {currentMonthSummary.missingCount > 0 && (
                      <div className="no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          onClick={() => handleCopyMissingList(currentMonthSummary.month, currentMonthSummary.monthName, currentMonthSummary.missingHospitals)}
                          className="btn btn-outline btn-sm"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                          <span>📋</span>
                          <span>نسخ بيان المتأخرين</span>
                        </button>

                        <button
                          onClick={() => handleCopyWhatsAppReminder(currentMonthSummary.month, currentMonthSummary.monthName, currentMonthSummary.missingHospitals)}
                          className="btn btn-primary btn-sm"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#16a34a', borderColor: '#16a34a' }}
                        >
                          <span>💬</span>
                          <span>نسخ رسالة التذكير للواتساب</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Missing Hospitals Section */}
              {currentMonthSummary && currentMonthSummary.missingCount === 0 ? (
                <div className="card text-center" style={{ padding: '48px 24px', background: '#f0fdf4' }}>
                  <div style={{ fontSize: 42, marginBottom: 12 }}>🎉</div>
                  <h3 style={{ fontSize: 18, fontWeight: 800, color: 'var(--success-dark)', margin: 0 }}>
                    اكتملت التسجيلات لهذا الشهر بنجاح!
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6 }}>
                    جميع المستشفيات الـ {data.stats.totalHospitals} قامت بتسجيل وإدخال كافة المؤشرات المطلوبة لشهر {currentMonthSummary.monthName}.
                  </p>
                </div>
              ) : currentMonthSummary && (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>🚨</span>
                      <span>المستشفيات المتأخرة عن تسجيل شهر {currentMonthSummary.monthName} ({currentMonthSummary.missingCount} مستشفى)</span>
                    </h3>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      انقر على أي مستشفى للاتصال أو فتح الملف
                    </span>
                  </div>

                  <div className="table-responsive">
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'right' }}>
                      <thead>
                        <tr style={{ background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                          <th style={{ padding: '12px 16px', width: 40 }}>#</th>
                          <th style={{ padding: '12px 16px' }}>اسم المستشفى</th>
                          <th style={{ padding: '12px 16px' }}>مدير المستشفى</th>
                          <th style={{ padding: '12px 16px' }}>مسؤول الجودة</th>
                          <th style={{ padding: '12px 16px', textAlign: 'center' }}>تكرار الغياب عن التسجيل</th>
                          <th style={{ padding: '12px 16px', textAlign: 'center' }} className="no-print">إجراءات سريعة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentMonthSummary.missingHospitals.map((hosp, idx) => {
                          // Find this hospital's full record from matrix
                          const fullRecord = data.hospitalsMatrix.find(h => h.id === hosp.id)
                          const otherMissed = fullRecord?.missingMonths.filter(m => m !== currentMonthSummary.month) || []
                          const isRepeatOffender = otherMissed.length > 0

                          return (
                            <tr 
                              key={hosp.id} 
                              style={{ 
                                borderBottom: '1px solid var(--border)',
                                background: idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)'
                              }}
                            >
                              <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>
                                {idx + 1}
                              </td>

                              <td style={{ padding: '12px 16px' }}>
                                <Link 
                                  href={`/hospitals/${hosp.id}`} 
                                  style={{ fontWeight: 800, color: 'var(--primary)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                  title="فتح ملف المستشفى"
                                >
                                  <span>🏥</span>
                                  <span>{hosp.name}</span>
                                </Link>
                              </td>

                              <td style={{ padding: '12px 16px' }}>
                                {hosp.director_name ? (
                                  <div>
                                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{hosp.director_name}</div>
                                    {hosp.director_phone && (
                                      <a 
                                        href={`tel:${hosp.director_phone}`} 
                                        style={{ fontSize: 11, color: 'var(--text-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                        dir="ltr"
                                      >
                                        <span>📞</span>
                                        <span>{hosp.director_phone}</span>
                                      </a>
                                    )}
                                  </div>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>-</span>
                                )}
                              </td>

                              <td style={{ padding: '12px 16px' }}>
                                {hosp.quality_head_name ? (
                                  <div>
                                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{hosp.quality_head_name}</div>
                                    {hosp.quality_head_phone && (
                                      <a 
                                        href={`tel:${hosp.quality_head_phone}`} 
                                        style={{ fontSize: 11, color: 'var(--text-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                        dir="ltr"
                                      >
                                        <span>📞</span>
                                        <span>{hosp.quality_head_phone}</span>
                                      </a>
                                    )}
                                  </div>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>-</span>
                                )}
                              </td>

                              <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                                {isRepeatOffender ? (
                                  <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                                    <span 
                                      className="badge badge-danger" 
                                      style={{ fontSize: 11, padding: '3px 8px' }}
                                    >
                                      ⚠️ تخلفت عن {fullRecord.missingMonthsCount} شهور
                                    </span>
                                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                      لم تسجل أيضاً: {otherMissed.map(m => `شهر ${m}`).join('، ')}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="badge badge-warning" style={{ fontSize: 11 }}>
                                    أول تأخر مسجل
                                  </span>
                                )}
                              </td>

                              <td style={{ padding: '12px 16px', textAlign: 'center' }} className="no-print">
                                <div style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
                                  {hosp.quality_head_phone && (
                                    <a
                                      href={`https://wa.me/2${hosp.quality_head_phone.replace(/[^0-9]/g, '')}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="btn btn-outline btn-sm"
                                      style={{ padding: '4px 8px', fontSize: 11, borderColor: '#16a34a', color: '#16a34a' }}
                                      title="مراسلة مسؤول الجودة واتساب"
                                    >
                                      واتساب
                                    </a>
                                  )}
                                  <Link
                                    href={`/hospitals/${hosp.id}`}
                                    className="btn btn-outline btn-sm"
                                    style={{ padding: '4px 8px', fontSize: 11 }}
                                  >
                                    الملف
                                  </Link>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Registered Hospitals Accordion/Preview for the Month */}
              {currentMonthSummary && currentMonthSummary.registeredCount > 0 && (
                <div className="card mt-md" style={{ padding: 0 }}>
                  <details style={{ padding: '14px 20px', cursor: 'pointer' }}>
                    <summary style={{ fontSize: 13, fontWeight: 700, color: 'var(--success-dark)', userSelect: 'none' }}>
                      ✅ عرض المستشفيات التي قامت بالتسجيل في هذا الشهر ({currentMonthSummary.registeredCount} مستشفى)
                    </summary>
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
                        {currentMonthSummary.registeredHospitals.map(h => (
                          <div 
                            key={h.id}
                            style={{ 
                              padding: '8px 12px', 
                              background: 'var(--bg-primary)', 
                              borderRadius: 'var(--radius-sm)',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              fontSize: 12
                            }}
                          >
                            <Link href={`/hospitals/${h.id}`} style={{ textDecoration: 'none', color: 'var(--text-primary)', fontWeight: 600 }}>
                              {h.name}
                            </Link>
                            <span style={{ color: 'var(--success)', fontWeight: 700, fontSize: 11 }}>
                              {h.count} مؤشر
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </details>
                </div>
              )}
            </div>
          )}

          {/* ========================================================= */}
          {/* VIEW 2: FULL MATRIX GRID */}
          {/* ========================================================= */}
          {activeTab === 'matrix' && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Matrix Search & Filters */}
              <div 
                className="no-print" 
                style={{ 
                  padding: '16px 20px', 
                  borderBottom: '1px solid var(--border)', 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  flexWrap: 'wrap', 
                  gap: 12,
                  background: 'var(--bg-secondary)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 260 }}>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="🔍 ابحث عن اسم المستشفى..."
                    className="form-input"
                    style={{ maxWidth: 320, padding: '8px 12px', fontSize: 13 }}
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '4px 8px' }}
                    >
                      مسح
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    onClick={() => setStatusFilter('all')}
                    className={`btn btn-sm ${statusFilter === 'all' ? 'btn-primary' : 'btn-outline'}`}
                    style={{ fontSize: 12 }}
                  >
                    الكل ({data.stats.totalHospitals})
                  </button>
                  <button
                    onClick={() => setStatusFilter('missing_only')}
                    className={`btn btn-sm ${statusFilter === 'missing_only' ? 'btn-danger' : 'btn-outline'}`}
                    style={{ fontSize: 12 }}
                  >
                    المتأخرين فقط ({data.stats.criticalHospitalsCount + data.stats.warningHospitalsCount})
                  </button>
                  <button
                    onClick={() => setStatusFilter('perfect_only')}
                    className={`btn btn-sm ${statusFilter === 'perfect_only' ? 'btn-success' : 'btn-outline'}`}
                    style={{ fontSize: 12 }}
                  >
                    الملتزمين 100% ({data.stats.perfectHospitalsCount})
                  </button>
                </div>
              </div>

              {/* Matrix Table */}
              <div className="table-responsive">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'right' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-primary)', borderBottom: '2px solid var(--border)', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '14px 16px', position: 'sticky', right: 0, background: 'var(--bg-primary)', zIndex: 2 }}>
                        المستشفى
                      </th>

                      {data.meta.evaluatedMonths.map(m => (
                        <th key={m} style={{ padding: '14px 12px', textAlign: 'center', minWidth: 105 }}>
                          <div>{data.meta.monthNames[m] || `شهر ${m}`}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>شهر {m}</div>
                        </th>
                      ))}

                      <th style={{ padding: '14px 16px', textAlign: 'center', minWidth: 110 }}>
                        نسبة الالتزام
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredMatrix.map((hosp, idx) => (
                      <tr 
                        key={hosp.id}
                        style={{ 
                          borderBottom: '1px solid var(--border)',
                          background: hosp.statusCategory === 'critical' 
                            ? 'rgba(239, 68, 68, 0.03)' 
                            : (idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)')
                        }}
                      >
                        {/* Hospital Name */}
                        <td 
                          style={{ 
                            padding: '14px 16px', 
                            fontWeight: 700,
                            position: 'sticky', 
                            right: 0, 
                            background: hosp.statusCategory === 'critical' ? '#fff9f9' : (idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)'),
                            zIndex: 1,
                            boxShadow: '1px 0 3px rgba(0,0,0,0.03)'
                          }}
                        >
                          <Link 
                            href={`/hospitals/${hosp.id}`}
                            style={{ color: 'var(--text-primary)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                          >
                            <span>🏥</span>
                            <span>{hosp.name}</span>
                          </Link>
                          {hosp.statusCategory === 'critical' && (
                            <div style={{ fontSize: 10, color: 'var(--danger)', fontWeight: 600, marginTop: 2 }}>
                              ⚠️ متعثرة ({hosp.missingMonthsCount} شهور غياب)
                            </div>
                          )}
                        </td>

                        {/* Month Cells */}
                        {data.meta.evaluatedMonths.map(m => {
                          const statusObj = hosp.monthsStatus[m]
                          const isMissing = statusObj?.status === 'missing'
                          const isRegistered = statusObj?.status === 'registered'
                          const count = statusObj?.count || 0

                          return (
                            <td 
                              key={m} 
                              style={{ 
                                padding: '12px 8px', 
                                textAlign: 'center',
                                verticalAlign: 'middle'
                              }}
                            >
                              {isRegistered ? (
                                <span 
                                  className="badge" 
                                  style={{ 
                                    background: '#dcfce7', 
                                    color: '#15803d', 
                                    padding: '4px 8px', 
                                    borderRadius: 6,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 3
                                  }}
                                  title={`تم تسجيل ${count} مؤشر`}
                                >
                                  <span>✅</span>
                                  <span>{count}</span>
                                </span>
                              ) : isMissing ? (
                                <span 
                                  className="badge" 
                                  style={{ 
                                    background: '#fee2e2', 
                                    color: '#b91c1c', 
                                    padding: '4px 8px', 
                                    borderRadius: 6,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 3
                                  }}
                                  title="لم يتم تسجيل أي مؤشرات لهذا الشهر"
                                >
                                  <span>❌</span>
                                  <span>لم يسجل</span>
                                </span>
                              ) : (
                                <span 
                                  className="badge" 
                                  style={{ 
                                    background: '#fef3c7', 
                                    color: '#b45309', 
                                    padding: '4px 8px', 
                                    borderRadius: 6,
                                    fontSize: 11,
                                    fontWeight: 700
                                  }}
                                  title={`تسجيل جزئي: ${count} مؤشر`}
                                >
                                  ⚠️ {count}
                                </span>
                              )}
                            </td>
                          )
                        })}

                        {/* Hospital Overall Compliance */}
                        <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                            <span 
                              style={{ 
                                fontSize: 13, 
                                fontWeight: 800,
                                color: hosp.complianceRate === 100 
                                  ? 'var(--success)' 
                                  : (hosp.complianceRate >= 70 ? 'var(--warning-dark)' : 'var(--danger)')
                              }}
                            >
                              {hosp.complianceRate}%
                            </span>
                            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                              ({hosp.registeredMonthsCount} من {hosp.totalDue} شهور)
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>

                  {/* Summary Footer */}
                  <tfoot>
                    <tr style={{ background: 'var(--bg-primary)', borderTop: '2px solid var(--border)', fontWeight: 800 }}>
                      <td style={{ padding: '14px 16px', position: 'sticky', right: 0, background: 'var(--bg-primary)' }}>
                        إجمالي المسجلين
                      </td>

                      {data.meta.evaluatedMonths.map(m => {
                        const summary = data.monthsSummary.find(s => s.month === m)
                        const regCount = summary?.registeredCount || 0
                        const missCount = summary?.missingCount || 0
                        const rate = summary?.complianceRate || 0

                        return (
                          <td key={m} style={{ padding: '12px 8px', textAlign: 'center' }}>
                            <div style={{ fontSize: 12, color: 'var(--success-dark)' }}>
                              {regCount} مسجل
                            </div>
                            <div style={{ fontSize: 10, color: missCount > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                              {missCount > 0 ? `${missCount} غائب (${rate}%)` : 'اكتمل 100%'}
                            </div>
                          </td>
                        )
                      })}

                      <td style={{ padding: '14px 16px', textAlign: 'center', color: 'var(--primary)' }}>
                        {data.stats.overallComplianceRate}% الإجمالي
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* VIEW 3: RANKING & DELINQUENCY ANALYSIS */}
          {/* ========================================================= */}
          {activeTab === 'ranking' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              
              {/* Category 1: Critical Delinquent Hospitals */}
              {data.stats.criticalHospitalsCount > 0 && (
                <div className="card" style={{ padding: 0, overflow: 'hidden', borderRight: '4px solid var(--danger)' }}>
                  <div style={{ padding: '16px 20px', background: '#fef2f2', borderBottom: '1px solid #fee2e2' }}>
                    <h3 style={{ fontSize: 16, fontWeight: 900, color: 'var(--danger-dark)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>🚨</span>
                      <span>مستشفيات متعثرة بشدة (تخلفت عن التسجيل في شهرين أو أكثر)</span>
                    </h3>
                    <p style={{ fontSize: 12, color: '#991b1b', margin: '4px 0 0 0' }}>
                      هذه المستشفيات تتطلب توجيهاً إدارياً عاجلاً وتكليف فريق المرور للتأكد من أسباب توقف إرسال المؤشرات
                    </p>
                  </div>

                  <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
                    {data.hospitalsMatrix
                      .filter(h => h.statusCategory === 'critical')
                      .map(h => (
                        <div 
                          key={h.id} 
                          style={{ 
                            padding: 16, 
                            borderRadius: 'var(--radius-md)', 
                            border: '1px solid #fecaca', 
                            background: '#fff',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            gap: 12
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <Link 
                                href={`/hospitals/${h.id}`}
                                style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', textDecoration: 'none' }}
                              >
                                {h.name}
                              </Link>
                              <span className="badge badge-danger" style={{ fontSize: 11 }}>
                                {h.missingMonthsCount} شهور غياب
                              </span>
                            </div>

                            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>
                              الشهور غير المسجلة: {h.missingMonths.map(m => data.meta.monthNames[m] || `شهر ${m}`).join('، ')}
                            </div>
                          </div>

                          <div style={{ fontSize: 12, background: 'var(--bg-primary)', padding: 10, borderRadius: 'var(--radius-sm)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span style={{ color: 'var(--text-muted)' }}>المدير:</span>
                              <span style={{ fontWeight: 600 }}>{h.director_name || 'غير مسجل'}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span style={{ color: 'var(--text-muted)' }}>هاتف المدير:</span>
                              <span dir="ltr">{h.director_phone || '-'}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span style={{ color: 'var(--text-muted)' }}>مسؤول الجودة:</span>
                              <span style={{ fontWeight: 600 }}>{h.quality_head_name || 'غير مسجل'}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: 'var(--text-muted)' }}>هاتف الجودة:</span>
                              <span dir="ltr">{h.quality_head_phone || '-'}</span>
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: 8 }}>
                            {h.quality_head_phone && (
                              <a
                                href={`https://wa.me/2${h.quality_head_phone.replace(/[^0-9]/g, '')}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-outline btn-sm"
                                style={{ flex: 1, textAlign: 'center', borderColor: '#16a34a', color: '#16a34a', fontSize: 11 }}
                              >
                                واتساب مسؤول الجودة
                              </a>
                            )}
                            <Link
                              href={`/hospitals/${h.id}`}
                              className="btn btn-primary btn-sm"
                              style={{ flex: 1, textAlign: 'center', fontSize: 11 }}
                            >
                              فتح الملف
                            </Link>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Category 2: 100% Perfect Attendance */}
              <div className="card" style={{ padding: 0, overflow: 'hidden', borderRight: '4px solid var(--success)' }}>
                <div style={{ padding: '16px 20px', background: '#f0fdf4', borderBottom: '1px solid #dcfce7' }}>
                  <h3 style={{ fontSize: 16, fontWeight: 900, color: 'var(--success-dark)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>🌟</span>
                    <span>المستشفيات الأكثر التزاماً (100% في كافة الشهور)</span>
                  </h3>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                    {data.stats.perfectHospitalsCount} مستشفى سجلت كافة مؤشراتها في جميع الشهور من شهر 5 دون أي تخلف
                  </p>
                </div>

                <div style={{ padding: 20 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12 }}>
                    {data.hospitalsMatrix
                      .filter(h => h.statusCategory === 'perfect')
                      .map(h => (
                        <div 
                          key={h.id}
                          style={{ 
                            padding: '12px 16px', 
                            borderRadius: 'var(--radius-md)', 
                            border: '1px solid #dcfce7', 
                            background: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between'
                          }}
                        >
                          <Link 
                            href={`/hospitals/${h.id}`}
                            style={{ fontWeight: 700, color: 'var(--text-primary)', textDecoration: 'none' }}
                          >
                            {h.name}
                          </Link>
                          <span 
                            className="badge" 
                            style={{ background: '#dcfce7', color: '#15803d', fontWeight: 800, fontSize: 11 }}
                          >
                            100% ({h.totalDue} شهور)
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              {/* Monthly Trend Bars */}
              <div className="card" style={{ padding: '20px 24px' }}>
                <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 16, color: 'var(--text-primary)' }}>
                  📈 مسار نسبة التزام المديرية شهراً بشهر
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {data.monthsSummary.map(m => (
                    <div key={m.month}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                          شهر {m.monthName} ({m.month})
                          {m.isCurrentMonth && <span style={{ fontSize: 11, color: 'var(--primary)', marginRight: 6 }}>(الحالي)</span>}
                        </span>
                        <span style={{ fontWeight: 800, color: m.complianceRate >= 80 ? 'var(--success)' : (m.complianceRate >= 60 ? 'var(--warning-dark)' : 'var(--danger)') }}>
                          {m.registeredCount} مسجل من {data.stats.totalHospitals} ({m.complianceRate}%)
                        </span>
                      </div>

                      <div style={{ width: '100%', height: 10, background: 'var(--bg-primary)', borderRadius: 100, overflow: 'hidden' }}>
                        <div 
                          style={{ 
                            width: `${m.complianceRate}%`, 
                            height: '100%', 
                            background: m.complianceRate >= 80 ? 'var(--success)' : (m.complianceRate >= 60 ? 'var(--warning)' : 'var(--danger)'),
                            borderRadius: 100,
                            transition: 'width 0.6s ease'
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}

        </>
      )}

    </div>
  )
}
