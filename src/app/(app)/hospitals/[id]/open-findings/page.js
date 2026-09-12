'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
const PRIORITY_CONFIG = {
  high: { label: 'خطورة عالية', class: 'badge-danger' },
  medium: { label: 'متوسطة', class: 'badge-warning' },
  low: { label: 'عادية', class: 'badge-info' }
}

// SVG Icons
const PrinterIcon = ({ className }) => (
  <svg className={className} style={{ width: '16px', height: '16px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
  </svg>
)

const FilterIcon = ({ className }) => (
  <svg className={className} style={{ width: '20px', height: '20px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
  </svg>
)

const CheckIcon = ({ className }) => (
  <svg className={className} style={{ width: '16px', height: '16px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
)

export default function OpenFindingsPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id // hospital ID

  const [loading, setLoading] = useState(true)
  const [hospital, setHospital] = useState(null)
  const [findings, setFindings] = useState([])
  const [departments, setDepartments] = useState([])

  // Filters
  const [selectedDept, setSelectedDept] = useState('all')
  const [selectedPriority, setSelectedPriority] = useState('all')
  const [selectedResponsible, setSelectedResponsible] = useState('all')

  // Print Options
  const [showPrintOptions, setShowPrintOptions] = useState(false)
  const [printConfig, setPrintConfig] = useState({
    dept: 'all', // 'all' or specific dept_id
    showResponsible: true,
    showPriority: true,
    showDeadline: true
  })

  // Local checklist state for UI only (does NOT mutate DB)
  const [checkedItems, setCheckedItems] = useState(new Set())

  useEffect(() => {
    fetchData()
  }, [id])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [hospRes, deptsRes, findingsRes] = await Promise.all([
        supabase.from('hospitals').select('id, name, governorate').eq('id', id).single(),
        supabase.from('departments').select('id, name'),
        supabase.from('v_report_findings')
          .select('*')
          .eq('hospital_id', id)
          .in('status', ['open', 'recurring'])
          .order('department_id')
          .order('first_seen_date', { ascending: false })
      ])

      if (hospRes.data) setHospital(hospRes.data)
      if (deptsRes.data) setDepartments(deptsRes.data)
      if (findingsRes.data) setFindings(findingsRes.data)
    } catch (err) {
      console.error('Error fetching open findings:', err)
    } finally {
      setLoading(false)
    }
  }

  const toggleCheck = (findingId) => {
    const newChecked = new Set(checkedItems)
    if (newChecked.has(findingId)) {
      newChecked.delete(findingId)
    } else {
      newChecked.add(findingId)
    }
    setCheckedItems(newChecked)
  }

  // Derived data
  const deptMap = new Map(departments.map(d => [d.id, d.name]))
  const responsibles = [...new Set(findings.map(f => f.responsible).filter(Boolean))]

  // Filter findings
  let filteredFindings = findings
  if (selectedDept !== 'all') {
    filteredFindings = filteredFindings.filter(f => f.department_id === selectedDept)
  }
  if (selectedPriority !== 'all') {
    filteredFindings = filteredFindings.filter(f => f.priority === selectedPriority)
  }
  if (selectedResponsible !== 'all') {
    filteredFindings = filteredFindings.filter(f => f.responsible === selectedResponsible)
  }

  // Group by department
  const groupedFindings = {}
  filteredFindings.forEach(f => {
    const dName = deptMap.get(f.department_id) || 'قسم غير معروف'
    if (!groupedFindings[dName]) groupedFindings[dName] = []
    groupedFindings[dName].push(f)
  })

  const formatDate = (d) => {
    if (!d) return ''
    return new Date(d).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' })
  }

  const handlePrint = () => {
    window.print()
    setShowPrintOptions(false)
  }

  if (loading) {
    return <div className="loading-state"><div className="loading-spinner" /><span>جاري التحميل...</span></div>
  }

  if (!hospital) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">❓</span>
        <div className="empty-state-title">المستشفى غير موجود</div>
        <Link href="/dashboard" className="btn btn-primary">← العودة للرئيسية</Link>
      </div>
    )
  }

  return (
    <div className="open-findings-page">
      {/* Print Styles */}
      <style dangerouslySetInnerHTML={{__html: `
        @media print {
          @page { margin: 0; size: A4; }
          body, html { background: #fff !important; color: #000 !important; }
          
          /* Hide sidebar, header, etc. */
          .sidebar, .top-header, .no-print { display: none !important; }
          .main-content, .app-layout, .page-content, body { 
            margin: 0 !important; 
            padding: 0 !important; 
            background: #fff !important;
            overflow: visible !important;
          }
          
          .print-section, .print-section * { visibility: visible; }
          .print-section {
            padding: 2cm !important;
            direction: rtl;
            background: white;
            color: black;
            width: 100%;
          }
          .print-header { display: block !important; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
          .print-dept-title { border-bottom: 1px solid #ccc; margin-top: 30px; margin-bottom: 15px; padding-bottom: 5px; font-size: 18px; font-weight: bold; page-break-after: avoid; }
          .print-dept-wrapper { page-break-inside: auto; }
          .print-item { display: flex; gap: 10px; margin-bottom: 12px; page-break-inside: avoid; }
          .print-checkbox { width: 16px; height: 16px; border: 1px solid #000; display: inline-block; flex-shrink: 0; margin-top: 4px; }
          .badge { border: 1px solid #999 !important; background: transparent !important; color: #333 !important; }
          
          /* Print only specific department if selected */
          .print-dept-wrapper[data-dept-id] { display: block; }
          ${printConfig.dept !== 'all' ? `.print-dept-wrapper:not([data-dept-id="${printConfig.dept}"]) { display: none !important; }` : ''}
          ${!printConfig.showPriority ? '.print-priority { display: none !important; }' : ''}
          ${!printConfig.showResponsible ? '.print-responsible { display: none !important; }' : ''}
          ${!printConfig.showDeadline ? '.print-deadline { display: none !important; }' : ''}
        }
        .print-header { display: none; }
      `}} />

      {/* Page Header (No Print) */}
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <Link href={`/hospitals/${id}`} style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
            <span>←</span> العودة للمستشفى
          </Link>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
            السلبيات المفتوحة <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 400 }}>({hospital.name})</span>
          </h1>
        </div>
        <div style={{ display: 'flex', gap: '8px', position: 'relative' }}>
          <button className="btn btn-primary" onClick={() => setShowPrintOptions(!showPrintOptions)}>
            <PrinterIcon className="w-4 h-4" />
            طباعة Checklist
          </button>
          
          {showPrintOptions && (
            <div style={{ position: 'absolute', top: '110%', left: 0, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', boxShadow: 'var(--shadow-md)', zIndex: 10, width: '280px' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 12px 0' }}>خيارات الطباعة</h3>
              
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: 12, marginBottom: '4px' }}>القسم:</label>
                <select className="form-input" style={{ width: '100%', padding: '4px 8px', fontSize: 13 }} value={printConfig.dept} onChange={e => setPrintConfig({...printConfig, dept: e.target.value})}>
                  <option value="all">كل الأقسام</option>
                  {Object.keys(groupedFindings).map(dName => {
                    const deptId = groupedFindings[dName][0]?.department_id
                    return <option key={deptId} value={deptId}>{dName}</option>
                  })}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={printConfig.showPriority} onChange={e => setPrintConfig({...printConfig, showPriority: e.target.checked})} />
                  إظهار الأولوية
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={printConfig.showResponsible} onChange={e => setPrintConfig({...printConfig, showResponsible: e.target.checked})} />
                  إظهار المسؤول
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={printConfig.showDeadline} onChange={e => setPrintConfig({...printConfig, showDeadline: e.target.checked})} />
                  إظهار تاريخ الاستحقاق
                </label>
              </div>
              
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowPrintOptions(false)}>إلغاء</button>
                <button className="btn btn-primary btn-sm" onClick={handlePrint}>طباعة الآن</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Filters (No Print) */}
      <div className="card no-print" style={{ marginBottom: '24px', padding: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', color: 'var(--text-secondary)' }}>
          <FilterIcon className="w-5 h-5" />
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>تصفية السلبيات</h3>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: '6px', color: 'var(--text-muted)' }}>القسم</label>
            <select className="form-input" value={selectedDept} onChange={e => setSelectedDept(e.target.value)}>
              <option value="all">كل الأقسام</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: '6px', color: 'var(--text-muted)' }}>الخطورة / الأولوية</label>
            <select className="form-input" value={selectedPriority} onChange={e => setSelectedPriority(e.target.value)}>
              <option value="all">الكل</option>
              {Object.keys(PRIORITY_CONFIG).map(p => (
                <option key={p} value={p}>{PRIORITY_CONFIG[p].label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: '6px', color: 'var(--text-muted)' }}>المسؤول</label>
            <select className="form-input" value={selectedResponsible} onChange={e => setSelectedResponsible(e.target.value)}>
              <option value="all">الكل</option>
              {responsibles.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main Content (Printable) */}
      <div className="print-section">
        {/* Hidden on screen, visible on print */}
        <div className="print-header">
          <h1 style={{ margin: '0 0 10px 0', fontSize: 24 }}>تقرير السلبيات المفتوحة (Checklist)</h1>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
            <div><strong>المستشفى:</strong> {hospital.name}</div>
            <div><strong>تاريخ الطباعة:</strong> {new Date().toLocaleDateString('ar-EG')}</div>
          </div>
        </div>

        {Object.keys(groupedFindings).length === 0 ? (
          <div className="empty-state no-print">
            <span className="empty-state-icon">✅</span>
            <div className="empty-state-title">لا توجد سلبيات مفتوحة تطابق الفلاتر</div>
          </div>
        ) : (
          Object.keys(groupedFindings).map(dName => {
            const deptFindings = groupedFindings[dName]
            const deptId = deptFindings[0]?.department_id
            
            return (
              <div key={dName} className="print-dept-wrapper" data-dept-id={deptId} style={{ marginBottom: '32px' }}>
                <div className="print-dept-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'var(--primary-dark)' }}>{dName}</h2>
                  <span className="badge badge-primary no-print">{deptFindings.length} سلبيات</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {deptFindings.map(finding => (
                    <div 
                      key={finding.id} 
                      className="print-item card" 
                      style={{ 
                        padding: '16px', 
                        display: 'flex', 
                        gap: '12px', 
                        alignItems: 'flex-start',
                        background: checkedItems.has(finding.id) ? 'rgba(16, 185, 129, 0.05)' : 'var(--bg-card)',
                        border: checkedItems.has(finding.id) ? '1px solid var(--success)' : '1px solid var(--border)',
                        transition: 'all 0.2s ease',
                        cursor: 'pointer'
                      }}
                      onClick={() => toggleCheck(finding.id)}
                    >
                      {/* Checkbox */}
                      <div className="no-print" style={{ 
                        width: '24px', height: '24px', borderRadius: '6px', 
                        border: checkedItems.has(finding.id) ? 'none' : '2px solid var(--border)',
                        background: checkedItems.has(finding.id) ? 'var(--success)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, marginTop: '2px'
                      }}>
                        {checkedItems.has(finding.id) && <CheckIcon className="w-4 h-4 text-white" />}
                      </div>
                      <div className="print-checkbox" />

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-main)', lineHeight: 1.5, marginBottom: '8px' }}>
                          {finding.original_text}
                        </div>
                        
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: 12 }}>
                          <span style={{ color: 'var(--text-muted)' }}>
                            الرصد: {formatDate(finding.first_seen_date)}
                          </span>
                          
                          {finding.priority && PRIORITY_CONFIG[finding.priority] && (
                            <span className={`print-priority badge ${PRIORITY_CONFIG[finding.priority].class}`} style={{ padding: '2px 6px', fontSize: 11 }}>
                              {PRIORITY_CONFIG[finding.priority].label}
                            </span>
                          )}

                          {finding.responsible && (
                            <span className="print-responsible badge" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', padding: '2px 6px', fontSize: 11 }}>
                              👤 {finding.responsible}
                            </span>
                          )}

                          {finding.deadline && (
                            <span className="print-deadline badge" style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger-dark)', padding: '2px 6px', fontSize: 11 }}>
                              ⏰ {formatDate(finding.deadline)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
