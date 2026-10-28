'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowPathIcon,
  CheckIcon,
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
  const [selectedDirection, setSelectedDirection] = useState('all')
  const [selectedScope, setSelectedScope] = useState('all')
  const [selectedIndicatorModal, setSelectedIndicatorModal] = useState(null)

  const showToast = useCallback((msg) => {
    setToastMessage(msg)
    setTimeout(() => {
      setToastMessage('')
    }, 3000)
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

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter(r => 
        r.rawName.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.domainName.toLowerCase().includes(q) ||
        (r.requirementLabel && r.requirementLabel.toLowerCase().includes(q))
      )
    }

    if (selectedDomain !== 'all') {
      list = list.filter(r => r.domainId === selectedDomain)
    }

    if (selectedDirection !== 'all') {
      list = list.filter(r => r.direction === selectedDirection)
    }

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
      'المجال',
      'الاتجاه',
      'المستهدف',
      'التحذير',
      'الحد الحرج',
      'نطاق التطبيق'
    ]

    const rows = filteredRules.map(r => [
      r.index,
      `"${r.title.replace(/"/g, '""')}"`,
      `"${r.domainName.replace(/"/g, '""')}"`,
      `"${r.directionLabel}"`,
      `"${r.greenBand}"`,
      `"${r.yellowBand}"`,
      `"${r.redBand}"`,
      `"${r.requirementLabel}"`
    ])

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `حدود_المؤشرات_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  if (loading) {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center' }}>
        <div className="card" style={{ maxWidth: 380, margin: '0 auto', padding: 28 }}>
          <div className="spinner" style={{ margin: '0 auto 16px', width: 36, height: 36 }}></div>
          <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>جارٍ تحميل حدود المؤشرات...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '40px 20px' }}>
        <div className="card" style={{ maxWidth: 450, margin: '0 auto', padding: 24, textAlign: 'center', borderColor: 'var(--danger)' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
          <div style={{ color: 'var(--danger)', fontSize: '1rem', fontWeight: 700, marginBottom: 8 }}>تعذر تحميل البيانات</div>
          <p className="text-secondary" style={{ marginBottom: 16, fontSize: '0.85rem' }}>{error}</p>
          <button onClick={() => fetchRules(true)} className="btn btn-primary btn-sm">
            إعادة المحاولة
          </button>
        </div>
      </div>
    )
  }

  const { domains = [] } = data || {}

  return (
    <div style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', overflowX: 'hidden', paddingBottom: 40 }}>
      {/* Toast Notification */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: '#0f172a',
          color: '#ffffff',
          padding: '10px 20px',
          borderRadius: 8,
          boxShadow: '0 8px 20px rgba(0,0,0,0.2)',
          zIndex: 9999,
          fontSize: '0.85rem',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          <CheckIcon className="w-4 h-4" style={{ color: 'var(--success)' }} />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Sleek Header & Controls Bar */}
      <div className="no-print" style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 16,
        width: '100%',
        boxSizing: 'border-box'
      }}>
        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: 'var(--text-title)' }}>
            حدود وقواعد المؤشرات
          </h1>
          <span style={{
            backgroundColor: 'rgba(0, 122, 135, 0.1)',
            color: 'var(--primary)',
            padding: '2px 8px',
            borderRadius: 12,
            fontSize: '0.75rem',
            fontWeight: 700
          }}>
            84 مؤشراً
          </span>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => fetchRules(true)}
            disabled={refreshing}
            className="btn btn-secondary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', padding: '6px 12px' }}
            title="مزامنة فورية من شيت جوجل"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${refreshing ? 'spin' : ''}`} />
            <span>{refreshing ? 'مزامنة...' : 'تحديث'}</span>
          </button>

          <button
            onClick={handleExportCSV}
            className="btn btn-secondary btn-sm"
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
          >
            تصدير CSV
          </button>

          <div style={{
            display: 'inline-flex',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: 2
          }}>
            <button
              onClick={() => setViewMode('cards')}
              style={{
                border: 'none',
                backgroundColor: viewMode === 'cards' ? 'var(--primary)' : 'transparent',
                color: viewMode === 'cards' ? '#fff' : 'var(--text-secondary)',
                padding: '4px 10px',
                borderRadius: 4,
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              بطاقات
            </button>
            <button
              onClick={() => setViewMode('table')}
              style={{
                border: 'none',
                backgroundColor: viewMode === 'table' ? 'var(--primary)' : 'transparent',
                color: viewMode === 'table' ? '#fff' : 'var(--text-secondary)',
                padding: '4px 10px',
                borderRadius: 4,
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              جدول
            </button>
          </div>
        </div>
      </div>

      {/* Unified Compact Filters Bar */}
      <div className="no-print card" style={{
        padding: '10px 14px',
        marginBottom: 16,
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box'
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 10,
          width: '100%',
          boxSizing: 'border-box'
        }}>
          {/* Search Input */}
          <div style={{ position: 'relative', minWidth: 0 }}>
            <input
              type="text"
              placeholder="🔍 ابحث في المؤشرات..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="form-control"
              style={{ width: '100%', fontSize: '0.84rem', padding: '6px 10px', boxSizing: 'border-box' }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  left: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--neutral)',
                  cursor: 'pointer',
                  fontSize: '0.8rem'
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Domain Filter */}
          <div style={{ minWidth: 0 }}>
            <select
              value={selectedDomain}
              onChange={(e) => setSelectedDomain(e.target.value)}
              className="form-control"
              style={{ width: '100%', fontSize: '0.84rem', padding: '6px 10px', boxSizing: 'border-box' }}
            >
              <option value="all">كافة المجالات (84)</option>
              {domains.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.count})
                </option>
              ))}
            </select>
          </div>

          {/* Direction Filter */}
          <div style={{ minWidth: 0 }}>
            <select
              value={selectedDirection}
              onChange={(e) => setSelectedDirection(e.target.value)}
              className="form-control"
              style={{ width: '100%', fontSize: '0.84rem', padding: '6px 10px', boxSizing: 'border-box' }}
            >
              <option value="all">كافة الاتجاهات</option>
              <option value="higher">📈 تصاعدي (الزيادة أفضل)</option>
              <option value="lower">📉 تنازلي (الانخفاض أفضل)</option>
              <option value="range">🎯 نطاق محدد (Range)</option>
            </select>
          </div>

          {/* Scope Filter */}
          <div style={{ minWidth: 0 }}>
            <select
              value={selectedScope}
              onChange={(e) => setSelectedScope(e.target.value)}
              className="form-control"
              style={{ width: '100%', fontSize: '0.84rem', padding: '6px 10px', boxSizing: 'border-box' }}
            >
              <option value="all">كافة المستشفيات والأقسام</option>
              <option value="general">🌐 عام لجميع المستشفيات</option>
              <option value="specific">🏥 مشروط بأقسام محددة</option>
            </select>
          </div>
        </div>

        {/* Active search/filter reset line */}
        {(searchQuery || selectedDomain !== 'all' || selectedDirection !== 'all' || selectedScope !== 'all') && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', fontSize: '0.78rem' }}>
            <span className="text-secondary">عرض {filteredRules.length} من 84 مؤشراً</span>
            <button
              onClick={() => {
                setSearchQuery('')
                setSelectedDomain('all')
                setSelectedDirection('all')
                setSelectedScope('all')
              }}
              style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontWeight: 600, fontSize: '0.78rem' }}
            >
              إلغاء الفلاتر ↺
            </button>
          </div>
        )}
      </div>

      {/* Main Grid: Responsive & Contained without horizontal overflow */}
      {filteredRules.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 6 }}>لا توجد مؤشرات مطابقة للبحث</div>
          <button
            onClick={() => {
              setSearchQuery('')
              setSelectedDomain('all')
              setSelectedDirection('all')
              setSelectedScope('all')
            }}
            className="btn btn-secondary btn-sm"
          >
            عرض الكل
          </button>
        </div>
      ) : viewMode === 'cards' ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 12,
          width: '100%',
          maxWidth: '100%',
          boxSizing: 'border-box'
        }}>
          {filteredRules.map((rule) => (
            <div
              key={rule.id}
              className="card"
              onClick={() => setSelectedIndicatorModal(rule)}
              style={{
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                borderTop: `3px solid ${rule.domainColor}`,
                cursor: 'pointer',
                minWidth: 0,
                width: '100%',
                boxSizing: 'border-box',
                transition: 'transform 0.15s, box-shadow 0.15s'
              }}
            >
              <div>
                {/* Meta Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                    <span style={{
                      backgroundColor: 'rgba(0,0,0,0.05)',
                      color: 'var(--text-secondary)',
                      padding: '1px 6px',
                      borderRadius: 10,
                      fontSize: '0.7rem',
                      fontWeight: 700
                    }}>
                      #{rule.index}
                    </span>

                    <span style={{
                      color: rule.domainColor,
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {rule.domainIcon} {rule.domainName}
                    </span>
                  </div>

                  <span style={{
                    color: rule.direction === 'higher' ? 'var(--success)' : (rule.direction === 'lower' ? 'var(--danger)' : '#0284c7'),
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    whiteSpace: 'nowrap'
                  }}>
                    {rule.directionIcon} {rule.directionLabel}
                  </span>
                </div>

                {/* Title */}
                <h3 style={{
                  fontSize: '0.92rem',
                  fontWeight: 700,
                  color: 'var(--text-title)',
                  marginBottom: 12,
                  lineHeight: 1.4,
                  minHeight: '2.5rem'
                }}>
                  {rule.title}
                </h3>

                {/* Compact Thresholds Box */}
                <div style={{
                  backgroundColor: 'var(--bg-input)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '8px 10px',
                  marginBottom: 10,
                  fontSize: '0.78rem'
                }}>
                  {/* Green Target */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>المستهدف:</span>
                    <span style={{ fontWeight: 800, color: 'var(--success)', direction: 'ltr' }}>
                      {rule.greenBand}
                    </span>
                  </div>

                  {/* Yellow Warning */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>التحذير:</span>
                    <span style={{ fontWeight: 600, color: 'var(--warning-dark)', direction: 'ltr' }}>
                      {rule.yellowBand}
                    </span>
                  </div>

                  {/* Red Critical */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>الحد الحرج:</span>
                    <span style={{ fontWeight: 800, color: 'var(--danger)', direction: 'ltr' }}>
                      {rule.redBand}
                    </span>
                  </div>
                </div>

                {/* Color Gauge Bar */}
                <div style={{
                  height: 4,
                  borderRadius: 2,
                  display: 'flex',
                  overflow: 'hidden',
                  backgroundColor: '#e2e8f0',
                  marginBottom: 8
                }}>
                  {rule.direction === 'higher' ? (
                    <>
                      <div style={{ flex: 3, backgroundColor: 'var(--danger)' }}></div>
                      <div style={{ flex: 2, backgroundColor: 'var(--warning)' }}></div>
                      <div style={{ flex: 5, backgroundColor: 'var(--success)' }}></div>
                    </>
                  ) : rule.direction === 'lower' ? (
                    <>
                      <div style={{ flex: 5, backgroundColor: 'var(--success)' }}></div>
                      <div style={{ flex: 2, backgroundColor: 'var(--warning)' }}></div>
                      <div style={{ flex: 3, backgroundColor: 'var(--danger)' }}></div>
                    </>
                  ) : (
                    <>
                      <div style={{ flex: 2, backgroundColor: 'var(--warning)' }}></div>
                      <div style={{ flex: 6, backgroundColor: 'var(--success)' }}></div>
                      <div style={{ flex: 2, backgroundColor: 'var(--danger)' }}></div>
                    </>
                  )}
                </div>
              </div>

              {/* Scope Footer */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.72rem',
                color: 'var(--text-secondary)',
                paddingTop: 6,
                borderTop: '1px solid var(--border)'
              }}>
                <span style={{ color: rule.isGeneral ? 'var(--neutral)' : '#ea580c', fontWeight: rule.isGeneral ? 500 : 700 }}>
                  {rule.isGeneral ? '🌐 عام' : `🏥 ${rule.requirementLabel}`}
                </span>
                <span style={{ color: 'var(--primary)', fontWeight: 600 }}>التفاصيل ↗</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Table View */
        <div className="card" style={{ padding: 0, overflowX: 'auto', width: '100%', boxSizing: 'border-box' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-input)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '8px 12px', fontWeight: 700, width: 36 }}>#</th>
                <th style={{ padding: '8px 12px', fontWeight: 700 }}>اسم المؤشر</th>
                <th style={{ padding: '8px 12px', fontWeight: 700 }}>المجال</th>
                <th style={{ padding: '8px 12px', fontWeight: 700 }}>الاتجاه</th>
                <th style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--success)' }}>المستهدف</th>
                <th style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--warning-dark)' }}>التحذير</th>
                <th style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--danger)' }}>الحد الحرج</th>
                <th style={{ padding: '8px 12px', fontWeight: 700 }}>نطاق التطبيق</th>
              </tr>
            </thead>
            <tbody>
              {filteredRules.map((rule, idx) => (
                <tr
                  key={rule.id}
                  onClick={() => setSelectedIndicatorModal(rule)}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    backgroundColor: idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-card-hover)',
                    cursor: 'pointer'
                  }}
                >
                  <td style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--neutral)' }}>{rule.index}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--text-title)' }}>{rule.title}</td>
                  <td style={{ padding: '8px 12px', color: rule.domainColor, fontWeight: 600 }}>{rule.domainName}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 600 }}>
                    <span style={{ color: rule.direction === 'higher' ? 'var(--success)' : (rule.direction === 'lower' ? 'var(--danger)' : '#0284c7') }}>
                      {rule.directionIcon} {rule.directionLabel}
                    </span>
                  </td>
                  <td style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--success)', direction: 'ltr', textAlign: 'right' }}>
                    {rule.greenBand}
                  </td>
                  <td style={{ padding: '8px 12px', color: 'var(--warning-dark)', direction: 'ltr', textAlign: 'right' }}>
                    {rule.yellowBand}
                  </td>
                  <td style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--danger)', direction: 'ltr', textAlign: 'right' }}>
                    {rule.redBand}
                  </td>
                  <td style={{ padding: '8px 12px', color: rule.isGeneral ? 'var(--neutral)' : '#ea580c', fontWeight: rule.isGeneral ? 500 : 700 }}>
                    {rule.requirementLabel}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Simple Details Modal */}
      {selectedIndicatorModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          padding: 16
        }}>
          <div className="card" style={{
            maxWidth: 480,
            width: '100%',
            padding: 20,
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 15px 30px rgba(0,0,0,0.2)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: selectedIndicatorModal.domainColor, fontWeight: 700 }}>
                  {selectedIndicatorModal.domainIcon} {selectedIndicatorModal.domainName}
                </span>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, margin: '4px 0 0', color: 'var(--text-title)' }}>
                  #{selectedIndicatorModal.index} - {selectedIndicatorModal.title}
                </h3>
              </div>
              <button
                onClick={() => setSelectedIndicatorModal(null)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'var(--neutral)' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16, fontSize: '0.84rem' }}>
              <div style={{ padding: 10, borderRadius: 6, backgroundColor: 'var(--success-bg)', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--success)', fontWeight: 700 }}>المستهدف (الأخضر):</span>
                <span style={{ fontWeight: 800, color: 'var(--success)', direction: 'ltr' }}>{selectedIndicatorModal.greenBand}</span>
              </div>
              <div style={{ padding: 10, borderRadius: 6, backgroundColor: 'var(--warning-bg)', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--warning-dark)', fontWeight: 700 }}>منطقة التحذير (الأصفر):</span>
                <span style={{ fontWeight: 700, color: 'var(--warning-dark)', direction: 'ltr' }}>{selectedIndicatorModal.yellowBand}</span>
              </div>
              <div style={{ padding: 10, borderRadius: 6, backgroundColor: 'var(--danger-bg)', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--danger)', fontWeight: 700 }}>الحد الحرج (الأحمر):</span>
                <span style={{ fontWeight: 800, color: 'var(--danger)', direction: 'ltr' }}>{selectedIndicatorModal.redBand}</span>
              </div>
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
              <div><strong>نطاق التطبيق:</strong> {selectedIndicatorModal.requirementDescription}</div>
              <div><strong>الدورية:</strong> شهرياً</div>
            </div>

            <button
              onClick={() => setSelectedIndicatorModal(null)}
              className="btn btn-secondary btn-sm"
              style={{ width: '100%' }}
            >
              إغلاق
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
