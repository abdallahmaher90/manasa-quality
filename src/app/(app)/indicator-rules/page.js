'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import {
  ChartIcon,
  ArrowPathIcon,
  CheckIcon,
  XMarkIcon,
  ExclamationCircleIcon,
  SparklesIcon,
  HospitalIcon,
  ClipboardIcon
} from '@/components/Icons'

export default function IndicatorRulesPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [toastMessage, setToastMessage] = useState('')

  // View state: 'cards' | 'table'
  const [viewMode, setViewMode] = useState('cards')

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedDomain, setSelectedDomain] = useState('all')
  const [selectedDirection, setSelectedDirection] = useState('all') // 'all' | 'higher' | 'lower' | 'range'
  const [selectedScope, setSelectedScope] = useState('all') // 'all' | 'general' | 'specific'
  const [selectedIndicatorModal, setSelectedIndicatorModal] = useState(null)

  const showToast = useCallback((msg) => {
    setToastMessage(msg)
    setTimeout(() => {
      setToastMessage('')
    }, 3500)
  }, [])

  const fetchRules = useCallback(async (forceRefresh = false) => {
    try {
      if (forceRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      setError('')

      const res = await fetch(`/api/indicator-rules${forceRefresh ? '?refresh=true' : ''}`)
      const json = await res.json()

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'فشل في تحميل حدود وقواعد المؤشرات')
      }

      setData(json)
      if (forceRefresh) {
        showToast('تم تحديث حدود المؤشرات من شيت جوجل بنجاح')
      }
    } catch (err) {
      console.error('Fetch error:', err)
      setError(err.message || 'حدث خطأ أثناء تحميل البيانات')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [showToast])

  useEffect(() => {
    fetchRules()
  }, [fetchRules])

  // Filtered indicators
  const filteredRules = useMemo(() => {
    if (!data?.rules) return []
    let list = [...data.rules]

    // 1. Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter(r => 
        r.rawName.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.domainName.toLowerCase().includes(q) ||
        (r.requirementLabel && r.requirementLabel.toLowerCase().includes(q))
      )
    }

    // 2. Domain Filter
    if (selectedDomain !== 'all') {
      list = list.filter(r => r.domainId === selectedDomain)
    }

    // 3. Direction Filter
    if (selectedDirection !== 'all') {
      list = list.filter(r => r.direction === selectedDirection)
    }

    // 4. Scope Filter
    if (selectedScope === 'general') {
      list = list.filter(r => r.isGeneral)
    } else if (selectedScope === 'specific') {
      list = list.filter(r => !r.isGeneral)
    }

    return list
  }, [data, searchQuery, selectedDomain, selectedDirection, selectedScope])

  // Export to CSV
  const handleExportCSV = () => {
    if (!filteredRules.length) return

    const headers = [
      'م',
      'اسم المؤشر',
      'التصنيف والمجال',
      'الاتجاه',
      'المستهدف (الأخضر)',
      'منطقة التحذير (الأصفر)',
      'الحد الحرج (الأحمر)',
      'نطاق التطبيق',
      'الدورية'
    ]

    const rows = filteredRules.map(r => [
      r.index,
      `"${r.title.replace(/"/g, '""')}"`,
      `"${r.domainName.replace(/"/g, '""')}"`,
      `"${r.directionLabel.replace(/"/g, '""')}"`,
      `"${r.greenBand.replace(/"/g, '""')}"`,
      `"${r.yellowBand.replace(/"/g, '""')}"`,
      `"${r.redBand.replace(/"/g, '""')}"`,
      `"${r.requirementLabel.replace(/"/g, '""')}"`,
      `"${r.frequency}"`
    ])

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `دليل_حدود_المؤشرات_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Print view
  const handlePrint = () => {
    window.print()
  }

  if (loading) {
    return (
      <div className="container" style={{ padding: '40px 20px', textAlign: 'center' }}>
        <div className="card" style={{ maxWidth: 500, margin: '60px auto', padding: 40 }}>
          <div className="spinner" style={{ margin: '0 auto 20px', width: 48, height: 48 }}></div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 8 }}>جارٍ تحميل دليل وقواعد حدود المؤشرات...</h2>
          <p className="text-secondary" style={{ fontSize: '0.9rem' }}>يتم جلب وتصنيف الـ 84 مؤشراً من شيت جوجل المعتمد</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container" style={{ padding: '40px 20px' }}>
        <div className="card" style={{ maxWidth: 600, margin: '60px auto', padding: 32, textAlign: 'center', borderColor: 'var(--danger)' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ color: 'var(--danger)', fontSize: '1.25rem', fontWeight: 700, marginBottom: 12 }}>تعذر تحميل حدود المؤشرات</h2>
          <p className="text-secondary" style={{ marginBottom: 24, fontSize: '0.95rem' }}>{error}</p>
          <button onClick={() => fetchRules(true)} className="btn btn-primary" style={{ margin: '0 auto' }}>
            <ArrowPathIcon className="w-5 h-5 ml-2" />
            إعادة المحاولة
          </button>
        </div>
      </div>
    )
  }

  const { stats, domains } = data || { stats: {}, domains: [] }

  return (
    <div className="container" style={{ paddingBottom: 60 }}>
      {/* Toast Notification */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: '#0f172a',
          color: '#ffffff',
          padding: '12px 24px',
          borderRadius: 8,
          boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
          zIndex: 9999,
          fontSize: '0.9rem',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          <CheckIcon className="w-5 h-5" style={{ color: 'var(--success)' }} />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header Section */}
      <div className="no-print" style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: 24,
        paddingTop: 8
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              borderRadius: 8,
              backgroundColor: 'var(--primary-glow)',
              color: 'var(--primary)',
              fontSize: '1.25rem'
            }}>📊</span>
            <h1 style={{ fontSize: '1.65rem', fontWeight: 800, margin: 0, color: 'var(--text-title)' }}>
              دليل وقواعد حدود المؤشرات الشهرية
            </h1>
            <span style={{
              backgroundColor: 'var(--success-bg)',
              color: 'var(--success)',
              padding: '2px 10px',
              borderRadius: 20,
              fontSize: '0.75rem',
              fontWeight: 700
            }}>
              معتمد ومتاح للجميع
            </span>
          </div>
          <p className="text-secondary" style={{ fontSize: '0.92rem', margin: 0 }}>
            المرجع الرسمي لحدود ومستهدفات الأداء لـ <strong>{stats.total || 84} مؤشراً</strong> تشمل النطاقات الآمنة، التحذيرية، والحرجة لمستشفيات القطاع.
          </p>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={() => fetchRules(true)}
            disabled={refreshing}
            className="btn btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}
            title="مزامنة فورية مع شيت جوجل المعتمد"
          >
            <ArrowPathIcon className={`w-4 h-4 ${refreshing ? 'spin' : ''}`} />
            <span>{refreshing ? 'جارٍ المزامنة...' : 'تحديث من شيت جوجل'}</span>
          </button>

          <button
            onClick={handleExportCSV}
            className="btn btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}
          >
            <span>📥 تصدير الدليل (CSV)</span>
          </button>

          <button
            onClick={handlePrint}
            className="btn btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}
          >
            <span>🖨️ طباعة الدليل</span>
          </button>

          <div style={{
            display: 'inline-flex',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: 3
          }}>
            <button
              onClick={() => setViewMode('cards')}
              style={{
                border: 'none',
                backgroundColor: viewMode === 'cards' ? 'var(--primary)' : 'transparent',
                color: viewMode === 'cards' ? '#fff' : 'var(--text-secondary)',
                padding: '6px 14px',
                borderRadius: 6,
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              بطاقات 🗂️
            </button>
            <button
              onClick={() => setViewMode('table')}
              style={{
                border: 'none',
                backgroundColor: viewMode === 'table' ? 'var(--primary)' : 'transparent',
                color: viewMode === 'table' ? '#fff' : 'var(--text-secondary)',
                padding: '6px 14px',
                borderRadius: 6,
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              جدول تفصيلي 📑
            </button>
          </div>
        </div>
      </div>

      {/* KPI Stats Overview Cards */}
      <div className="no-print" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 12,
        marginBottom: 24
      }}>
        <div className="card" style={{ padding: '16px 20px', borderTop: '3px solid var(--primary)' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600 }}>إجمالي المؤشرات</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-title)' }}>{stats.total || 84}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--neutral)' }}>مؤشر معتمد</span>
          </div>
        </div>

        <div className="card" style={{ padding: '16px 20px', borderTop: '3px solid #10b981' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600 }}>تصاعدية (الزيادة أفضل) 📈</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: '1.75rem', fontWeight: 800, color: '#10b981' }}>{stats.higherCount || 46}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--neutral)' }}>مستهدف عالي (≥)</span>
          </div>
        </div>

        <div className="card" style={{ padding: '16px 20px', borderTop: '3px solid #ef4444' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600 }}>تنازلية (الانخفاض أفضل) 📉</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: '1.75rem', fontWeight: 800, color: '#ef4444' }}>{stats.lowerCount || 31}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--neutral)' }}>مستهدف منخفض (≤)</span>
          </div>
        </div>

        <div className="card" style={{ padding: '16px 20px', borderTop: '3px solid #0284c7' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600 }}>نطاقات محددة 🎯</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0284c7' }}>{stats.rangeCount || 7}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--neutral)' }}>بين حدين (Range)</span>
          </div>
        </div>

        <div className="card" style={{ padding: '16px 20px', borderTop: '3px solid #f59e0b' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600 }}>مشروطة بأقسام معينة 🏥</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: '1.75rem', fontWeight: 800, color: '#f59e0b' }}>{stats.departmentSpecificCount || 26}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--neutral)' }}>جراحة / عناية / إلخ</span>
          </div>
        </div>

        <div className="card" style={{ padding: '16px 20px', borderTop: '3px solid #6366f1' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600 }}>عامة لكافة المستشفيات 🌐</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: '1.75rem', fontWeight: 800, color: '#6366f1' }}>{stats.generalCount || 58}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--neutral)' }}>إلزامية للجميع</span>
          </div>
        </div>
      </div>

      {/* Domain Navigation Pills */}
      <div className="no-print" style={{
        display: 'flex',
        gap: 8,
        overflowX: 'auto',
        paddingBottom: 8,
        marginBottom: 20
      }}>
        <button
          onClick={() => setSelectedDomain('all')}
          style={{
            whiteSpace: 'nowrap',
            padding: '7px 16px',
            borderRadius: 20,
            border: selectedDomain === 'all' ? '2px solid var(--primary)' : '1px solid var(--border)',
            backgroundColor: selectedDomain === 'all' ? 'var(--primary)' : 'var(--bg-card)',
            color: selectedDomain === 'all' ? '#fff' : 'var(--text-secondary)',
            fontWeight: 700,
            fontSize: '0.82rem',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
        >
          🌟 جميع المجالات ({stats.total || 84})
        </button>

        {domains.map(d => (
          <button
            key={d.id}
            onClick={() => setSelectedDomain(d.id)}
            style={{
              whiteSpace: 'nowrap',
              padding: '7px 16px',
              borderRadius: 20,
              border: selectedDomain === d.id ? `2px solid ${d.color}` : '1px solid var(--border)',
              backgroundColor: selectedDomain === d.id ? d.color : 'var(--bg-card)',
              color: selectedDomain === d.id ? '#fff' : 'var(--text-secondary)',
              fontWeight: 600,
              fontSize: '0.82rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.2s'
            }}
          >
            <span>{d.icon}</span>
            <span>{d.name}</span>
            <span style={{
              backgroundColor: selectedDomain === d.id ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.06)',
              padding: '1px 7px',
              borderRadius: 12,
              fontSize: '0.72rem'
            }}>
              {d.count}
            </span>
          </button>
        ))}
      </div>

      {/* Search and Secondary Filter Bar */}
      <div className="no-print card" style={{ padding: 16, marginBottom: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {/* Search Box */}
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder="🔍 ابحث باسم المؤشر أو الكود أو المتطلب..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="form-control"
              style={{ paddingRight: 14, width: '100%', fontSize: '0.88rem' }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--neutral)',
                  cursor: 'pointer',
                  fontSize: '0.85rem'
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Direction Filter */}
          <div>
            <select
              value={selectedDirection}
              onChange={(e) => setSelectedDirection(e.target.value)}
              className="form-control"
              style={{ width: '100%', fontSize: '0.88rem' }}
            >
              <option value="all">كل الاتجاهات (تصاعدي / تنازلي / نطاق)</option>
              <option value="higher">📈 مؤشرات تصاعدية فقط (الزيادة أفضل)</option>
              <option value="lower">📉 مؤشرات تنازلية فقط (الانخفاض أفضل)</option>
              <option value="range">🎯 مؤشرات نطاق محدد فقط (Range)</option>
            </select>
          </div>

          {/* Scope Filter */}
          <div>
            <select
              value={selectedScope}
              onChange={(e) => setSelectedScope(e.target.value)}
              className="form-control"
              style={{ width: '100%', fontSize: '0.88rem' }}
            >
              <option value="all">كافة نطاقات التطبيق</option>
              <option value="general">🌐 عامة لجميع المستشفيات فقط</option>
              <option value="specific">🏥 مشروطة بتوفر أقسام محددة (جراحة/عناية...)</option>
            </select>
          </div>
        </div>

        {/* Filter stats summary */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          <div>
            يتم عرض <strong>{filteredRules.length}</strong> مؤشراً من أصل <strong>{stats.total || 84}</strong> مؤشر
          </div>
          {(searchQuery || selectedDomain !== 'all' || selectedDirection !== 'all' || selectedScope !== 'all') && (
            <button
              onClick={() => {
                setSearchQuery('')
                setSelectedDomain('all')
                setSelectedDirection('all')
                setSelectedScope('all')
              }}
              style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}
            >
              إعادة ضبط الفلاتر ↺
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {filteredRules.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: 'center' }}>
          <div style={{ fontSize: 42, marginBottom: 12 }}>🔍</div>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: 8 }}>لا توجد مؤشرات مطابقة لخيارات البحث</h3>
          <p className="text-secondary" style={{ fontSize: '0.88rem', marginBottom: 20 }}>
            جرّب تغيير كلمات البحث أو إعادة ضبط الفلاتر لعرض المؤشرات
          </p>
          <button
            onClick={() => {
              setSearchQuery('')
              setSelectedDomain('all')
              setSelectedDirection('all')
              setSelectedScope('all')
            }}
            className="btn btn-secondary"
            style={{ margin: '0 auto' }}
          >
            عرض جميع المؤشرات
          </button>
        </div>
      ) : viewMode === 'cards' ? (
        /* Cards View */
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
          gap: 16
        }}>
          {filteredRules.map((rule) => (
            <div
              key={rule.id}
              className="card"
              style={{
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                transition: 'transform 0.2s, box-shadow 0.2s',
                position: 'relative',
                borderTop: `4px solid ${rule.domainColor}`
              }}
            >
              <div>
                {/* Header: Number, Domain, and Scope badge */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{
                      backgroundColor: 'rgba(0,0,0,0.06)',
                      color: 'var(--text-secondary)',
                      padding: '2px 8px',
                      borderRadius: 12,
                      fontSize: '0.72rem',
                      fontWeight: 700
                    }}>
                      #{rule.index}
                    </span>

                    <span style={{
                      backgroundColor: rule.domainBgColor,
                      color: rule.domainColor,
                      padding: '2px 9px',
                      borderRadius: 12,
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4
                    }}>
                      <span>{rule.domainIcon}</span>
                      <span>{rule.domainName}</span>
                    </span>
                  </div>

                  <span style={{
                    backgroundColor: rule.direction === 'higher' ? 'var(--success-bg)' : (rule.direction === 'lower' ? 'var(--danger-bg)' : 'rgba(2, 132, 199, 0.1)'),
                    color: rule.direction === 'higher' ? 'var(--success)' : (rule.direction === 'lower' ? 'var(--danger)' : '#0284c7'),
                    padding: '2px 8px',
                    borderRadius: 12,
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3
                  }}>
                    <span>{rule.directionIcon}</span>
                    <span>{rule.direction === 'higher' ? 'تصاعدي' : (rule.direction === 'lower' ? 'تنازلي' : 'نطاق')}</span>
                  </span>
                </div>

                {/* Indicator Title */}
                <h3 style={{
                  fontSize: '1.02rem',
                  fontWeight: 700,
                  color: 'var(--text-title)',
                  marginBottom: 14,
                  lineHeight: 1.45
                }}>
                  {rule.title}
                </h3>

                {/* Target and Thresholds Box */}
                <div style={{
                  backgroundColor: 'var(--bg-input)',
                  borderRadius: 'var(--radius-md)',
                  padding: 12,
                  marginBottom: 12
                }}>
                  {/* Green Zone (Target) */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: 'var(--success)', display: 'inline-block' }}></span>
                      <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-title)' }}>المستهدف الآمن (الأخضر):</span>
                    </div>
                    <span style={{ fontSize: '0.86rem', fontWeight: 800, color: 'var(--success)', direction: 'ltr' }}>
                      {rule.direction === 'higher' ? `≥ ${rule.minOk}${rule.unit}` : (rule.direction === 'lower' ? `≤ ${rule.maxOk}${rule.unit}` : `${rule.minOk} - ${rule.maxOk} ${rule.unit}`)}
                    </span>
                  </div>

                  {/* Yellow Zone (Warning) */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: 'var(--warning)', display: 'inline-block' }}></span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>منطقة التحذير (الأصفر):</span>
                    </div>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--warning-dark)' }}>
                      {rule.yellowBand}
                    </span>
                  </div>

                  {/* Red Zone (Critical) */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: 'var(--danger)', display: 'inline-block' }}></span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>الحد الحرج (الأحمر):</span>
                    </div>
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--danger)' }}>
                      {rule.redBand}
                    </span>
                  </div>
                </div>

                {/* Visual Gauge Bar */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{
                    height: 8,
                    borderRadius: 4,
                    display: 'flex',
                    overflow: 'hidden',
                    backgroundColor: '#e2e8f0'
                  }}>
                    {rule.direction === 'higher' ? (
                      <>
                        <div style={{ flex: 3, backgroundColor: 'var(--danger)' }} title="أقل من الحد الحرج"></div>
                        <div style={{ flex: 2, backgroundColor: 'var(--warning)' }} title="منطقة تحذير"></div>
                        <div style={{ flex: 5, backgroundColor: 'var(--success)' }} title="مطابق للمستهدف"></div>
                      </>
                    ) : rule.direction === 'lower' ? (
                      <>
                        <div style={{ flex: 5, backgroundColor: 'var(--success)' }} title="مطابق للمستهدف"></div>
                        <div style={{ flex: 2, backgroundColor: 'var(--warning)' }} title="منطقة تحذير"></div>
                        <div style={{ flex: 3, backgroundColor: 'var(--danger)' }} title="تجاوز الحد الحرج"></div>
                      </>
                    ) : (
                      <>
                        <div style={{ flex: 2, backgroundColor: 'var(--warning)' }}></div>
                        <div style={{ flex: 6, backgroundColor: 'var(--success)' }} title="النطاق المستهدف"></div>
                        <div style={{ flex: 2, backgroundColor: 'var(--danger)' }} title="انحراف حرج"></div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Card Footer: Requirement & Action */}
              <div style={{
                paddingTop: 10,
                borderTop: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.78rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ color: rule.isGeneral ? 'var(--neutral)' : '#ea580c' }}>
                    {rule.isGeneral ? '🌐' : '🏥'}
                  </span>
                  <span style={{
                    color: rule.isGeneral ? 'var(--neutral)' : '#ea580c',
                    fontWeight: rule.isGeneral ? 500 : 700
                  }}>
                    {rule.requirementLabel}
                  </span>
                </div>

                <button
                  onClick={() => setSelectedIndicatorModal(rule)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--primary)',
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontSize: '0.78rem'
                  }}
                >
                  التفاصيل كاملة ↗
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Table View */
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.86rem' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-input)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '12px 16px', fontWeight: 700, width: 40 }}>#</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>اسم المؤشر</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>المجال والتصنيف</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>الاتجاه</th>
                <th style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--success-dark)' }}>المستهدف (الأخضر)</th>
                <th style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--warning-dark)' }}>منطقة التحذير (الأصفر)</th>
                <th style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--danger-dark)' }}>الحد الحرج (الأحمر)</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>نطاق التطبيق</th>
                <th style={{ padding: '12px 16px', fontWeight: 700, textAlign: 'center' }}>تفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {filteredRules.map((rule, idx) => (
                <tr
                  key={rule.id}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    backgroundColor: idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-card-hover)',
                    transition: 'background-color 0.15s'
                  }}
                >
                  <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--neutral)' }}>{rule.index}</td>
                  <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--text-title)' }}>
                    <div>{rule.title}</div>
                    {rule.rawName !== rule.title && (
                      <div style={{ fontSize: '0.74rem', color: 'var(--neutral)', marginTop: 2 }}>{rule.rawName}</div>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      backgroundColor: rule.domainBgColor,
                      color: rule.domainColor,
                      padding: '2px 8px',
                      borderRadius: 12,
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4
                    }}>
                      <span>{rule.domainIcon}</span>
                      <span>{rule.domainName}</span>
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      color: rule.direction === 'higher' ? 'var(--success)' : (rule.direction === 'lower' ? 'var(--danger)' : '#0284c7'),
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4
                    }}>
                      <span>{rule.directionIcon}</span>
                      <span>{rule.direction === 'higher' ? 'تصاعدي' : (rule.direction === 'lower' ? 'تنازلي' : 'نطاق')}</span>
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--success)', direction: 'ltr', textAlign: 'right' }}>
                    {rule.direction === 'higher' ? `≥ ${rule.minOk}${rule.unit}` : (rule.direction === 'lower' ? `≤ ${rule.maxOk}${rule.unit}` : `${rule.minOk} - ${rule.maxOk} ${rule.unit}`)}
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--warning-dark)', fontSize: '0.8rem' }}>
                    {rule.yellowBand}
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--danger)', fontSize: '0.8rem' }}>
                    {rule.redBand}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      backgroundColor: rule.isGeneral ? 'rgba(0,0,0,0.05)' : 'rgba(234, 88, 12, 0.1)',
                      color: rule.isGeneral ? 'var(--text-secondary)' : '#ea580c',
                      padding: '3px 8px',
                      borderRadius: 6,
                      fontSize: '0.76rem',
                      fontWeight: rule.isGeneral ? 500 : 700,
                      display: 'inline-block'
                    }}>
                      {rule.requirementLabel}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                    <button
                      onClick={() => setSelectedIndicatorModal(rule)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--primary)',
                        cursor: 'pointer',
                        padding: 4
                      }}
                      title="عرض كامل التفاصيل"
                    >
                      👁️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Reference Guide Box */}
      <div className="card" style={{ marginTop: 32, padding: 24, backgroundColor: 'var(--bg-card)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: '1.4rem' }}>📘</span>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>
            دليل تفسير ومطابقة حدود المؤشرات لمستشفيات القطاع
          </h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
          <div>
            <h4 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--primary)', marginBottom: 8 }}>
              1. كيف تفهم دلالات الألوان في المؤشرات؟
            </h4>
            <ul style={{ paddingRight: 20, fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              <li>
                <strong style={{ color: 'var(--success)' }}>النطاق الأخضر (المستهدف الآمن):</strong> يعني تحقيق المستشفى للمعدل الموصى به رسمياً ويُعد الأداء مطابقاً لمعايير الجودة وسلامة المرضى.
              </li>
              <li>
                <strong style={{ color: 'var(--warning-dark)' }}>النطاق الأصفر (منطقة التحذير):</strong> انحراف طفيف عن المستهدف يستلزم المتابعة واتخاذ إجراءات تحسينية مبكرة قبل تفاقم المشكلة.
              </li>
              <li>
                <strong style={{ color: 'var(--danger)' }}>النطاق الأحمر (الخطر الحرج):</strong> تجاوز الحد الحرج مما يشكل خطراً مباشراً على سلامة المرضى أو الكفاءة التشغيلية ويستوجب تدخلاً عاجلاً وفوري.
              </li>
            </ul>
          </div>

          <div>
            <h4 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--primary)', marginBottom: 8 }}>
              2. اتجاهات المؤشرات (تصاعدي / تنازلي / نطاق):
            </h4>
            <ul style={{ paddingRight: 20, fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              <li>
                <strong>تصاعدي (📈):</strong> مؤشرات إيجابية مثل نظافة الأيدي، التعريف الصحيح، وتطبيق البروتوكولات (كلما زادت النسبة نحو 100% كان أفضل).
              </li>
              <li>
                <strong>تنازلي (📉):</strong> مؤشرات أحداث سلبية مثل السقوط، قرح الفراش، عدوى المستشفيات، والوفيات (كلما انخفضت النسبة نحو 0% كان أفضل).
              </li>
              <li>
                <strong>نطاق محدد (🎯):</strong> مؤشرات تشغيلية كدوران السرير ومدة الإقامة (المطلوب البقاء ضمن النطاق الأمثل دون زيادة أو نقصان مفرط).
              </li>
            </ul>
          </div>

          <div>
            <h4 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--primary)', marginBottom: 8 }}>
              3. متطلبات الأقسام والخدمات (Requires):
            </h4>
            <ul style={{ paddingRight: 20, fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              <li>
                توجد <strong>26 مؤشراً مشروطة</strong> بتوفر خدمات محددة داخل المستشفى (مثل العمليات الجراحية الكبرى، العناية المركزة، الحضانات، أو العيادات المسائية).
              </li>
              <li>
                المستشفيات التي لا تتوفر بها تلك الخدمات <em>تُعفى رسمياً</em> من تسجيل المؤشر ولا تُحسب كعدم استجابة في تقييم الامتثال الشهري.
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Indicator Detail Modal */}
      {selectedIndicatorModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          padding: 16
        }}>
          <div className="card" style={{
            maxWidth: 600,
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: 28,
            borderRadius: 'var(--radius-lg)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.2)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <span style={{
                  backgroundColor: selectedIndicatorModal.domainBgColor,
                  color: selectedIndicatorModal.domainColor,
                  padding: '3px 10px',
                  borderRadius: 12,
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  marginBottom: 6
                }}>
                  <span>{selectedIndicatorModal.domainIcon}</span>
                  <span>{selectedIndicatorModal.domainName}</span>
                </span>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-title)', margin: 0 }}>
                  #{selectedIndicatorModal.index} - {selectedIndicatorModal.title}
                </h3>
              </div>
              <button
                onClick={() => setSelectedIndicatorModal(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: 'var(--neutral)'
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ backgroundColor: 'var(--bg-input)', padding: 16, borderRadius: 'var(--radius-md)', marginBottom: 20 }}>
              <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                <strong>الاسم الرسمي في شيت المؤشرات:</strong> {selectedIndicatorModal.rawName}
              </div>
              <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                <strong>الدورية:</strong> {selectedIndicatorModal.frequency}
              </div>
              <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                <strong>وحدة القياس:</strong> {selectedIndicatorModal.unit === '%' ? 'نسبة مئوية (%)' : selectedIndicatorModal.unit}
              </div>
            </div>

            <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 12 }}>نطاقات وحدود التقييم المعتمدة:</h4>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              <div style={{
                padding: 12,
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--success-bg)',
                borderRight: '4px solid var(--success)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--success)', fontSize: '0.88rem' }}>🟢 النطاق المستهدف (المطابق)</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>أداء ممتاز ومطابق للمعايير القياسية</div>
                </div>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--success)', direction: 'ltr' }}>
                  {selectedIndicatorModal.greenBand}
                </div>
              </div>

              <div style={{
                padding: 12,
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--warning-bg)',
                borderRight: '4px solid var(--warning)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--warning-dark)', fontSize: '0.88rem' }}>🟡 منطقة التحذير (انحراف بسيط)</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>يتطلب المتابعة والتدخل التحسيني</div>
                </div>
                <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--warning-dark)' }}>
                  {selectedIndicatorModal.yellowBand}
                </div>
              </div>

              <div style={{
                padding: 12,
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--danger-bg)',
                borderRight: '4px solid var(--danger)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--danger)', fontSize: '0.88rem' }}>🔴 الحد الحرج (خطر داهم)</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>انحراف حرج يمس سلامة المرضى أو التشغيل</div>
                </div>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--danger)', direction: 'ltr' }}>
                  {selectedIndicatorModal.redBand}
                </div>
              </div>
            </div>

            <div style={{
              padding: 14,
              borderRadius: 'var(--radius-md)',
              backgroundColor: selectedIndicatorModal.isGeneral ? 'rgba(0,0,0,0.03)' : 'rgba(234, 88, 12, 0.08)',
              border: `1px solid ${selectedIndicatorModal.isGeneral ? 'var(--border)' : 'rgba(234, 88, 12, 0.3)'}`,
              marginBottom: 20
            }}>
              <div style={{ fontWeight: 700, color: selectedIndicatorModal.isGeneral ? 'var(--text-title)' : '#ea580c', fontSize: '0.88rem', marginBottom: 4 }}>
                {selectedIndicatorModal.isGeneral ? '🌐 نطاق التطبيق: عام لجميع المستشفيات' : `🏥 نطاق التطبيق: ${selectedIndicatorModal.requirementLabel}`}
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                {selectedIndicatorModal.requirementDescription}
              </div>
            </div>

            <button
              onClick={() => setSelectedIndicatorModal(null)}
              className="btn btn-secondary"
              style={{ width: '100%', padding: '10px' }}
            >
              إغلاق النافذة
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

