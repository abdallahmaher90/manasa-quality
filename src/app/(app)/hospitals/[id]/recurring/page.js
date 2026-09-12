'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export default function RecurringFindingsPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id // hospital ID

  const [loading, setLoading] = useState(true)
  const [hospital, setHospital] = useState(null)
  const [recurringGroups, setRecurringGroups] = useState([])
  const [departments, setDepartments] = useState([])

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
          .order('first_seen_date', { ascending: false })
      ])

      if (hospRes.data) setHospital(hospRes.data)
      if (deptsRes.data) setDepartments(deptsRes.data)

      if (findingsRes.data) {
        const deptMap = new Map((deptsRes.data || []).map(d => [d.id, d.name]))
        
        // Group by recurrence_group_id (or id if null)
        const groups = new Map()
        
        findingsRes.data.forEach(f => {
          const grpKey = f.recurrence_group_id || f.id
          
          if (!groups.has(grpKey)) {
            groups.set(grpKey, {
              id: grpKey,
              findings: [],
              eligibleCount: 0
            })
          }
          
          const g = groups.get(grpKey)
          g.findings.push(f)
          
          // Exclude pending_review from confirmed recurrence count
          const isPendingReview = f.review_status === 'pending_review'
          if (!isPendingReview) {
            g.eligibleCount++
          }
        })

        // Filter to only those with >= 2 eligible findings
        const validRecurring = Array.from(groups.values())
          .filter(g => g.eligibleCount >= 2)
          .map(g => {
            // Sort findings chronologically to find latest text and dates
            const sortedFindings = g.findings.sort((a, b) => new Date(b.first_seen_date) - new Date(a.first_seen_date))
            const latestFinding = sortedFindings[0]
            const firstFinding = sortedFindings[sortedFindings.length - 1]
            
            // Get unique departments
            const depts = [...new Set(sortedFindings.map(f => deptMap.get(f.department_id) || 'قسم غير معروف'))]
            
            return {
              id: g.id,
              count: g.eligibleCount,
              latestText: latestFinding.original_text,
              firstSeen: firstFinding.first_seen_date,
              lastSeen: latestFinding.first_seen_date,
              departments: depts,
              findings: sortedFindings // Keep all for details if needed
            }
          })
          .sort((a, b) => b.count - a.count) // Sort by count descending

        setRecurringGroups(validRecurring)
      }
    } catch (err) {
      console.error('Error fetching recurring findings:', err)
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (d) => {
    if (!d) return ''
    return new Date(d).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' })
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
    <div className="recurring-findings-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <Link href={`/hospitals/${id}`} style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
            <span>←</span> العودة للمستشفى
          </Link>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--warning-dark)' }}>
            السلبيات المكررة <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 400 }}>({hospital.name})</span>
          </h1>
        </div>
        <div style={{ padding: '8px 16px', background: 'var(--warning-light)', color: 'var(--warning-dark)', borderRadius: '8px', fontWeight: 700 }}>
          إجمالي المجموعات: {recurringGroups.length}
        </div>
      </div>

      {recurringGroups.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">✨</span>
          <div className="empty-state-title">لا توجد سلبيات مكررة</div>
          <p className="empty-state-desc">لم يتم رصد تكرار مستمر للسلبيات في هذا المستشفى</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {recurringGroups.map((group, index) => (
            <div key={group.id} className="card" style={{ padding: '20px', borderLeft: '4px solid var(--warning-dark)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
                
                <div style={{ flex: 1, minWidth: '300px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <span style={{ background: 'var(--bg-secondary)', padding: '2px 8px', borderRadius: '4px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
                      #{index + 1}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--warning-dark)', background: 'var(--warning-light)', padding: '2px 8px', borderRadius: '100px' }}>
                      🔁 تكررت {group.count} مرات
                    </span>
                  </div>
                  
                  <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-main)', margin: '0 0 12px 0', lineHeight: 1.5 }}>
                    {group.latestText}
                  </h3>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: 13 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)' }}>
                      <span>📅</span>
                      <span>أول ظهور: <strong>{formatDate(group.firstSeen)}</strong></span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--danger-dark)' }}>
                      <span>🚨</span>
                      <span>آخر ظهور: <strong>{formatDate(group.lastSeen)}</strong></span>
                    </div>
                  </div>
                </div>

                <div style={{ minWidth: '200px', background: 'var(--bg-secondary)', padding: '12px', borderRadius: '8px' }}>
                  <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', margin: '0 0 8px 0', textTransform: 'uppercase' }}>
                    ظهرت في الأقسام ({group.departments.length})
                  </h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {group.departments.map((dName, i) => (
                      <span key={i} style={{ fontSize: 11, background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: '100px', color: 'var(--text-main)' }}>
                        {dName}
                      </span>
                    ))}
                  </div>
                </div>
                
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
