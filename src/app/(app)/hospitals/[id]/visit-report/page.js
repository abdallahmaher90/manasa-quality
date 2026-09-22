'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useToast } from '@/components/Toast'
import { generateVisitReport } from '@/lib/generateVisitReport'

export default function VisitReportPage() {
  const { id } = useParams()
  const router = useRouter()
  const { showToast } = useToast()
  
  const [hospital, setHospital] = useState(null)
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  
  // Selections
  const [selectedDepartments, setSelectedDepartments] = useState([])
  const [resolvedFindings, setResolvedFindings] = useState([])
  const [unresolvedFindings, setUnresolvedFindings] = useState([])
  const [selectedUnresolved, setSelectedUnresolved] = useState(new Set())
  const [newFindings, setNewFindings] = useState([{ deptId: '', text: '' }])
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    fetchInitialData()
  }, [id])

  useEffect(() => {
    if (selectedDepartments.length > 0) {
      fetchFindingsForSelectedDepartments()
    } else {
      setResolvedFindings([])
      setUnresolvedFindings([])
      setSelectedUnresolved(new Set())
    }
  }, [selectedDepartments])

  const fetchInitialData = async () => {
    try {
      const [hospRes, deptRes] = await Promise.all([
        supabase.from('hospitals').select('*').eq('id', id).single(),
        supabase.from('departments').select('*').eq('hospital_id', id).order('name')
      ])
      
      if (hospRes.data) setHospital(hospRes.data)
      if (deptRes.data) setDepartments(deptRes.data)
    } catch (err) {
      console.error(err)
      showToast('حدث خطأ أثناء جلب البيانات', 'error')
    } finally {
      setLoading(false)
    }
  }

  const fetchFindingsForSelectedDepartments = async () => {
    const twoDaysAgo = new Date()
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
    const isoDateString = twoDaysAgo.toISOString()

    try {
      // Fetch resolved in last 2 days
      const { data: resolvedData, error: resolvedErr } = await supabase
        .from('v_report_findings')
        .select('*, departments(name)')
        .eq('hospital_id', id)
        .in('department_id', selectedDepartments)
        .in('status', ['resolved_confirmed'])
        .gte('resolved_date', isoDateString)

      if (resolvedErr) throw resolvedErr

      // Fetch unresolved (open, recurring, pending_review/resolved_by_hospital)
      const { data: unresolvedData, error: unresolvedErr } = await supabase
        .from('v_report_findings')
        .select('*, departments(name)')
        .eq('hospital_id', id)
        .in('department_id', selectedDepartments)
        .in('status', ['open', 'recurring', 'resolved_by_hospital', 'pending_review'])
        .order('priority', { ascending: false })

      if (unresolvedErr) throw unresolvedErr

      setResolvedFindings(resolvedData || [])
      setUnresolvedFindings(unresolvedData || [])
      // Default to empty selection for unresolved
      setSelectedUnresolved(new Set())
    } catch (err) {
      console.error(err)
      showToast('حدث خطأ أثناء جلب السلبيات', 'error')
    }
  }

  const toggleDept = (deptId) => {
    setSelectedDepartments(prev => 
      prev.includes(deptId) ? prev.filter(id => id !== deptId) : [...prev, deptId]
    )
  }

  const toggleUnresolved = (findingId) => {
    const newSet = new Set(selectedUnresolved)
    if (newSet.has(findingId)) {
      newSet.delete(findingId)
    } else {
      newSet.add(findingId)
    }
    setSelectedUnresolved(newSet)
  }

  const addNewFindingRow = () => {
    setNewFindings([...newFindings, { deptId: '', text: '' }])
  }
  
  const updateNewFinding = (index, field, value) => {
    const updated = [...newFindings]
    updated[index][field] = value
    setNewFindings(updated)
  }
  
  const removeNewFinding = (index) => {
    const updated = [...newFindings]
    updated.splice(index, 1)
    setNewFindings(updated)
  }

  const handleGenerateReport = async () => {
    if (selectedDepartments.length === 0) {
      showToast('يجب اختيار قسم واحد على الأقل', 'error')
      return
    }

    setGenerating(true)
    try {
      const selectedUnresolvedList = unresolvedFindings.filter(f => selectedUnresolved.has(f.id))
      const validNewFindings = newFindings.filter(f => f.text.trim() !== '')
      
      // Map deptId to dept name for new findings
      const newFindingsWithDeptNames = validNewFindings.map(f => {
        const dept = departments.find(d => d.id === f.deptId)
        return {
          ...f,
          departments: { name: dept ? dept.name : 'عام' }
        }
      })

      await generateVisitReport({
        hospitalName: hospital.name,
        resolvedFindings,
        unresolvedFindings: selectedUnresolvedList,
        newFindings: newFindingsWithDeptNames,
        departments: departments.filter(d => selectedDepartments.includes(d.id)).map(d => d.name)
      })
      showToast('تم إنشاء التقرير بنجاح', 'success')
    } catch (err) {
      console.error(err)
      showToast('حدث خطأ أثناء إنشاء التقرير', 'error')
    } finally {
      setGenerating(false)
    }
  }

  if (loading) return <div className="loading-state"><div className="loading-spinner" /><span>جاري التحميل...</span></div>

  if (!hospital) return <div className="empty-state">المستشفى غير موجود</div>

  return (
    <div style={{ paddingBottom: '60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>إنشاء تقرير مرور</h1>
          <p style={{ color: 'var(--text-muted)', marginTop: 4 }}>{hospital.name}</p>
        </div>
        <Link href={`/hospitals/${id}`} className="btn btn-ghost">← العودة</Link>
      </div>

      {/* Step 1: Departments */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <h2 className="card-title" style={{ marginBottom: '16px' }}>1. الأقسام التي تم المرور عليها</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {departments.map(dept => {
            const isSelected = selectedDepartments.includes(dept.id)
            return (
              <button
                key={dept.id}
                onClick={() => toggleDept(dept.id)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '20px',
                  border: `1px solid ${isSelected ? 'var(--primary)' : 'var(--border)'}`,
                  background: isSelected ? 'var(--primary)' : 'var(--bg-card)',
                  color: isSelected ? 'white' : 'var(--text-main)',
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {dept.name}
              </button>
            )
          })}
        </div>
        {selectedDepartments.length === 0 && (
          <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: '12px' }}>يرجى اختيار الأقسام لاستكمال التقرير</p>
        )}
      </div>

      {selectedDepartments.length > 0 && (
        <>
          {/* Step 2: Resolved Findings */}
          <div className="card" style={{ marginBottom: '24px' }}>
            <h2 className="card-title" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--success)' }}>✅</span>
              2. سلبيات تم حلها (آخر 48 ساعة)
            </h2>
            {resolvedFindings.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>لا توجد سلبيات تم تأكيد حلها في آخر يومين لهذه الأقسام.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {resolvedFindings.map(finding => (
                  <div key={finding.id} style={{ padding: '12px', background: 'var(--bg-primary)', borderRadius: '8px', borderLeft: '4px solid var(--success)' }}>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>{finding.departments?.name}</div>
                    <div style={{ fontSize: 14 }}>{finding.canonical_text || finding.original_text}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Step 3: Unresolved Findings */}
          <div className="card" style={{ marginBottom: '24px' }}>
            <h2 className="card-title" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--warning)' }}>⚠️</span>
              3. سلبيات من مرورات سابقة لم تحل
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: '16px' }}>اختر السلبيات التي تود إضافتها للتقرير (التي لا تزال موجودة).</p>
            
            {unresolvedFindings.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>لا توجد سلبيات مفتوحة لهذه الأقسام.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {unresolvedFindings.map(finding => {
                  const isSelected = selectedUnresolved.has(finding.id)
                  return (
                    <div 
                      key={finding.id} 
                      onClick={() => toggleUnresolved(finding.id)}
                      style={{ 
                        padding: '12px', 
                        background: isSelected ? 'var(--bg-primary)' : 'var(--bg-card)', 
                        borderRadius: '8px', 
                        border: `1px solid ${isSelected ? 'var(--primary)' : 'var(--border)'}`,
                        cursor: 'pointer',
                        display: 'flex',
                        gap: '12px',
                        alignItems: 'flex-start'
                      }}
                    >
                      <input 
                        type="checkbox" 
                        checked={isSelected} 
                        onChange={() => {}} 
                        style={{ marginTop: 4, width: 16, height: 16, accentColor: 'var(--primary)' }}
                      />
                      <div>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
                          {finding.departments?.name} | <span style={{ color: finding.priority === 'high' ? 'var(--danger)' : 'inherit'}}>{finding.priority === 'high' ? 'عالية الأهمية' : 'عادية'}</span>
                        </div>
                        <div style={{ fontSize: 14, color: isSelected ? 'var(--text-main)' : 'var(--text-secondary)' }}>
                          {finding.canonical_text || finding.original_text}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Step 4: New Findings */}
          <div className="card" style={{ marginBottom: '24px' }}>
            <h2 className="card-title" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--danger)' }}>➕</span>
              4. سلبيات جديدة من المرور الحالي
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {newFindings.map((finding, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                  <select 
                    className="form-input" 
                    style={{ width: '150px' }}
                    value={finding.deptId}
                    onChange={e => updateNewFinding(idx, 'deptId', e.target.value)}
                  >
                    <option value="">(القسم)</option>
                    {departments.filter(d => selectedDepartments.includes(d.id)).map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                  <textarea 
                    className="form-input"
                    placeholder="اكتب السلبية هنا..."
                    style={{ flex: 1, minHeight: '60px', resize: 'vertical' }}
                    value={finding.text}
                    onChange={e => updateNewFinding(idx, 'text', e.target.value)}
                  />
                  {newFindings.length > 1 && (
                    <button 
                      onClick={() => removeNewFinding(idx)}
                      className="btn btn-ghost" 
                      style={{ color: 'var(--danger)', padding: '8px' }}
                      title="حذف"
                    >
                      ✖
                    </button>
                  )}
                </div>
              ))}
              <button onClick={addNewFindingRow} className="btn btn-ghost" style={{ alignSelf: 'flex-start' }}>
                + إضافة سلبية أخرى
              </button>
            </div>
          </div>

          {/* Generate Button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '32px' }}>
            <button 
              onClick={handleGenerateReport} 
              disabled={generating}
              className="btn btn-primary" 
              style={{ fontSize: 16, padding: '12px 24px' }}
            >
              {generating ? 'جاري الإنشاء...' : '📥 تحميل تقرير المرور (Word)'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
