'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export default function CompletionRatePage() {
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
          .in('status', ['open', 'recurring', 'resolved_confirmed'])
          .order('status')
          .order('first_seen_date', { ascending: false })
      ])

      if (hospRes.data) setHospital(hospRes.data)
      if (deptsRes.data) setDepartments(deptsRes.data)
      if (findingsRes.data) setFindings(findingsRes.data)
    } catch (err) {
      console.error('Error fetching completion rate data:', err)
    } finally {
      setLoading(false)
    }
  }

  const deptMap = new Map(departments.map(d => [d.id, d.name]))

  const resolvedFindings = findings.filter(f => f.status === 'resolved_confirmed')
  const openFindings = findings.filter(f => ['open', 'recurring'].includes(f.status))
  
  const totalRelevant = resolvedFindings.length + openFindings.length
  const completionRate = totalRelevant > 0 ? Math.round((resolvedFindings.length / totalRelevant) * 100) : 0

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
    <div className="completion-rate-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <Link href={`/hospitals/${id}`} style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
            <span>←</span> العودة للمستشفى
          </Link>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--primary-dark)' }}>
            معدل الإنجاز <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 400 }}>({hospital.name})</span>
          </h1>
        </div>
      </div>

      {/* KPI Overview Card */}
      <div className="card" style={{ padding: '32px', textAlign: 'center', marginBottom: '32px', background: 'linear-gradient(135deg, var(--bg-card) 0%, rgba(30, 64, 175, 0.05) 100%)', border: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: 16, color: 'var(--text-secondary)', marginBottom: '16px', fontWeight: 600 }}>المعدل الحالي</h2>
        
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '24px', flexWrap: 'wrap', marginBottom: '24px' }}>
          <div style={{ background: 'var(--bg-primary)', padding: '16px 24px', borderRadius: '12px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--success-dark)' }}>{resolvedFindings.length}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>محلولة</div>
          </div>
          
          <div style={{ fontSize: 24, color: 'var(--text-muted)', fontWeight: 300 }}>÷</div>
          
          <div style={{ background: 'var(--bg-primary)', padding: '16px 24px', borderRadius: '12px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-main)' }}>{totalRelevant}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>إجمالي (مفتوحة + محلولة)</div>
          </div>
          
          <div style={{ fontSize: 24, color: 'var(--text-muted)', fontWeight: 300 }}>=</div>
          
          <div style={{ background: 'var(--primary)', color: 'white', padding: '16px 32px', borderRadius: '12px', boxShadow: 'var(--shadow-md)' }}>
            <div style={{ fontSize: 40, fontWeight: 800 }}>{completionRate}%</div>
            <div style={{ fontSize: 14, opacity: 0.9 }}>معدل الإنجاز</div>
          </div>
        </div>
        
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, maxWidth: '600px', marginLeft: 'auto', marginRight: 'auto' }}>
          يتم حساب معدل الإنجاز بناءً على نسبة السلبيات التي تم اعتماد حلها نهائياً مقسومة على إجمالي السلبيات (المفتوحة والمحلولة معاً). السلبيات التي تنتظر مراجعة المديرية لا تدخل في نسبة الإنجاز حتى يتم اعتمادها.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
        
        {/* Open Findings List */}
        <div className="card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--danger-dark)', marginBottom: '16px', display: 'flex', justifyContent: 'space-between' }}>
            <span>سلبيات تعيق الإنجاز (مفتوحة)</span>
            <span className="badge badge-danger">{openFindings.length}</span>
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {openFindings.slice(0, 10).map(f => (
              <div key={f.id} style={{ fontSize: 13, padding: '10px', background: 'var(--bg-primary)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: '4px' }}>{deptMap.get(f.department_id)}</div>
                <div style={{ color: 'var(--text-main)' }}>{f.original_text}</div>
              </div>
            ))}
            {openFindings.length > 10 && (
              <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', padding: '8px' }}>
                + {openFindings.length - 10} سلبيات أخرى
                <br/>
                <Link href={`/hospitals/${id}/open-findings`} style={{ color: 'var(--primary)' }}>عرض كل السلبيات المفتوحة</Link>
              </div>
            )}
            {openFindings.length === 0 && (
              <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)', padding: '20px' }}>لا توجد سلبيات مفتوحة!</div>
            )}
          </div>
        </div>

        {/* Resolved Findings List */}
        <div className="card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--success-dark)', marginBottom: '16px', display: 'flex', justifyContent: 'space-between' }}>
            <span>سلبيات تم إنجازها (محلولة)</span>
            <span className="badge badge-success">{resolvedFindings.length}</span>
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {resolvedFindings.slice(0, 10).map(f => (
              <div key={f.id} style={{ fontSize: 13, padding: '10px', background: 'var(--bg-primary)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: '4px' }}>{deptMap.get(f.department_id)}</div>
                <div style={{ color: 'var(--text-main)' }}>{f.original_text}</div>
              </div>
            ))}
            {resolvedFindings.length > 10 && (
              <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', padding: '8px' }}>
                + {resolvedFindings.length - 10} سلبيات أخرى
                <br/>
                <Link href={`/hospitals/${id}/resolved-findings`} style={{ color: 'var(--primary)' }}>عرض كل السلبيات المحلولة</Link>
              </div>
            )}
            {resolvedFindings.length === 0 && (
              <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)', padding: '20px' }}>لم يتم إنجاز أي سلبيات بعد.</div>
            )}
          </div>
        </div>

      </div>

    </div>
  )
}
