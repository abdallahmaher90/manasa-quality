'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

export default function ViewArchiveReport() {
  const { id } = useParams()
  const router = useRouter()
  
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchReport()
  }, [id])

  async function fetchReport() {
    try {
      const { data, error } = await supabase
        .from('reports')
        .select('*, hospitals(name)')
        .eq('id', id)
        .single()
        
      if (error) throw error
      setReport(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div className="loading-state"><div className="loading-spinner" /><span>تحميل التقرير...</span></div>
  if (!report) return <div className="empty-state">التقرير غير موجود</div>

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', paddingBottom: 'var(--space-2xl)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xl)' }}>
        <div>
          <button onClick={() => router.back()} className="btn btn-ghost" style={{ marginBottom: 'var(--space-sm)' }}>
            &larr; العودة للأرشيف
          </button>
          <h1 style={{ fontSize: 24, fontWeight: 800 }}>التقرير الأصلي</h1>
          <p style={{ color: 'var(--text-muted)' }}>مستشفى {report.hospitals?.name} - {new Date(report.inspection_date).toLocaleDateString('ar-EG')}</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
          {report.file_url && (
            <a href={report.file_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
              ⬇️ تحميل الملف
            </a>
          )}
          <Link href={`/archive/${id}/print`} className="btn btn-primary">
            🖨️ طباعة التقرير
          </Link>
        </div>
      </div>

      {report.file_url && (
        <div className="card" style={{ marginBottom: 'var(--space-xl)' }}>
          <h2 className="card-title" style={{ marginBottom: 'var(--space-md)' }}>الملف المرفوع</h2>
          <div style={{
            background: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: 400
          }}>
            {report.file_url.toLowerCase().endsWith('.pdf') ? (
              <iframe 
                src={report.file_url} 
                style={{ width: '100%', height: '80vh', border: 'none' }}
                title="ملف التقرير"
              />
            ) : report.file_url.match(/\.(jpeg|jpg|gif|png)$/i) ? (
              <img 
                src={report.file_url} 
                alt="ملف التقرير" 
                style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }} 
              />
            ) : (
              <div style={{ padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--text-muted)' }}>
                <p style={{ marginBottom: 'var(--space-md)' }}>هذا النوع من الملفات لا يمكن عرضه مباشرة هنا.</p>
                <a href={report.file_url} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                  ⬇️ تحميل الملف لعرضه
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="card-title" style={{ marginBottom: 'var(--space-md)' }}>النص الأصلي (كما تم رفعه)</h2>
        <div style={{
          background: 'var(--bg-primary)',
          padding: 'var(--space-lg)',
          borderRadius: 'var(--radius-md)',
          whiteSpace: 'pre-wrap',
          lineHeight: '1.8',
          fontSize: '15px',
          fontFamily: 'Cairo, sans-serif'
        }}>
          {report.raw_text || 'لا يوجد نص أصلي محفوظ لهذا التقرير.'}
        </div>
      </div>
    </div>
  )
}
