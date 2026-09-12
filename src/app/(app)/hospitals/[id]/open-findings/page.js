'use client'

import React, { useState, useEffect, Fragment } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
const PRIORITY_CONFIG = {
  high: { label: 'خطورة عالية', class: 'badge-danger' },
  medium: { label: 'متوسطة', class: 'badge-warning' },
  low: { label: 'عادية', class: 'badge-info' }
}

// SVG Icons
const DownloadIcon = ({ className }) => (
  <svg className={className} style={{ width: '16px', height: '16px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
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
  const [selectedDepts, setSelectedDepts] = useState(new Set())

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
      if (findingsRes.data && deptsRes.data) {
        setFindings(findingsRes.data)
        const hospDeptIds = [...new Set(findingsRes.data.map(f => f.department_id))]
        const hospDepts = deptsRes.data.filter(d => hospDeptIds.includes(d.id))
        setDepartments(hospDepts)
        setSelectedDepts(new Set(hospDeptIds))
      }
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

  // Filter findings
  let filteredFindings = findings
  if (selectedDepts.size > 0) {
    filteredFindings = filteredFindings.filter(f => selectedDepts.has(f.department_id))
  } else {
    filteredFindings = []
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
        @media screen {
          .print-only-cell { display: none !important; }
        }
        @media print {
          @page { margin: 1cm; size: A4 portrait; }
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
            direction: rtl;
            background: white;
            color: black;
            width: 100%;
          }
          .print-header { display: block !important; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
          
          /* Print only specific department if selected */
          .print-dept-wrapper[data-dept-id] { display: table-row; }
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
          <button className="btn btn-primary" onClick={handlePrint}>
            <DownloadIcon className="w-4 h-4 ml-2" />
            تنزيل الـ Checklist
          </button>
        </div>
      </div>

      {/* Filters (No Print) */}
      <div className="card no-print" style={{ marginBottom: '24px', padding: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', color: 'var(--text-secondary)' }}>
          <FilterIcon className="w-5 h-5" />
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>اختر الأقسام المطلوبة في التقرير</h3>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
          {departments.map(d => (
            <label key={d.id} style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px', 
              cursor: 'pointer', 
              background: 'var(--bg-secondary)', 
              padding: '6px 12px', 
              borderRadius: '20px', 
              border: selectedDepts.has(d.id) ? '2px solid var(--primary)' : '2px solid transparent',
              transition: 'all 0.2s ease'
            }}>
              <input 
                type="checkbox" 
                checked={selectedDepts.has(d.id)}
                onChange={(e) => {
                  const newSet = new Set(selectedDepts)
                  if (e.target.checked) newSet.add(d.id)
                  else newSet.delete(d.id)
                  setSelectedDepts(newSet)
                }}
                style={{ display: 'none' }}
              />
              <span style={{ 
                fontSize: 13, 
                fontWeight: selectedDepts.has(d.id) ? 700 : 500, 
                color: selectedDepts.has(d.id) ? 'var(--primary)' : 'var(--text-main)',
                transition: 'all 0.2s ease'
              }}>{d.name}</span>
            </label>
          ))}
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
          <table style={{ 
            width: '100%', 
            borderCollapse: 'collapse', 
            border: '2px solid #333',
            background: '#fff',
            color: '#333'
          }}>
            <thead>
              <tr>
                <th style={{ padding: '12px', border: '1px solid #333', textAlign: 'center', background: '#fff', fontWeight: 'bold' }}>السلبية (Item)</th>
                <th className="print-only-cell" style={{ padding: '12px', border: '1px solid #333', width: '25%', textAlign: 'center', background: '#fff', fontWeight: 'bold' }}>ملاحظات (Notes)</th>
                <th style={{ padding: '12px', border: '1px solid #333', width: '10%', textAlign: 'center', background: '#fff', fontWeight: 'bold' }}>النتيجة (Result)</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(groupedFindings).map((dName, dIndex) => {
                const deptFindings = groupedFindings[dName]
                const deptId = deptFindings[0]?.department_id
                
                return (
                  <Fragment key={dName}>
                    {/* Department Header */}
                    <tr className="print-dept-wrapper" data-dept-id={deptId}>
                      <td colSpan="3" style={{ 
                        padding: '12px 16px', 
                        border: '1px solid #333', 
                        background: '#555', 
                        color: '#fff', 
                        fontWeight: 'bold', 
                        fontSize: '18px',
                        WebkitPrintColorAdjust: 'exact',
                        printColorAdjust: 'exact'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={{ fontSize: '24px', opacity: 0.6, fontWeight: 900 }}>{dIndex + 1}</span>
                          <span>{dName}</span>
                        </div>
                      </td>
                    </tr>
                    
                    {/* Findings Rows */}
                    {deptFindings.map((finding) => (
                      <tr 
                        key={finding.id}
                        className="print-dept-wrapper" 
                        data-dept-id={deptId}
                        style={{ 
                          background: checkedItems.has(finding.id) ? 'rgba(0,0,0,0.02)' : '#fff',
                          cursor: 'pointer',
                          pageBreakInside: 'avoid'
                        }}
                        onClick={() => toggleCheck(finding.id)}
                      >
                        {/* Item Column */}
                        <td style={{ padding: '12px', border: '1px solid #333', verticalAlign: 'top' }}>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                            <span style={{ marginTop: '2px' }}>•</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '15px', fontWeight: 600 }}>
                                {finding.original_text}
                              </div>
                            </div>
                          </div>
                        </td>
                        
                        {/* Notes Column */}
                        <td className="print-only-cell" style={{ padding: '12px', border: '1px solid #333' }}></td>
                        
                        {/* Result Column (Checkbox) */}
                        <td style={{ padding: '12px', border: '1px solid #333', verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', justifyContent: 'center' }}>
                            <div style={{ 
                              width: '20px', 
                              height: '20px', 
                              border: checkedItems.has(finding.id) ? '2px solid #10b981' : '2px solid #333',
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'center',
                              background: checkedItems.has(finding.id) ? '#10b981' : 'transparent',
                              WebkitPrintColorAdjust: 'exact',
                              printColorAdjust: 'exact'
                            }}>
                              {checkedItems.has(finding.id) && <CheckIcon style={{ width: '14px', height: '14px', color: '#fff' }} />}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
