'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { fetchGoogleSheetData } from '@/lib/google-sheets'
import DynamicKPI from '@/components/DynamicKPI'

const DEPT_ICONS = {
  'الداخلي': '🏥', 'الباطنة': '🏥', 'العناية': '🫀', 'طوارئ': '🚨',
  'أشعة': '☢️', 'معمل': '🔬', 'صيدلة': '💊', 'جراحة': '✂️', 'عمليات': '✂️',
  'أطفال': '👶', 'نساء': '👩', 'عظام': '🦴', 'مكافحة': '🦠', 'كلى': '🫁',
  'default': '🏨',
}

const getDeptIcon = (name) => {
  for (const [key, icon] of Object.entries(DEPT_ICONS)) {
    if (name?.includes(key)) return icon
  }
  return DEPT_ICONS.default
}

export default function HospitalPage() {
  const { id } = useParams()
  const router = useRouter()
  const [hospital, setHospital] = useState(null)
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [printMode, setPrintMode] = useState(false)
  const [kpiData, setKpiData] = useState([])
  const [showKpi, setShowKpi] = useState(false)
  const [showTeam, setShowTeam] = useState(true)
  
  const [recentReports, setRecentReports] = useState([])
  const [criticalFindings, setCriticalFindings] = useState([])
  
  // Team Management State
  const [showEditTeamModal, setShowEditTeamModal] = useState(false)
  const [savingTeam, setSavingTeam] = useState(false)
  const [editForm, setEditForm] = useState({
    director_name: '',
    director_phone: '',
    quality_head_name: '',
    quality_head_phone: '',
    quality_team: []
  })
  const [newMember, setNewMember] = useState({ name: '', role: '', phone: '' })

  const [userRole, setUserRole] = useState(null)
  const [isEditingSat, setIsEditingSat] = useState(false)
  const [tempSat, setTempSat] = useState('')

  useEffect(() => {
    fetchHospital()
  }, [id])

  const fetchHospital = async () => {
    const [hospRes, deptRes, reportsRes, criticalFindingsRes] = await Promise.all([
      supabase.from('hospitals').select('*').eq('id', id).single(),
      supabase.from('departments').select(`
        id, name,
        findings!findings_department_id_fkey(id, status, repeat_count, priority)
      `).eq('hospital_id', id).order('name'),
      supabase.from('reports').select('id, inspection_date, inspector_name').eq('hospital_id', id).order('inspection_date', { ascending: false }).limit(5),
      supabase.from('findings').select('id, original_text, canonical_text, priority, repeat_count, status, departments(name, id)').eq('hospital_id', id).in('status', ['open', 'recurring']).or('priority.eq.high,repeat_count.gte.3').order('repeat_count', { ascending: false }).limit(5)
    ])

    setHospital(hospRes.data)
    if (hospRes.data) {
      setEditForm({
        director_name: hospRes.data.director_name || '',
        director_phone: hospRes.data.director_phone || '',
        quality_head_name: hospRes.data.quality_head_name || '',
        quality_head_phone: hospRes.data.quality_head_phone || '',
        quality_team: hospRes.data.quality_team || []
      })
      setTempSat(hospRes.data.last_sat_evaluation || '')
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      if (profile) setUserRole(profile.role)
    }

    if (deptRes.data) {
      const processed = deptRes.data.map(dept => {
        const findings = dept.findings || []
        const open = findings.filter(f => ['open', 'recurring'].includes(f.status)).length
        const recurring = findings.filter(f => f.status === 'recurring').length
        const resolved = findings.filter(f => f.status === 'resolved_confirmed').length
        const pendingConfirm = findings.filter(f => f.status === 'resolved_by_hospital').length
        const highPriority = findings.filter(f => f.priority === 'high' && ['open', 'recurring'].includes(f.status)).length

        return { ...dept, open, recurring, resolved, pendingConfirm, highPriority }
      }).filter(dept => dept.open > 0 || dept.resolved > 0 || dept.pendingConfirm > 0)
      .sort((a, b) => {
        // Sort by total open, then by recurring count (priority rule)
        const aTotal = a.open
        const bTotal = b.open
        if (bTotal !== aTotal) return bTotal - aTotal
        return b.recurring - a.recurring
      })

      setDepartments(processed)
      if (reportsRes.data) setRecentReports(reportsRes.data)
      if (criticalFindingsRes.data) setCriticalFindings(criticalFindingsRes.data)
      
      // Fetch KPI Data
      try {
        const { data: settingData } = await supabase.from('settings').select('value').eq('key', 'google_sheet_url').single()
        if (settingData?.value) {
          const csvData = await fetchGoogleSheetData(settingData.value)
          setKpiData(csvData)
        }
      } catch (err) {
        console.error('Error fetching settings or KPIs', err)
      }
    }
    setLoading(false)
  }

  const handlePrint = () => {
    router.push(`/hospitals/${id}/print`)
  }

  const handleSaveTeam = async () => {
    setSavingTeam(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const res = await fetch('/api/update-hospital-team', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          hospitalId: id,
          director_name: editForm.director_name,
          director_phone: editForm.director_phone,
          quality_head_name: editForm.quality_head_name,
          quality_head_phone: editForm.quality_head_phone,
          quality_team: editForm.quality_team || []
        })
      })

      const data = await res.json()
      if (res.ok && data.success) {
        setHospital(prev => ({ ...prev, ...editForm }))
        setShowEditTeamModal(false)
      } else {
        alert('API Error: ' + (data.error || 'حدث خطأ أثناء الحفظ. يرجى التأكد من الصلاحيات.'))
      }
    } catch (err) {
      console.error('Save team error:', err)
      alert('حدث خطأ أثناء حفظ البيانات: ' + (err.message || ''))
    } finally {
      setSavingTeam(false)
    }
  }

  const handleAddTeamMember = () => {
    if (!newMember.name || !newMember.name.trim()) return
    setEditForm(prev => ({
      ...prev,
      quality_team: [...(prev.quality_team || []), {
        name: newMember.name.trim(),
        role: newMember.role?.trim() || '',
        phone: newMember.phone?.trim() || ''
      }]
    }))
    setNewMember({ name: '', role: '', phone: '' })
  }

  const handleRemoveTeamMember = (index) => {
    setEditForm(prev => ({
      ...prev,
      quality_team: (prev.quality_team || []).filter((_, i) => i !== index)
    }))
  }

  const handleSaveSat = async () => {
    const { error } = await supabase.from('hospitals').update({
      last_sat_evaluation: tempSat
    }).eq('id', id)

    if (!error) {
      setHospital(prev => ({ ...prev, last_sat_evaluation: tempSat }))
      setIsEditingSat(false)
    } else {
      alert('حدث خطأ أثناء حفظ النسبة')
    }
  }

  if (loading) {
    return <div className="loading-state"><div className="loading-spinner" /><span>جاري التحميل...</span></div>
  }

  if (!hospital) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">❓</span>
        <div className="empty-state-title">المستشفى غير موجود</div>
        <Link href="/hospitals" className="btn btn-primary">← العودة للقائمة</Link>
      </div>
    )
  }

  const totalOpen = departments.reduce((acc, d) => acc + d.open, 0)
  const totalRecurring = departments.reduce((acc, d) => acc + d.recurring, 0)
  const totalResolved = departments.reduce((acc, d) => acc + d.resolved, 0)
  const totalPending = departments.reduce((acc, d) => acc + d.pendingConfirm, 0)

  return (
    <div>
      {/* Hospital Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: 48, height: 48, borderRadius: '8px',
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24, flexShrink: 0,
          }}>🏥</div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>{hospital.name}</h1>
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>📈 نسبة تقييم آخر SAT:</span>
              
              {isEditingSat ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input 
                    type="number" 
                    className="form-input" 
                    style={{ padding: '2px 8px', fontSize: 12, width: '80px', height: '24px', minHeight: 'unset' }} 
                    value={tempSat} 
                    onChange={e => setTempSat(e.target.value)} 
                    placeholder="%"
                  />
                  <button className="btn btn-primary btn-sm" style={{ padding: '2px 8px', fontSize: 11, height: '24px', minHeight: 'unset' }} onClick={handleSaveSat}>حفظ</button>
                  <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', fontSize: 11, height: '24px', minHeight: 'unset' }} onClick={() => { setIsEditingSat(false); setTempSat(hospital.last_sat_evaluation || ''); }}>إلغاء</button>
                </div>
              ) : (
                <>
                  <strong style={{ color: 'var(--primary)' }}>
                    {hospital.last_sat_evaluation ? `${hospital.last_sat_evaluation}%` : 'غير مسجل'}
                  </strong>
                  {(userRole === 'directorate_admin' || userRole === 'directorate_member') && (
                    <button 
                      onClick={() => setIsEditingSat(true)}
                      className="btn btn-ghost btn-sm no-print" 
                      style={{ padding: '2px 6px', fontSize: 11, height: '22px', minHeight: 'unset' }}
                    >
                      ✏️ تعديل
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-sm no-print">
          <button
            id="print-hospital-report"
            className="btn btn-ghost btn-sm"
            onClick={handlePrint}
            style={{ padding: '6px 12px', fontSize: 12 }}
          >
            🖨️ طباعة التقرير
          </button>
          <Link href="/upload" className="btn btn-primary btn-sm" style={{ padding: '6px 12px', fontSize: 12 }}>
            📤 تقرير جديد
          </Link>
        </div>
      </div>

      {totalPending > 0 && (
        <div className="alert alert-warning" style={{ marginBottom: '16px', padding: '8px 12px', fontSize: 13 }}>
          <span>⚠️</span>
          <span><strong>{totalPending} سلبية</strong> أفاد فريق المستشفى بتلافيها - تحتاج تأكيد من المديرية</span>
        </div>
      )}

      {/* Stats Grid */}
      <div className="stats-grid" style={{ marginBottom: '24px' }}>
        <div className="stat-card danger">
          <div className="stat-value">{totalOpen}</div>
          <div className="stat-label">سلبيات مفتوحة</div>
        </div>
        <div className="stat-card warning">
          <div className="stat-value">{totalRecurring}</div>
          <div className="stat-label">سلبيات مكررة</div>
        </div>
        <div className="stat-card success">
          <div className="stat-value">{totalResolved}</div>
          <div className="stat-label">سلبيات محلولة</div>
        </div>
        <div className="stat-card primary">
          <div className="stat-value">
            {totalOpen + totalResolved > 0 
              ? Math.round((totalResolved / (totalOpen + totalResolved)) * 100) 
              : 0}%
          </div>
          <div className="stat-label">معدل الإنجاز</div>
        </div>
      </div>

      {/* Urgent Action Items */}
      {criticalFindings.length > 0 && (
        <div className="card" style={{ marginBottom: '24px', borderColor: 'var(--danger)', boxShadow: '0 4px 15px rgba(239, 68, 68, 0.1)' }}>
          <div className="card-header" style={{ paddingBottom: '12px', marginBottom: '16px' }}>
            <h2 className="card-title" style={{ color: 'var(--danger)' }}>⚠️ إجراءات عاجلة (سلبيات حرجة أو مكررة)</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {criticalFindings.map(finding => (
              <div key={finding.id} className={`finding-card ${finding.status}`} style={{ margin: 0 }}>
                <div className="finding-header">
                  <div className="finding-text">{finding.canonical_text || finding.original_text}</div>
                </div>
                <div className="finding-meta">
                  <span className="badge badge-neutral">📍 {finding.departments?.name}</span>
                  {finding.priority === 'high' && <span className="badge badge-danger">🔴 أولوية قصوى</span>}
                  {finding.repeat_count > 1 && <span className="badge badge-repeat">🔁 مكررة {finding.repeat_count} مرات</span>}
                  <Link href={`/hospitals/${id}/departments/${finding.departments?.id}`} className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 11 }}>
                    التفاصيل ←
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Reports */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <h2 className="card-title">📋 آخر تقارير المرور</h2>
          <Link href={`/archive?hospital=${id}`} className="btn btn-ghost btn-sm">عرض كل التقارير</Link>
        </div>
        {recentReports.length === 0 ? (
          <div className="empty-state" style={{ padding: 'var(--space-md)' }}>
            <span className="empty-state-icon" style={{ fontSize: 32 }}>📋</span>
            <p className="empty-state-desc">لا توجد تقارير مرور مسجلة</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'right' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 8px' }}>التاريخ</th>
                  <th style={{ padding: '12px 8px' }}>المفتش</th>
                  <th style={{ padding: '12px 8px', textAlign: 'left' }}>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {recentReports.map(report => (
                  <tr key={report.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 8px', fontWeight: 700, color: 'var(--text-main)' }}>
                      {new Date(report.inspection_date).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>
                      {report.inspector_name}
                    </td>
                    <td style={{ padding: '12px 8px', textAlign: 'left' }}>
                      <Link href={`/archive/${report.id}`} className="btn btn-ghost btn-sm no-print" style={{ fontSize: 11, padding: '4px 8px' }}>
                        عرض التقرير
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Accordions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
        {/* KPIs Accordion */}
        <div className="no-print" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-card)' }}>
          <div 
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', padding: '10px 16px' }}
            onClick={() => setShowKpi(!showKpi)}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-main)' }}>📈 المؤشرات الشهرية (من جوجل شيت)</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{showKpi ? '🔼' : '🔽'}</div>
          </div>
          {showKpi && (
            <div style={{ padding: '16px', borderTop: '1px solid var(--border)' }}>
              <DynamicKPI data={kpiData} hospitalName={hospital.name} />
            </div>
          )}
        </div>

        {/* Team Accordion */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-card)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
          <div 
            style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              cursor: 'pointer', 
              padding: '12px 18px',
              background: 'var(--bg-card)',
              userSelect: 'none'
            }}
            onClick={() => setShowTeam(!showTeam)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '18px' }}>👥</span>
              <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>بيانات الإدارة وفريق الجودة</span>
              {hospital.quality_team && hospital.quality_team.length > 0 && (
                <span style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: 'var(--bg-input)',
                  color: 'var(--text-muted)'
                }}>
                  {hospital.quality_team.length} {hospital.quality_team.length === 1 ? 'عضو' : hospital.quality_team.length === 2 ? 'عضوان' : 'أعضاء'}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button 
                className="btn btn-ghost btn-sm no-print" 
                style={{ 
                  padding: '4px 10px', 
                  fontSize: '12px', 
                  fontWeight: 600,
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  background: 'var(--bg-card)'
                }} 
                onClick={(e) => { e.stopPropagation(); setShowEditTeamModal(true); }}
              >
                ✏️ تعديل
              </button>
              <div style={{ 
                fontSize: '11px', 
                color: 'var(--text-muted)',
                width: '24px',
                height: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '4px',
                background: 'var(--bg-input)'
              }}>
                {showTeam ? '▲' : '▼'}
              </div>
            </div>
          </div>
          
          {showTeam && (
            <div style={{ padding: '16px 18px 20px', borderTop: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
              {/* Leadership Row */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
                gap: '14px',
                marginBottom: (hospital.quality_team && hospital.quality_team.length > 0) ? '18px' : '0'
              }}>
                
                {/* Director Card */}
                <div style={{ 
                  background: 'var(--bg-card)', 
                  border: '1px solid rgba(30, 64, 175, 0.15)', 
                  borderRight: '4px solid var(--primary)',
                  borderRadius: '8px', 
                  padding: '14px 16px',
                  boxShadow: 'var(--shadow-sm)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '10px'
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                      <span style={{ fontSize: '15px' }}>🩺</span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--primary)' }}>
                        مدير المستشفى
                      </span>
                    </div>
                    <div style={{ 
                      fontSize: '15px', 
                      fontWeight: 800, 
                      color: hospital.director_name ? 'var(--text-primary)' : 'var(--text-muted)'
                    }}>
                      {hospital.director_name || 'غير مسجل'}
                    </div>
                  </div>

                  {hospital.director_phone ? (
                    <div style={{ paddingTop: '8px', borderTop: '1px dashed var(--border)', display: 'flex', justifyContent: 'flex-start' }}>
                      <a 
                        href={`tel:${hospital.director_phone.replace(/\s+/g, '')}`}
                        dir="ltr"
                        style={{ 
                          display: 'inline-flex', 
                          alignItems: 'center', 
                          gap: '6px', 
                          color: 'var(--primary)', 
                          fontSize: '13px', 
                          fontWeight: 600,
                          textDecoration: 'none',
                          padding: '3px 10px',
                          background: 'rgba(30, 64, 175, 0.06)',
                          borderRadius: '6px',
                          fontFamily: 'system-ui, -apple-system, sans-serif'
                        }}
                      >
                        <span>📞</span>
                        <span style={{ unicodeBidi: 'plaintext' }}>{hospital.director_phone}</span>
                      </a>
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>لا يوجد هاتف مسجل</div>
                  )}
                </div>

                {/* Quality Head Card */}
                <div style={{ 
                  background: 'var(--bg-card)', 
                  border: '1px solid rgba(14, 165, 233, 0.2)', 
                  borderRight: '4px solid var(--accent)',
                  borderRadius: '8px', 
                  padding: '14px 16px',
                  boxShadow: 'var(--shadow-sm)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '10px'
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                      <span style={{ fontSize: '15px' }}>⭐</span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-dark)' }}>
                        رئيس فريق الجودة
                      </span>
                    </div>
                    <div style={{ 
                      fontSize: '15px', 
                      fontWeight: 800, 
                      color: hospital.quality_head_name ? 'var(--text-primary)' : 'var(--text-muted)'
                    }}>
                      {hospital.quality_head_name || 'غير مسجل'}
                    </div>
                  </div>

                  {hospital.quality_head_phone ? (
                    <div style={{ paddingTop: '8px', borderTop: '1px dashed var(--border)', display: 'flex', justifyContent: 'flex-start' }}>
                      <a 
                        href={`tel:${hospital.quality_head_phone.replace(/\s+/g, '')}`}
                        dir="ltr"
                        style={{ 
                          display: 'inline-flex', 
                          alignItems: 'center', 
                          gap: '6px', 
                          color: 'var(--accent-dark)', 
                          fontSize: '13px', 
                          fontWeight: 600,
                          textDecoration: 'none',
                          padding: '3px 10px',
                          background: 'rgba(14, 165, 233, 0.08)',
                          borderRadius: '6px',
                          fontFamily: 'system-ui, -apple-system, sans-serif'
                        }}
                      >
                        <span>📞</span>
                        <span style={{ unicodeBidi: 'plaintext' }}>{hospital.quality_head_phone}</span>
                      </a>
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>لا يوجد هاتف مسجل</div>
                  )}
                </div>

              </div>

              {/* Quality Team Members Section */}
              {hospital.quality_team && hospital.quality_team.length > 0 && (
                <div>
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '10px', 
                    marginBottom: '12px' 
                  }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                      أعضاء فريق الجودة
                    </span>
                    <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                  </div>

                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', 
                    gap: '10px' 
                  }}>
                    {hospital.quality_team.map((member, i) => (
                      <div 
                        key={i} 
                        style={{ 
                          background: 'var(--bg-card)', 
                          border: '1px solid var(--border)', 
                          borderRadius: '8px', 
                          padding: '12px 14px',
                          boxShadow: 'var(--shadow-sm)',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: '8px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                          <div style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            background: 'rgba(30, 64, 175, 0.08)',
                            color: 'var(--primary)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '13px',
                            fontWeight: 700,
                            flexShrink: 0
                          }}>
                            {member.name ? member.name.trim().charAt(0) : '👤'}
                          </div>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ 
                              fontWeight: 700, 
                              fontSize: '13.5px', 
                              color: 'var(--text-primary)',
                              lineHeight: 1.3
                            }}>
                              {member.name}
                            </div>
                            {member.role ? (
                              <div style={{ 
                                display: 'inline-block',
                                fontSize: '11px', 
                                fontWeight: 600,
                                color: 'var(--accent-dark)',
                                background: 'rgba(14, 165, 233, 0.1)',
                                padding: '2px 8px',
                                borderRadius: '10px',
                                marginTop: '4px'
                              }}>
                                {member.role}
                              </div>
                            ) : (
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                                عضو فريق الجودة
                              </div>
                            )}
                          </div>
                        </div>

                        {member.phone && (
                          <div style={{ paddingTop: '8px', borderTop: '1px dashed var(--border)', display: 'flex', justifyContent: 'flex-start' }}>
                            <a 
                              href={`tel:${member.phone.replace(/\s+/g, '')}`}
                              dir="ltr"
                              style={{ 
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                color: 'var(--text-secondary)', 
                                fontSize: '12px',
                                fontWeight: 600,
                                textDecoration: 'none',
                                background: 'var(--bg-input)',
                                padding: '3px 8px',
                                borderRadius: '6px',
                                fontFamily: 'system-ui, -apple-system, sans-serif'
                              }}
                            >
                              <span style={{ fontSize: '11px' }}>📞</span>
                              <span style={{ unicodeBidi: 'plaintext' }}>{member.phone}</span>
                            </a>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Departments Grid - sorted by findings count */}
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 'var(--space-md)', color: 'var(--text-secondary)' }}>
        الأقسام (مرتبة حسب الأولوية)
      </h2>

      {departments.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">📋</span>
          <div className="empty-state-title">لا توجد أقسام بعد</div>
          <p className="empty-state-desc">ارفع تقرير مرور لهذه المنشأة لإضافة الأقسام والسلبيات</p>
        </div>
      ) : (
        <div className="dept-grid">
          {departments.map((dept, idx) => {
            const riskLevel = dept.recurring >= 3 ? 'critical' : dept.recurring >= 1 ? 'high' : dept.open > 0 ? 'medium' : 'good'
            const maxFindings = Math.max(...departments.map(d => d.open), 1)
            const barWidth = (dept.open / maxFindings) * 100

            return (
              <Link key={dept.id} href={`/hospitals/${id}/departments/${dept.id}`} style={{ display: 'block' }}>
                <div className="dept-card" id={`dept-${dept.id}`}>
                  
                  {/* Left Side: Icon & Info */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flex: 1 }}>
                    <div className={`dept-icon ${riskLevel}`}>
                      {getDeptIcon(dept.name)}
                    </div>
                    <div>
                      <div className="dept-name">{dept.name}</div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                        {idx === 0 && (
                          <span className="badge badge-danger">
                            🔴 الأولوية الأعلى
                          </span>
                        )}
                        {dept.recurring > 0 && (
                          <span className="badge badge-repeat">🔁 {dept.recurring} مكررة</span>
                        )}
                        {dept.pendingConfirm > 0 && (
                          <span className="badge badge-warning">⏳ {dept.pendingConfirm}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Side: Compact Stats */}
                  <div className="dept-stats">
                    <div className="dept-stat">
                      <div className="dept-stat-value" style={{ color: 'var(--danger)' }}>{dept.open}</div>
                      <div className="dept-stat-label">مفتوحة</div>
                    </div>
                    <div className="dept-stat">
                      <div className="dept-stat-value" style={{ color: 'var(--success)' }}>{dept.resolved}</div>
                      <div className="dept-stat-label">محلولة</div>
                    </div>
                  </div>

                </div>
              </Link>
            )
          })}
        </div>
      )}

      {/* Edit Team Modal */}
      {showEditTeamModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-md)'
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 600, maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 className="card-title mb-md">تعديل بيانات الإدارة وفريق الجودة</h2>
            
            <div className="form-group">
              <label className="form-label">مدير المستشفى</label>
              <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                <input 
                  type="text" className="form-input" placeholder="الاسم" 
                  value={editForm.director_name} 
                  onChange={(e) => setEditForm(prev => ({...prev, director_name: e.target.value}))}
                  style={{ flex: 1 }}
                />
                <input 
                  type="text" className="form-input" placeholder="رقم الهاتف" 
                  value={editForm.director_phone} 
                  onChange={(e) => setEditForm(prev => ({...prev, director_phone: e.target.value}))}
                  style={{ flex: 1 }}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">رئيس فريق الجودة</label>
              <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                <input 
                  type="text" className="form-input" placeholder="الاسم" 
                  value={editForm.quality_head_name} 
                  onChange={(e) => setEditForm(prev => ({...prev, quality_head_name: e.target.value}))}
                  style={{ flex: 1 }}
                />
                <input 
                  type="text" className="form-input" placeholder="رقم الهاتف" 
                  value={editForm.quality_head_phone} 
                  onChange={(e) => setEditForm(prev => ({...prev, quality_head_phone: e.target.value}))}
                  style={{ flex: 1 }}
                />
              </div>
            </div>

            <div className="form-group" style={{ marginTop: 'var(--space-lg)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-md)' }}>
              <label className="form-label">أعضاء فريق الجودة</label>
              
              {/* Existing Members */}
              {editForm.quality_team?.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: 'var(--space-md)' }}>
                  {editForm.quality_team.map((m, i) => (
                    <div key={i} style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center',
                      background: 'var(--bg-input)', 
                      padding: '8px 12px', 
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '13.5px' }}>{m.name}</strong>
                        {m.role && (
                          <span style={{ 
                            fontSize: '11px', 
                            padding: '1px 8px', 
                            borderRadius: '10px', 
                            background: 'rgba(14, 165, 233, 0.1)', 
                            color: 'var(--accent-dark)', 
                            fontWeight: 600 
                          }}>
                            {m.role}
                          </span>
                        )}
                        {m.phone && (
                          <span dir="ltr" style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <span>📞</span>
                            <span style={{ unicodeBidi: 'plaintext' }}>{m.phone}</span>
                          </span>
                        )}
                      </div>
                      <button 
                        onClick={() => handleRemoveTeamMember(i)} 
                        type="button"
                        style={{ 
                          background: 'none', 
                          border: 'none', 
                          color: 'var(--danger)', 
                          cursor: 'pointer',
                          padding: '4px',
                          fontSize: '14px'
                        }}
                        title="حذف"
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add New Member */}
              <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-start' }}>
                <input 
                  type="text" className="form-input" placeholder="اسم العضو" 
                  value={newMember.name} onChange={(e) => setNewMember(p => ({...p, name: e.target.value}))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTeamMember(); } }}
                  style={{ flex: 2 }}
                />
                <input 
                  type="text" className="form-input" placeholder="دوره (اختياري)" 
                  value={newMember.role} onChange={(e) => setNewMember(p => ({...p, role: e.target.value}))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTeamMember(); } }}
                  style={{ flex: 1 }}
                />
                <input 
                  type="text" className="form-input" placeholder="الهاتف" 
                  value={newMember.phone} onChange={(e) => setNewMember(p => ({...p, phone: e.target.value}))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTeamMember(); } }}
                  style={{ flex: 1 }}
                />
                <button className="btn btn-ghost" onClick={handleAddTeamMember} type="button" title="إضافة عضو">
                  ➕
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-md)', marginTop: 'var(--space-xl)' }}>
              <button className="btn btn-ghost" onClick={() => setShowEditTeamModal(false)}>إلغاء</button>
              <button className="btn btn-primary" onClick={handleSaveTeam} disabled={savingTeam}>
                {savingTeam ? 'جاري الحفظ...' : 'حفظ التعديلات'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
