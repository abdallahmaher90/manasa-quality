'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'
import Link from 'next/link'

const STATUS_CONFIG = {
  open: { label: 'مفتوحة', color: 'var(--danger-light)', bgClass: 'open' },
  recurring: { label: 'متكررة', color: 'var(--warning-light)', bgClass: 'recurring' },
  resolved_by_hospital: { label: 'تم التلافي (بانتظار تأكيد المديرية)', color: 'var(--warning-light)', bgClass: 'resolved_by_hospital' },
  resolved_confirmed: { label: 'تم التلافي ✅', color: 'var(--success-light)', bgClass: 'resolved_confirmed' },
}

const PRIORITY_CONFIG = {
  high: { label: 'خطورة عالية', class: 'badge-danger' },
  medium: { label: 'متوسطة', class: 'badge-warning' },
  low: { label: 'منخفضة', class: 'badge-success' },
}

export default function DepartmentPage() {
  const { id: hospitalId, deptId } = useParams()
  const [dept, setDept] = useState(null)
  const [hospital, setHospital] = useState(null)
  const [findings, setFindings] = useState([])
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState(null)
  const [noteModal, setNoteModal] = useState(null) // { findingId, action }
  const [note, setNote] = useState('')
  const [userRole, setUserRole] = useState('directorate_member')
  const [filter, setFilter] = useState('active') // 'active' | 'pending' | 'resolved' | 'all'
  const [addingNew, setAddingNew] = useState(false)
  const [newFinding, setNewFinding] = useState({ text: '', corrective: '', responsible: '', deadline: '', priority: 'medium' })

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
      supabase.from('findings')
        .select('*')
        .eq('department_id', deptId)
        .order('status', { ascending: true })
        .order('repeat_count', { ascending: false })
        .order('first_seen_date', { ascending: true }),
    ])

    setDept(deptRes.data)
    setHospital(hospRes.data)

    if (findingsRes.data) {
      // Sort: recurring first, then open, then pending confirm, then resolved
      const sorted = [...findingsRes.data].sort((a, b) => {
        const order = { recurring: 0, open: 1, resolved_by_hospital: 2, resolved_confirmed: 3 }
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status]
        return b.repeat_count - a.repeat_count
      })
      setFindings(sorted)
    }
    setLoading(false)
  }

  const updateFinding = async (findingId, action, noteText = '') => {
    setUpdatingId(findingId)
    try {
      await fetch('/api/update-finding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ findingId, action, note: noteText }),
      })
      await fetchData()
    } finally {
      setUpdatingId(null)
      setNoteModal(null)
      setNote('')
    }
  }

  const handleAddFinding = async () => {
    if (!newFinding.text.trim()) return
    const today = new Date().toISOString().split('T')[0]
    await supabase.from('findings').insert({
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

  const filteredFindings = findings.filter(f => {
    if (filter === 'active') return ['open', 'recurring'].includes(f.status)
    if (filter === 'pending') return f.status === 'resolved_by_hospital'
    if (filter === 'resolved') return f.status === 'resolved_confirmed'
    return true
  })

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
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 'var(--space-lg)', fontSize: 14, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
        <Link href="/hospitals" style={{ color: 'var(--accent-light)' }}>المستشفيات</Link>
        <span>›</span>
        <Link href={`/hospitals/${hospitalId}`} style={{ color: 'var(--accent-light)' }}>{hospital?.name}</Link>
        <span>›</span>
        <span>{dept?.name}</span>
      </div>

      {/* Department Header */}
      <div className="card mb-lg">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-lg)' }}>
          <div style={{
            width: 56, height: 56, borderRadius: 'var(--radius-lg)',
            background: 'var(--primary-glow)', border: '1px solid var(--border-accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
          }}>🏨</div>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 22, fontWeight: 900 }}>{dept?.name}</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{hospital?.name} - {hospital?.governorate}</p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
            <button
              id="print-dept-report"
              className="btn btn-ghost btn-sm no-print"
              onClick={() => window.print()}
            >
              🖨️ طباعة
            </button>
            {isDirectorate && (
              <button
                id="add-finding-btn"
                className="btn btn-primary btn-sm no-print"
                onClick={() => setAddingNew(true)}
              >
                ➕ إضافة سلبية
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)', flexWrap: 'wrap' }} className="no-print">
        {[
          { key: 'active', label: `🔴 نشطة (${counts.active})` },
          { key: 'pending', label: `⏳ تحتاج تأكيد (${counts.pending})`, highlight: counts.pending > 0 },
          { key: 'resolved', label: `✅ محلولة (${counts.resolved})` },
          { key: 'all', label: `📋 الكل (${findings.length})` },
        ].map(tab => (
          <button
            key={tab.key}
            id={`filter-${tab.key}`}
            className={`btn btn-sm ${filter === tab.key ? 'btn-primary' : tab.highlight ? 'btn-accent' : 'btn-ghost'}`}
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Pending confirmation alert */}
      {counts.pending > 0 && isDirectorate && filter !== 'pending' && (
        <div className="alert alert-warning mb-md no-print">
          <span>⚠️</span>
          <span>
            <strong>{counts.pending} سلبية</strong> أفاد فريق المستشفى بتلافيها - تحتاج مراجعتك وتأكيدك.
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginRight: 8 }}
              onClick={() => setFilter('pending')}
            >
              مراجعة الآن
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
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
      {filteredFindings.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">✅</span>
          <div className="empty-state-title">
            {filter === 'active' ? 'لا توجد سلبيات نشطة!' : 'لا توجد نتائج'}
          </div>
          <p className="empty-state-desc">
            {filter === 'active' ? 'هذا القسم خالٍ من السلبيات المفتوحة حالياً.' : ''}
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'right' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '8px 12px', width: 40 }}>#</th>
                <th style={{ padding: '8px 12px' }}>نص السلبية والملاحظات</th>
                <th style={{ padding: '8px 12px', width: 120 }}>تاريخ الرصد</th>
                <th style={{ padding: '8px 12px', textAlign: 'center', width: 100 }}>الحالة</th>
                <th className="no-print" style={{ padding: '8px 12px', textAlign: 'left', width: 230 }}>الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {filteredFindings.map((finding, idx) => (
                <tr key={finding.id} style={{ borderBottom: '1px solid var(--border)', background: finding.status === 'resolved_confirmed' ? 'rgba(16, 185, 129, 0.05)' : 'transparent' }}>
                  <td style={{ padding: '10px 12px', verticalAlign: 'top', fontWeight: 700, color: 'var(--text-muted)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                      {idx + 1}
                      {finding.repeat_count > 1 && (
                        <span className="badge badge-repeat" style={{ padding: '2px 6px', fontSize: 10 }}>
                          🔁 ×{finding.repeat_count}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-main)', lineHeight: 1.5 }}>
                      {finding.canonical_text || finding.original_text}
                    </div>

                    {finding.status === 'resolved_by_hospital' && finding.hospital_resolution_note && (
                      <div className="alert alert-warning" style={{ padding: '6px 10px', fontSize: 12, marginTop: 8 }}>
                        💬 <strong>المستشفى:</strong> {finding.hospital_resolution_note}
                      </div>
                    )}
                    {finding.status === 'resolved_confirmed' && finding.resolution_note && (
                      <div className="alert alert-success" style={{ padding: '6px 10px', fontSize: 12, marginTop: 8 }}>
                        ✅ <strong>المديرية:</strong> {finding.resolution_note}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', verticalAlign: 'top', color: 'var(--text-secondary)', fontSize: 12 }}>
                    <div>{formatDate(finding.first_seen_date)}</div>
                    {finding.repeat_count > 1 && (
                      <div style={{ marginTop: 4, color: 'var(--warning-dark)' }}>🔁 {formatDate(finding.last_seen_date)}</div>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', verticalAlign: 'top', textAlign: 'center' }}>
                    <span style={{ fontSize: 12, color: STATUS_CONFIG[finding.status]?.color, fontWeight: 700, padding: '4px 8px', background: 'var(--bg-primary)', borderRadius: 100, border: '1px solid var(--border)' }}>
                      {STATUS_CONFIG[finding.status]?.label}
                    </span>
                  </td>
                  <td className="no-print" style={{ padding: '10px 12px', verticalAlign: 'top', textAlign: 'left' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap', alignItems: 'center' }}>
                      {/* Directorate Actions */}
                      {isDirectorate && finding.status === 'open' && (
                        <button className="btn btn-success btn-sm" style={{ padding: '4px 8px', fontSize: 11 }} disabled={updatingId === finding.id} onClick={() => setNoteModal({ findingId: finding.id, action: 'resolve_directorate' })}>
                          ✅ تأكيد (إغلاق)
                        </button>
                      )}
                      {isDirectorate && finding.status === 'recurring' && (
                        <button className="btn btn-success btn-sm" style={{ padding: '4px 8px', fontSize: 11 }} disabled={updatingId === finding.id} onClick={() => setNoteModal({ findingId: finding.id, action: 'resolve_directorate' })}>
                          ✅ تأكيد (إغلاق)
                        </button>
                      )}
                      {isDirectorate && finding.status === 'resolved_by_hospital' && (
                        <>
                          <button className="btn btn-success btn-sm" style={{ padding: '4px 8px', fontSize: 11 }} disabled={updatingId === finding.id} onClick={() => setNoteModal({ findingId: finding.id, action: 'resolve_directorate' })}>
                            ✅ قبول (إغلاق)
                          </button>
                          <button className="btn btn-danger btn-sm" style={{ padding: '4px 8px', fontSize: 11 }} disabled={updatingId === finding.id} onClick={() => setNoteModal({ findingId: finding.id, action: 'reject_resolution' })}>
                            ❌ رفض وإعادة
                          </button>
                        </>
                      )}
                      {isDirectorate && finding.status !== 'recurring' && finding.status !== 'resolved_confirmed' && (
                        <button className="btn btn-warning btn-sm" style={{ background: 'var(--warning)', color: '#fff', padding: '4px 8px', fontSize: 11 }} disabled={updatingId === finding.id} onClick={() => handleMarkRecurring(finding.id)}>
                          🔁 تسجيل كمتكررة
                        </button>
                      )}

                      {/* Hospital Actions */}
                      {!isDirectorate && (finding.status === 'open' || finding.status === 'recurring') && (
                        <button className="btn btn-primary btn-sm" style={{ padding: '4px 8px', fontSize: 11 }} disabled={updatingId === finding.id} onClick={() => setNoteModal({ findingId: finding.id, action: 'resolve_hospital' })}>
                          💬 إفادة بتلافي السلبية
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    </div>
  )
}
