'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useToast } from '@/components/Toast'
import {
  EllipsisVerticalIcon,
  CheckIcon,
  XMarkIcon,
  ArrowPathIcon,
  ChatBubbleIcon,
  ExclamationCircleIcon,
} from '@/components/Icons'

function CollapsibleNote({ label, text, type = 'warning' }) {
  const [expanded, setExpanded] = useState(false)
  if (!text) return null
  const isLong = text.length > 90
  const displayText = !isLong || expanded ? text : `${text.slice(0, 90)}...`

  return (
    <div
      className={`resolution-note-box alert ${type === 'success' ? 'alert-success' : 'alert-warning'}`}
      style={{ padding: '6px 10px', fontSize: 12, marginTop: 8 }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <span>{type === 'success' ? '✅' : '💬'}</span>
        <div style={{ flex: 1 }}>
          <strong>{label}: </strong>
          <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{displayText}</span>
          {isLong && (
            <div>
              <button
                type="button"
                className="resolution-note-toggle"
                onClick={(e) => {
                  e.stopPropagation()
                  setExpanded((prev) => !prev)
                }}
              >
                {expanded ? 'عرض أقل ▴' : 'عرض المزيد ▾'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const STATUS_CONFIG = {
  open: { label: 'مفتوحة', color: 'var(--danger-light)', bgClass: 'open' },
  recurring: { label: 'متكررة', color: 'var(--warning-light)', bgClass: 'recurring' },
  resolved_by_hospital: { label: 'بانتظار التأكيد', color: 'var(--warning-light)', bgClass: 'resolved_by_hospital' },
  resolved_confirmed: { label: 'تم التلافي ✅', color: 'var(--success-light)', bgClass: 'resolved_confirmed' },
}

const PRIORITY_CONFIG = {
  high: { label: 'خطورة عالية', class: 'badge-danger' },
  medium: { label: 'متوسطة', class: 'badge-warning' },
  low: { label: 'منخفضة', class: 'badge-success' },
}

const normalizeArabic = (text) => {
  if (!text) return ''
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
}

export default function DepartmentPage() {
  const { id: hospitalId, deptId } = useParams()
  const [dept, setDept] = useState(null)
  const [hospital, setHospital] = useState(null)
  const [findings, setFindings] = useState([])
  const [loading, setLoading] = useState(true)
  const { showToast } = useToast()
  const [updatingId, setUpdatingId] = useState(null)
  const [noteModal, setNoteModal] = useState(null) // { findingId, action }
  const [note, setNote] = useState('')
  const [userRole, setUserRole] = useState('directorate_member')
  const [filter, setFilter] = useState('active') // 'active' | 'pending' | 'resolved' | 'all'
  const [addingNew, setAddingNew] = useState(false)
  const [newFinding, setNewFinding] = useState({ text: '', corrective: '', responsible: '', deadline: '', priority: 'medium' })

  // Phase 2 Step 2: Search, Sort & Pagination State
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState('default') // 'default' | 'priority' | 'date'
  const [sortDirection, setSortDirection] = useState('desc') // 'asc' | 'desc'
  const [currentPage, setCurrentPage] = useState(1)
  const PAGE_SIZE = 20

  // Confirmation Modal State
  const [confirmModal, setConfirmModal] = useState(null) // { title, message, actionText, actionType, onConfirm }

  useEffect(() => {
    fetchData()
    fetchUserRole()
  }, [deptId])

  const fetchUserRole = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      if (profile) setUserRole(profile.role)
    }
  }

  const fetchData = async () => {
    const [deptRes, hospRes, findingsRes] = await Promise.all([
      supabase.from('departments').select('*').eq('id', deptId).single(),
      supabase.from('hospitals').select('id, name, governorate').eq('id', hospitalId).single(),
      supabase.from('v_report_findings')
        .select('*')
        .eq('department_id', deptId)
        .order('status', { ascending: true })
        .order('repeat_count', { ascending: false })
        .order('first_seen_date', { ascending: true }),
    ])

    setDept(deptRes.data)
    setHospital(hospRes.data)

    if (findingsRes.data) {
      // Calculate true total occurrences (N) per recurrence group in this hospital
      const groupTotalMap = new Map()
      findingsRes.data.forEach(f => {
        const grpKey = f.recurrence_group_id || f.id
        // Exclude pending_review from confirmed recurrence count
        const isPendingReview = f.review_status === 'pending_review'
        if (!isPendingReview) {
          groupTotalMap.set(grpKey, (groupTotalMap.get(grpKey) || 0) + 1)
        }
      })

      const withTotals = findingsRes.data.map(f => {
        const grpKey = f.recurrence_group_id || f.id
        const totalOccurrences = groupTotalMap.get(grpKey) || 1
        return {
          ...f,
          totalOccurrences,
          isPendingReview: f.review_status === 'pending_review'
        }
      })

      // Sort: recurring first, then open, then pending confirm, then resolved
      const sorted = withTotals.sort((a, b) => {
        const order = { recurring: 0, open: 1, resolved_by_hospital: 2, resolved_confirmed: 3 }
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status]
        return (b.totalOccurrences || b.repeat_count) - (a.totalOccurrences || a.repeat_count)
      })
      setFindings(sorted)
    }
    setLoading(false)
  }

  const updateFinding = async (findingId, action, noteText = '') => {
    setUpdatingId(findingId)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/update-finding', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': session ? `Bearer ${session.access_token}` : ''
        },
        body: JSON.stringify({ findingId, action, note: noteText }),
      })
      
      if (!res.ok) {
        let errorMsg = 'حدث خطأ أثناء حفظ الإجراء'
        try {
          const errorData = await res.json()
          if (errorData.error) errorMsg = errorData.error
        } catch (e) {
          errorMsg = await res.text()
        }
        showToast(errorMsg, 'error')
        return // Do not close modal or fetchData if failed
      }
      
      await fetchData()
      setNoteModal(null)
      setNote('')
      showToast('تم حفظ الإجراء بنجاح', 'success')
    } catch (err) {
      showToast('حدث خطأ في الاتصال بالخادم', 'error')
      console.error(err)
    } finally {
      setUpdatingId(null)
    }
  }

  const handleAddFinding = async () => {
    if (!newFinding.text.trim()) return
    const today = new Date().toISOString().split('T')[0]
    await supabase.from('v_report_findings').insert({
      hospital_id: hospitalId,
      department_id: deptId,
      original_text: newFinding.text,
      canonical_text: newFinding.text,
      corrective_action: newFinding.corrective,
      responsible: newFinding.responsible,
      deadline: newFinding.deadline,
      priority: newFinding.priority,
      status: 'open',
      repeat_count: 1,
      first_seen_date: today,
      last_seen_date: today,
    })
    setNewFinding({ text: '', corrective: '', responsible: '', deadline: '', priority: 'medium' })
    setAddingNew(false)
    await fetchData()
  }

  const isDirectorate = userRole === 'directorate_admin' || userRole === 'directorate_member'

  const handleMarkRecurring = (findingId) => {
    setConfirmModal({
      title: 'تسجيل السلبية كمتكررة',
      message: 'هل أنت متأكد من تسجيل هذه السلبية كمتكررة؟ سيتم تحديث حالتها إلى متكررة ومطالبة المستشفى باتخاذ إجراء تصحيحي عاجل.',
      actionText: 'تسجيل كمتكررة',
      actionType: 'warning',
      onConfirm: () => updateFinding(findingId, 'mark_recurring')
    })
  }

  const handleRejectHospital = (findingId) => {
    setConfirmModal({
      title: 'رفض إفادة المستشفى وإعادة السلبية',
      message: 'هل أنت متأكد من رفض إفادة المستشفى؟ ستتم إعادة فتح السلبية وطلب إفادة تصحيحية جديدة.',
      actionText: 'رفض وإعادة الفتح',
      actionType: 'danger',
      onConfirm: () => updateFinding(findingId, 'reject_hospital')
    })
  }

  // Phase 2 Step 2: Handlers
  const handleFilterChange = (key) => {
    setFilter(key)
    setCurrentPage(1)
  }

  const handleSearchChange = (val) => {
    setSearchTerm(val)
    setCurrentPage(1)
  }

  const handleClearSearch = () => {
    setSearchTerm('')
    setCurrentPage(1)
  }

  const handleSortChange = (newSort) => {
    setSortBy(newSort)
    if (newSort === 'priority') setSortDirection('desc')
    else if (newSort === 'date') setSortDirection('desc')
    setCurrentPage(1)
  }

  const handleToggleSortDirection = () => {
    setSortDirection(prev => prev === 'desc' ? 'asc' : 'desc')
    setCurrentPage(1)
  }

  // 1. Status Filter
  const tabFilteredFindings = findings.filter(f => {
    if (filter === 'active') return ['open', 'recurring', 'resolved_by_hospital'].includes(f.status)
    if (filter === 'pending') return f.status === 'resolved_by_hospital'
    if (filter === 'open_only') return ['open', 'recurring'].includes(f.status)
    if (filter === 'resolved') return f.status === 'resolved_confirmed'
    return true
  })

  // 2. Search Filter (tolerant to Arabic letters, diacritics, case, and whitespace)
  const searchFilteredFindings = tabFilteredFindings.filter(f => {
    if (!searchTerm.trim()) return true
    const q = normalizeArabic(searchTerm)
    const canonical = normalizeArabic(f.canonical_text)
    const original = normalizeArabic(f.original_text)
    return canonical.includes(q) || original.includes(q)
  })

  // 3. Sorting
  const sortedFindings = [...searchFilteredFindings].sort((a, b) => {
    if (sortBy === 'priority') {
      const priorityWeights = { high: 3, medium: 2, low: 1 }
      const weightA = priorityWeights[a.priority] || 0
      const weightB = priorityWeights[b.priority] || 0
      if (weightA !== weightB) {
        return sortDirection === 'desc' ? weightB - weightA : weightA - weightB
      }
    } else if (sortBy === 'date') {
      const dateA = new Date(a.last_seen_date || a.first_seen_date || a.created_at || 0).getTime()
      const dateB = new Date(b.last_seen_date || b.first_seen_date || b.created_at || 0).getTime()
      if (dateA !== dateB) {
        return sortDirection === 'desc' ? dateB - dateA : dateA - dateB
      }
    }
    return 0 // Preserve default business ordering
  })

  // 4. Pagination
  const totalItems = sortedFindings.length
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE))
  const startIndex = (currentPage - 1) * PAGE_SIZE
  const paginatedFindings = sortedFindings.slice(startIndex, startIndex + PAGE_SIZE)

  // Keep pagination stable within bounds if findings count shrinks
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [totalPages, currentPage])

  const counts = {
    active: findings.filter(f => ['open', 'recurring'].includes(f.status)).length,
    pending: findings.filter(f => f.status === 'resolved_by_hospital').length,
    resolved: findings.filter(f => f.status === 'resolved_confirmed').length,
  }

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' }) : '-'

  if (loading) return <div className="loading-state"><div className="loading-spinner" /><span>تحميل...</span></div>

  return (
    <div>
      {/* Breadcrumb */}
      <div className="dept-breadcrumb no-print" style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12, fontSize: 13, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
        <Link href="/hospitals" style={{ color: 'var(--accent-light)' }}>المستشفيات</Link>
        <span>›</span>
        <Link href={`/hospitals/${hospitalId}`} style={{ color: 'var(--accent-light)' }}>{hospital?.name}</Link>
        <span>›</span>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{dept?.name}</span>
      </div>

      {/* Department Header */}
      <div className="card dept-header-card" style={{ padding: '14px 16px', marginBottom: 12 }}>
        <div className="dept-header-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 200 }}>
            <div style={{
              width: 46, height: 46, borderRadius: 'var(--radius-md)',
              background: 'var(--primary-glow)', border: '1px solid var(--border-accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0,
            }}>🏨</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h1 style={{ fontSize: 18, fontWeight: 900, lineHeight: 1.3, margin: 0, wordBreak: 'break-word' }}>{dept?.name}</h1>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '2px 0 0 0' }}>{hospital?.name} - {hospital?.governorate}</p>
            </div>
          </div>
          <div className="dept-header-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              id="print-dept-report"
              className="btn btn-ghost btn-sm no-print"
              onClick={() => window.print()}
              style={{ padding: '5px 10px', fontSize: 12 }}
            >
              🖨️ طباعة
            </button>
            {isDirectorate && (
              <button
                id="add-finding-btn"
                className="btn btn-primary btn-sm no-print"
                onClick={() => setAddingNew(true)}
                style={{ padding: '5px 12px', fontSize: 12 }}
              >
                ➕ إضافة سلبية
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="dept-filter-tabs no-print" style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {[
          { key: 'active', label: `🔴 نشطة وتحتاج تأكيد (${counts.active + counts.pending})` },
          { key: 'pending', label: `⏳ تحتاج تأكيد (${counts.pending})`, highlight: counts.pending > 0 },
          { key: 'open_only', label: `⚠️ مفتوحة فقط (${counts.active})` },
          { key: 'resolved', label: `✅ محلولة (${counts.resolved})` },
          { key: 'all', label: `📋 الكل (${findings.length})` },
        ].map(tab => (
          <button
            key={tab.key}
            id={`filter-${tab.key}`}
            className={`btn btn-sm ${filter === tab.key ? 'btn-primary' : tab.highlight ? 'btn-accent' : 'btn-ghost'}`}
            onClick={() => handleFilterChange(tab.key)}
            style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6 }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search & Sort Responsive Toolbar */}
      <div
        className="card dept-toolbar-card no-print"
        style={{
          padding: '10px 12px',
          marginBottom: 10,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
        }}
      >
        <div
          className="dept-toolbar-inner"
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
          }}
        >
          {/* Search Box */}
          <div className="dept-search-box" style={{ position: 'relative', flex: '1 1 200px', minWidth: 160 }}>
            <input
              id="findings-search-input"
              type="text"
              className="form-input"
              placeholder="بحث في نص السلبية أو التقرير..."
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              style={{
                width: '100%',
                paddingRight: 32,
                paddingLeft: searchTerm ? 30 : 10,
                paddingTop: 6,
                paddingBottom: 6,
                fontSize: 12.5,
                height: 36,
              }}
            />
            <span
              style={{
                position: 'absolute',
                right: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
                pointerEvents: 'none',
                fontSize: 13,
              }}
            >
              🔍
            </span>
            {searchTerm && (
              <button
                id="clear-search-btn"
                type="button"
                onClick={handleClearSearch}
                title="مسح البحث"
                style={{
                  position: 'absolute',
                  left: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: 13,
                  lineHeight: 1,
                  padding: '4px',
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Sort Controls & Count */}
          <div
            className="dept-sort-controls"
            style={{
              display: 'flex',
              gap: 6,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <label
              htmlFor="findings-sort-select"
              style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}
            >
              الترتيب:
            </label>
            <select
              id="findings-sort-select"
              className="form-select"
              value={sortBy}
              onChange={(e) => handleSortChange(e.target.value)}
              style={{
                width: 'auto',
                minWidth: 130,
                padding: '4px 8px',
                fontSize: 12,
                height: 36,
              }}
            >
              <option value="default">الافتراضي (حسب الحالة)</option>
              <option value="priority">درجة الخطورة</option>
              <option value="date">تاريخ الرصد</option>
            </select>

            {sortBy !== 'default' && (
              <button
                id="sort-direction-btn"
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleToggleSortDirection}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 8px',
                  fontSize: 11.5,
                  height: 36,
                  border: '1px solid var(--border)',
                }}
                title={sortDirection === 'desc' ? 'ترتيب تنازلي' : 'ترتيب تصاعدي'}
              >
                {sortBy === 'priority' ? (
                  sortDirection === 'desc' ? 'الأعلى أولاً ↓' : 'الأقل أولاً ↑'
                ) : (
                  sortDirection === 'desc' ? 'الأحدث أولاً ↓' : 'الأقدم أولاً ↑'
                )}
              </button>
            )}

            <span
              className="badge badge-neutral"
              style={{
                fontSize: 11.5,
                padding: '4px 8px',
                whiteSpace: 'nowrap',
                height: 28,
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              {totalItems} سلبية
            </span>
          </div>
        </div>
      </div>

      {/* Pending confirmation alert */}
      {counts.pending > 0 && isDirectorate && filter !== 'pending' && (
        <div className="alert alert-warning mb-md no-print">
          <span>⚠️</span>
          <span>
            <strong>{counts.pending} سلبية</strong> أفاد فريق المستشفى بتلافيها - تحتاج مراجعتك وتأكيدك (معروضة بالقائمة أدناه).
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginRight: 8 }}
              onClick={() => handleFilterChange('pending')}
            >
              عرض ما يحتاج تأكيد فقط
            </button>
          </span>
        </div>
      )}

      {/* Add New Finding Form */}
      {addingNew && (
        <div className="card mb-lg" style={{ borderColor: 'var(--border-accent)' }}>
          <div className="card-header">
            <h3 className="card-title">➕ إضافة سلبية جديدة</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => setAddingNew(false)}>إلغاء</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 'var(--space-md)' }}>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">نص السلبية *</label>
              <textarea
                id="new-finding-text"
                className="form-textarea"
                placeholder="اكتب السلبية هنا..."
                value={newFinding.text}
                onChange={(e) => setNewFinding({ ...newFinding, text: e.target.value })}
                style={{ minHeight: 80 }}
              />
            </div>
            <div className="form-group">
              <label className="form-label">الإجراء التصحيحي</label>
              <input id="new-finding-corrective" className="form-input" placeholder="ما الذي يجب فعله؟" value={newFinding.corrective} onChange={(e) => setNewFinding({ ...newFinding, corrective: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">المسؤول</label>
              <input id="new-finding-responsible" className="form-input" placeholder="من المسؤول؟" value={newFinding.responsible} onChange={(e) => setNewFinding({ ...newFinding, responsible: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">مدة التنفيذ</label>
              <input id="new-finding-deadline" className="form-input" placeholder="يوم / أسبوع / شهر" value={newFinding.deadline} onChange={(e) => setNewFinding({ ...newFinding, deadline: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">درجة الخطورة</label>
              <select id="new-finding-priority" className="form-select" value={newFinding.priority} onChange={(e) => setNewFinding({ ...newFinding, priority: e.target.value })}>
                <option value="high">عالية</option>
                <option value="medium">متوسطة</option>
                <option value="low">منخفضة</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-md)' }}>
            <button id="save-new-finding" className="btn btn-success" onClick={handleAddFinding}>💾 حفظ</button>
          </div>
        </div>
      )}

      {/* Findings List */}
      {totalItems === 0 ? (
        <div className="empty-state">
          {searchTerm ? (
            <>
              <span className="empty-state-icon">🔍</span>
              <div className="empty-state-title">لا توجد نتائج مطابقة للبحث</div>
              <p className="empty-state-desc">
                لم نتمكن من العثور على أي نتائج تطابق &quot;{searchTerm}&quot;
              </p>
              <button
                id="empty-clear-search-btn"
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 12, border: '1px solid var(--border)' }}
                onClick={handleClearSearch}
              >
                مسح البحث
              </button>
            </>
          ) : (
            <>
              <span className="empty-state-icon">✅</span>
              <div className="empty-state-title">
                {filter === 'active' ? 'لا توجد سلبيات نشطة أو بانتظار التأكيد!' : 'لا توجد نتائج'}
              </div>
              <p className="empty-state-desc">
                {filter === 'active' ? 'هذا القسم خالٍ من السلبيات المفتوحة أو التي تنتظر الاعتماد حالياً.' : ''}
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          {/* DESKTOP VIEW: Table (Hidden on Mobile via CSS) */}
          <div className="findings-desktop-table" style={{ overflowX: 'auto', background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'right' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '8px 12px', width: 40 }}>#</th>
                  <th style={{ padding: '8px 12px' }}>نص السلبية والملاحظات</th>
                  <th style={{ padding: '8px 12px', width: 120 }}>تاريخ الرصد</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', width: 120 }}>الحالة</th>
                  <th className="no-print" style={{ padding: '8px 12px', textAlign: 'left', width: 230 }}>الإجراء</th>
                </tr>
              </thead>
              <tbody>
                {paginatedFindings.map((finding, idx) => (
                  <tr key={finding.id} style={{ borderBottom: '1px solid var(--border)', background: finding.status === 'resolved_confirmed' ? 'rgba(16, 185, 129, 0.05)' : 'transparent' }}>
                    <td style={{ padding: '10px 12px', verticalAlign: 'top', fontWeight: 700, color: 'var(--text-muted)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                        {startIndex + idx + 1}
                        {finding.totalOccurrences > 1 && !finding.isPendingReview ? (
                          <span className="badge badge-repeat" style={{ padding: '2px 6px', fontSize: 10 }} title={`تكررت ${finding.totalOccurrences} مرات في هذا المستشفى`}>
                            🔁 متكررة ×{finding.totalOccurrences}
                          </span>
                        ) : finding.isPendingReview ? (
                          <span className="badge badge-warning" style={{ padding: '2px 6px', fontSize: 10 }} title="سلبية قيد مراجعة الجودة">
                            ⏳ قيد المراجعة
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px', verticalAlign: 'top' }}>
                      {/* PRIMARY TITLE: report_findings.original_text (Immutable Truth) */}
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-main)', lineHeight: 1.5 }}>
                        {finding.original_text}
                      </div>

                      {finding.repeat_count > 1 && (
                        <div style={{ marginTop: 4 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            (الظهور رقم {finding.repeat_count})
                          </span>
                        </div>
                      )}

                      {finding.status === 'resolved_by_hospital' && finding.hospital_resolution_note && (
                        <CollapsibleNote label="المستشفى" text={finding.hospital_resolution_note} type="warning" />
                      )}
                      {finding.status === 'resolved_confirmed' && finding.resolution_note && (
                        <CollapsibleNote label="المديرية" text={finding.resolution_note} type="success" />
                      )}
                    </td>
                    <td style={{ padding: '8px 10px', verticalAlign: 'top', color: 'var(--text-secondary)', fontSize: 12 }}>
                      <div>{formatDate(finding.first_seen_date)}</div>
                      {finding.totalOccurrences > 1 && (
                        <div style={{ marginTop: 2, color: 'var(--warning-dark)', fontSize: 11 }}>🔁 {formatDate(finding.last_seen_date)}</div>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px', verticalAlign: 'top', textAlign: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                        {!(finding.status === 'recurring' || finding.totalOccurrences > 1 || finding.repeat_count > 1) && (
                          <span style={{ display: 'inline-block', whiteSpace: 'nowrap', fontSize: 11.5, color: STATUS_CONFIG[finding.status]?.color, fontWeight: 700, padding: '3px 8px', background: 'var(--bg-primary)', borderRadius: 100, border: '1px solid var(--border)' }}>
                            {STATUS_CONFIG[finding.status]?.label}
                          </span>
                        )}
                        {!(finding.status === 'recurring' || finding.totalOccurrences > 1 || finding.repeat_count > 1) && finding.priority && PRIORITY_CONFIG[finding.priority] && (
                          <span className={`badge ${PRIORITY_CONFIG[finding.priority].class}`} style={{ fontSize: 10.5, padding: '2px 7px' }}>
                            {PRIORITY_CONFIG[finding.priority].label}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="no-print" style={{ padding: '8px 10px', verticalAlign: 'top', textAlign: 'left' }}>
                      {/* Direct Action Buttons - No Dropdown Menu */}
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {/* Directorate Actions */}
                        {isDirectorate && (finding.status === 'open' || finding.status === 'recurring') && (
                          <button
                            type="button"
                            className="btn btn-success btn-desktop-resolve"
                            disabled={updatingId === finding.id}
                            onClick={() => setNoteModal({ findingId: finding.id, action: 'resolve_directorate' })}
                          >
                            <span style={{ fontSize: 11, lineHeight: 1 }}>✓</span>
                            <span>تأكيد الإغلاق</span>
                          </button>
                        )}

                        {isDirectorate && finding.status === 'resolved_by_hospital' && (
                          <>
                            <button
                              type="button"
                              className="btn btn-success btn-sm"
                              disabled={updatingId === finding.id}
                              style={{ padding: '5px 10px', fontSize: 12 }}
                              onClick={() => setNoteModal({ findingId: finding.id, action: 'resolve_directorate' })}
                            >
                              <CheckIcon className="w-3.5 h-3.5" />
                              <span>قبول</span>
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              disabled={updatingId === finding.id}
                              style={{ padding: '5px 8px', fontSize: 12, borderColor: 'var(--danger)', color: 'var(--danger)' }}
                              onClick={() => handleRejectHospital(finding.id)}
                            >
                              <XMarkIcon className="w-3.5 h-3.5" />
                              <span>رفض</span>
                            </button>
                          </>
                        )}

                        {/* Hospital Actions */}
                        {!isDirectorate && (finding.status === 'open' || finding.status === 'recurring' || finding.status === 'resolved_by_hospital') && (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={updatingId === finding.id}
                            style={{ padding: '5px 10px', fontSize: 12 }}
                            onClick={() => {
                              setNote(finding.hospital_resolution_note || '')
                              setNoteModal({ findingId: finding.id, action: 'resolve_hospital' })
                            }}
                          >
                            <ChatBubbleIcon className="w-3.5 h-3.5" />
                            <span>{finding.status === 'resolved_by_hospital' ? 'تعديل الإفادة' : 'إفادة'}</span>
                          </button>
                        )}

                        {finding.status === 'resolved_confirmed' && (
                          <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>
                            ✅ تم الاعتماد
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* MOBILE VIEW: Dedicated Native Cards (Hidden on Desktop via CSS) */}
          <div className="findings-mobile-cards">
            {paginatedFindings.map((finding, idx) => {
              const isResolved = finding.status === 'resolved_confirmed'
              const isPendingHosp = finding.status === 'resolved_by_hospital'
              const isRecurring = finding.status === 'recurring'

              return (
                <div
                  key={finding.id}
                  className="mobile-finding-card"
                  style={{
                    background: isResolved ? 'rgba(16, 185, 129, 0.03)' : 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRight: isResolved
                      ? '3px solid var(--success)'
                      : isPendingHosp
                      ? '3px solid var(--warning)'
                      : isRecurring
                      ? '3px solid var(--danger)'
                      : '3px solid var(--border-accent)',
                    borderRadius: 8,
                    padding: '8px 10px',
                    margin: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    boxShadow: 'none',
                  }}
                >
                  {/* 1. Header row: [التاريخ] (left) ... [#1] (right in RTL) */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: 0, padding: 0 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        color: 'var(--text-muted)',
                        background: 'var(--bg-secondary)',
                        padding: '1px 5px',
                        borderRadius: 4,
                        border: '1px solid var(--border)',
                        lineHeight: 1.2,
                      }}
                    >
                      #{startIndex + idx + 1}
                    </span>

                    <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                      📅 {formatDate(finding.first_seen_date)}
                    </span>
                  </div>

                  {/* 2. ORIGINAL TEXT: Directly below header */}
                  <div
                    style={{
                      fontSize: 13.5,
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                      lineHeight: 1.45,
                      margin: 0,
                      padding: 0,
                      wordBreak: 'break-word',
                      overflowWrap: 'break-word',
                    }}
                  >
                    {finding.original_text}
                  </div>

                  {/* Notes if applicable */}
                  {finding.status === 'resolved_by_hospital' && finding.hospital_resolution_note && (
                    <CollapsibleNote label="المستشفى" text={finding.hospital_resolution_note} type="warning" />
                  )}
                  {finding.status === 'resolved_confirmed' && finding.resolution_note && (
                    <CollapsibleNote label="المديرية" text={finding.resolution_note} type="success" />
                  )}

                  {/* 3. METADATA ROW: [الحالة] [الخطورة] [🔁 متكررة ×N عند الحاجة] in one compact row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', margin: 0, padding: 0 }}>
                    {/* Status */}
                    {!(finding.status === 'recurring' || finding.totalOccurrences > 1 || finding.repeat_count > 1) && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          fontSize: 10.5,
                          fontWeight: 700,
                          padding: '2px 6px',
                          background: 'var(--bg-primary)',
                          borderRadius: 100,
                          border: '1px solid var(--border)',
                          color: STATUS_CONFIG[finding.status]?.color,
                          lineHeight: 1.2,
                        }}
                      >
                        {STATUS_CONFIG[finding.status]?.label}
                      </span>
                    )}

                    {/* Priority */}
                    {!(finding.status === 'recurring' || finding.totalOccurrences > 1 || finding.repeat_count > 1) && finding.priority && PRIORITY_CONFIG[finding.priority] && (
                      <span
                        className={`badge ${PRIORITY_CONFIG[finding.priority].class}`}
                        style={{ fontSize: 10, padding: '2px 6px', lineHeight: 1.2 }}
                      >
                        {PRIORITY_CONFIG[finding.priority].label}
                      </span>
                    )}

                    {/* Recurrence Badge (only if truly recurring) */}
                    {finding.totalOccurrences > 1 && !finding.isPendingReview && (
                      <span
                        className="badge badge-repeat"
                        style={{
                          fontSize: 10,
                          padding: '2px 6px',
                          fontWeight: 700,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 2,
                          lineHeight: 1.2,
                        }}
                        title={`تكررت ${finding.totalOccurrences} مرات في هذا المستشفى`}
                      >
                        🔁 متكررة ×{finding.totalOccurrences}
                        {finding.repeat_count > 1 && (
                          <span style={{ fontSize: 9.5, opacity: 0.85, marginRight: 2 }}>
                            (الظهور {finding.repeat_count})
                          </span>
                        )}
                      </span>
                    )}

                    {finding.isPendingReview && (
                      <span className="badge badge-warning" style={{ fontSize: 10, padding: '2px 5px', lineHeight: 1.2 }}>
                        ⏳ قيد المراجعة
                      </span>
                    )}
                  </div>

                  {/* 4. DIRECT ACTION BUTTON: Placed directly below metadata with no whitespace */}
                  <div className="no-print" style={{ margin: 0, paddingTop: 4, borderTop: '1px solid var(--border-light)' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-start', flexWrap: 'wrap', alignItems: 'center' }}>
                      {isDirectorate && (finding.status === 'open' || finding.status === 'recurring') && (
                        <button
                          type="button"
                          className="btn btn-success btn-sm"
                          disabled={updatingId === finding.id}
                          style={{ padding: '4px 10px', fontSize: 11.5, fontWeight: 700, borderRadius: 5 }}
                          onClick={() => setNoteModal({ findingId: finding.id, action: 'resolve_directorate' })}
                        >
                          <CheckIcon className="w-3.5 h-3.5" />
                          <span>تأكيد الإغلاق</span>
                        </button>
                      )}

                      {isDirectorate && finding.status === 'resolved_by_hospital' && (
                        <div style={{ display: 'flex', gap: 5 }}>
                          <button
                            type="button"
                            className="btn btn-success btn-sm"
                            disabled={updatingId === finding.id}
                            style={{ padding: '4px 10px', fontSize: 11.5, fontWeight: 700, borderRadius: 5 }}
                            onClick={() => setNoteModal({ findingId: finding.id, action: 'resolve_directorate' })}
                          >
                            <CheckIcon className="w-3.5 h-3.5" />
                            <span>قبول</span>
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            disabled={updatingId === finding.id}
                            style={{ padding: '4px 8px', fontSize: 11.5, borderColor: 'var(--danger)', color: 'var(--danger)', borderRadius: 5 }}
                            onClick={() => handleRejectHospital(finding.id)}
                          >
                            <XMarkIcon className="w-3.5 h-3.5" />
                            <span>رفض</span>
                          </button>
                        </div>
                      )}

                      {!isDirectorate && (finding.status === 'open' || finding.status === 'recurring' || finding.status === 'resolved_by_hospital') && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={updatingId === finding.id}
                          style={{ padding: '4px 10px', fontSize: 11.5, fontWeight: 700, borderRadius: 5 }}
                          onClick={() => {
                            setNote(finding.hospital_resolution_note || '')
                            setNoteModal({ findingId: finding.id, action: 'resolve_hospital' })
                          }}
                        >
                          <ChatBubbleIcon className="w-3.5 h-3.5" />
                          <span>{finding.status === 'resolved_by_hospital' ? 'تعديل الإفادة' : 'إفادة بتلافي السلبية'}</span>
                        </button>
                      )}

                      {finding.status === 'resolved_confirmed' && (
                        <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 700 }}>
                          ✅ تم التلافي والاعتماد
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div
            className="no-print"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-md)',
              marginTop: 'var(--space-md)',
              padding: 'var(--space-sm) var(--space-md)',
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              صفحة <strong>{currentPage}</strong> من <strong>{totalPages}</strong> ({totalItems} سلبية)
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-xs)', alignItems: 'center' }}>
              <button
                id="pagination-prev-btn"
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                style={{
                  border: '1px solid var(--border)',
                  opacity: currentPage === 1 ? 0.5 : 1,
                  cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                  padding: '4px 12px',
                }}
              >
                السابق
              </button>

              <span style={{ fontSize: 13, fontWeight: 700, padding: '0 8px', color: 'var(--text-main)' }}>
                {currentPage} / {totalPages}
              </span>

              <button
                id="pagination-next-btn"
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                style={{
                  border: '1px solid var(--border)',
                  opacity: currentPage === totalPages ? 0.5 : 1,
                  cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                  padding: '4px 12px',
                }}
              >
                التالي
              </button>
            </div>
          </div>
        )}
      </>
    )}

      {/* Note Modal */}
      {noteModal && (
        <div className="modal-overlay" onClick={() => setNoteModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                {noteModal.action === 'resolve_directorate' ? '✅ تأكيد التلافي' :
                 noteModal.action === 'resolve_hospital' ? '🔔 الإبلاغ عن تلافي السلبية' : 'ملاحظة'}
              </h3>
              <button className="modal-close" onClick={() => setNoteModal(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">
                  {noteModal.action === 'resolve_directorate'
                    ? 'ملاحظة التأكيد (اختياري)'
                    : 'وصف الإجراء المتخذ (اختياري)'}
                </label>
                <textarea
                  id="resolution-note-input"
                  className="form-textarea"
                  placeholder={noteModal.action === 'resolve_directorate'
                    ? 'تم التحقق ميدانياً من التلافي...'
                    : 'تم تطبيق الإجراء التصحيحي بتاريخ...'}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setNoteModal(null)}>إلغاء</button>
              <button
                id="confirm-action-btn"
                className={`btn ${noteModal.action === 'resolve_directorate' ? 'btn-success' : 'btn-accent'}`}
                onClick={() => updateFinding(noteModal.findingId, noteModal.action, note)}
                disabled={updatingId === noteModal.findingId}
              >
                {updatingId === noteModal.findingId ? (
                  <><div className="loading-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> جاري...</>
                ) : (
                  noteModal.action === 'resolve_directorate' ? '✅ تأكيد التلافي' : '🔔 إبلاغ'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal (Phase 2 Step 3) */}
      {confirmModal && (
        <div className="modal-overlay" onClick={() => setConfirmModal(null)}>
          <div className="confirm-modal-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: confirmModal.actionType === 'danger' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                  color: confirmModal.actionType === 'danger' ? 'var(--danger-light)' : 'var(--warning-light)',
                  flexShrink: 0
                }}
              >
                <ExclamationCircleIcon className="w-5 h-5" />
              </div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>
                {confirmModal.title}
              </h3>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 20px 0' }}>
              {confirmModal.message}
            </p>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                id="cancel-confirm-dialog-btn"
                className="btn btn-ghost"
                onClick={() => setConfirmModal(null)}
              >
                إلغاء
              </button>
              <button
                type="button"
                id="submit-confirm-dialog-btn"
                className={`btn ${confirmModal.actionType === 'danger' ? 'btn-danger' : 'btn-warning'}`}
                style={confirmModal.actionType === 'warning' ? { background: 'var(--warning)', color: '#fff' } : {}}
                onClick={async () => {
                  const action = confirmModal.onConfirm
                  setConfirmModal(null)
                  if (action) await action()
                }}
              >
                {confirmModal.actionText}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
