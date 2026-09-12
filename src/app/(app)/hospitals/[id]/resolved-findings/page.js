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

const CheckIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
)

export default function ResolvedFindingsPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id

  const [loading, setLoading] = useState(true)
  const [hospital, setHospital] = useState(null)
  const [findings, setFindings] = useState([])
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
          .eq('status', 'resolved_confirmed')
          .order('resolved_date', { ascending: false })
      ])

      if (hospRes.data) setHospital(hospRes.data)
      if (deptsRes.data) setDepartments(deptsRes.data)
      if (findingsRes.data) setFindings(findingsRes.data)
    } catch (err) {
      console.error('Error fetching resolved findings:', err)
    } finally {
      setLoading(false)
    }
  }

  const deptMap = new Map(departments.map(d => [d.id, d.name]))

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
    <div className="resolved-findings-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <Link href={`/hospitals/${id}`} style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
            <span>←</span> العودة للمستشفى
          </Link>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--success-dark)' }}>
            السلبيات المحلولة <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 400 }}>({hospital.name})</span>
          </h1>
        </div>
        <div style={{ padding: '8px 16px', background: 'var(--success-light)', color: 'var(--success-dark)', borderRadius: '8px', fontWeight: 700 }}>
          إجمالي المحلول: {findings.length}
        </div>
      </div>

      {findings.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">✅</span>
          <div className="empty-state-title">لا توجد سلبيات محلولة</div>
          <p className="empty-state-desc">لم يتم اعتماد حل أي سلبيات في هذا المستشفى بعد</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {findings.map(finding => (
            <div key={finding.id} className="card" style={{ padding: '16px', borderRight: '4px solid var(--success)', display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--success-light)', color: 'var(--success-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <CheckIcon className="w-5 h-5" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: '4px' }}>
                  {deptMap.get(finding.department_id) || 'قسم غير معروف'}
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-main)', lineHeight: 1.5, marginBottom: '8px' }}>
                  {finding.original_text}
                </div>
                
                {finding.resolution_note && (
                  <div style={{ fontSize: 13, color: 'var(--success-dark)', background: 'var(--success-light)', padding: '8px 12px', borderRadius: '8px', marginBottom: '12px' }}>
                    <strong>إفادة الجودة (المديرية):</strong> {finding.resolution_note}
                  </div>
                )}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: 12, color: 'var(--text-secondary)' }}>
                  <span>تم الحل: <strong>{formatDate(finding.resolved_date)}</strong></span>
                  {finding.priority && PRIORITY_CONFIG[finding.priority] && (
                    <span className={`badge ${PRIORITY_CONFIG[finding.priority].class}`} style={{ padding: '2px 6px', fontSize: 11 }}>
                      {PRIORITY_CONFIG[finding.priority].label}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
