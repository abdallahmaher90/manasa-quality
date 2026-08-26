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
  const [showTeam, setShowTeam] = useState(false)
  
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
    const [hospRes, deptRes] = await Promise.all([
      supabase.from('hospitals').select('*').eq('id', id).single(),
      supabase.from('departments').select(`
        id, name,
        findings!findings_department_id_fkey(id, status, repeat_count, priority)
      `).eq('hospital_id', id).order('name'),
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
    const { error } = await supabase.from('hospitals').update({
      director_name: editForm.director_name,
      director_phone: editForm.director_phone,
      quality_head_name: editForm.quality_head_name,
      quality_head_phone: editForm.quality_head_phone,
      quality_team: editForm.quality_team
    }).eq('id', id)

    if (!error) {
      setHospital(prev => ({ ...prev, ...editForm }))
      setShowEditTeamModal(false)
    } else {
      alert('حدث خطأ أثناء الحفظ')
    }
    setSavingTeam(false)
  }

  const handleAddTeamMember = () => {
    if (!newMember.name) return
    setEditForm(prev => ({
      ...prev,
      quality_team: [...prev.quality_team, newMember]
    }))
    setNewMember({ name: '', role: '', phone: '' })
  }

  const handleRemoveTeamMember = (index) => {
    setEditForm(prev => ({
      ...prev,
      quality_team: prev.quality_team.filter((_, i) => i !== index)
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
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-card)' }}>
          <div 
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', padding: '10px 16px' }}
            onClick={() => setShowTeam(!showTeam)}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-main)' }}>👥 بيانات الإدارة وفريق الجودة</div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <button className="btn btn-ghost btn-sm no-print" style={{ padding: '2px 8px', fontSize: 11 }} onClick={(e) => { e.stopPropagation(); setShowEditTeamModal(true); }}>
                ✏️ تعديل
              </button>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{showTeam ? '🔼' : '🔽'}</div>
            </div>
          </div>
          
          {showTeam && (
            <div style={{ marginTop: 'var(--space-lg)', paddingTop: 'var(--space-lg)', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 'var(--space-md)' }}>
                <div style={{ padding: 'var(--space-sm)', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>مدير المستشفى</div>
                  <div style={{ fontWeight: 600 }}>{hospital.director_name || 'غير مسجل'}</div>
                  {hospital.director_phone && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>📞 {hospital.director_phone}</div>}
                </div>
                <div style={{ padding: 'var(--space-sm)', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>رئيس فريق الجودة</div>
                  <div style={{ fontWeight: 600 }}>{hospital.quality_head_name || 'غير مسجل'}</div>
                  {hospital.quality_head_phone && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>📞 {hospital.quality_head_phone}</div>}
                </div>
              </div>

              {hospital.quality_team && hospital.quality_team.length > 0 && (
                <div style={{ marginTop: 'var(--space-md)' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 'var(--space-sm)' }}>أعضاء فريق الجودة:</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
                    {hospital.quality_team.map((member, i) => (
                      <div key={i} style={{ padding: '6px 12px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', fontSize: 13 }}>
                        <span style={{ fontWeight: 600 }}>{member.name}</span>
                        {member.role && <span style={{ color: 'var(--text-muted)' }}> - {member.role}</span>}
                        {member.phone && <span style={{ color: 'var(--text-secondary)', marginRight: 8 }}>📞 {member.phone}</span>}
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
              {editForm.quality_team.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', marginBottom: 'var(--space-md)' }}>
                  {editForm.quality_team.map((m, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--bg-secondary)', padding: '8px 12px', borderRadius: 'var(--radius-sm)' }}>
                      <div>
                        <strong>{m.name}</strong> {m.role && <span>({m.role})</span>} {m.phone && <span>- 📞 {m.phone}</span>}
                      </div>
                      <button onClick={() => handleRemoveTeamMember(i)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}>🗑️</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add New Member */}
              <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-start' }}>
                <input 
                  type="text" className="form-input" placeholder="اسم العضو" 
                  value={newMember.name} onChange={(e) => setNewMember(p => ({...p, name: e.target.value}))}
                  style={{ flex: 2 }}
                />
                <input 
                  type="text" className="form-input" placeholder="دوره (اختياري)" 
                  value={newMember.role} onChange={(e) => setNewMember(p => ({...p, role: e.target.value}))}
                  style={{ flex: 1 }}
                />
                <input 
                  type="text" className="form-input" placeholder="الهاتف" 
                  value={newMember.phone} onChange={(e) => setNewMember(p => ({...p, phone: e.target.value}))}
                  style={{ flex: 1 }}
                />
                <button className="btn btn-ghost" onClick={handleAddTeamMember} type="button">
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
