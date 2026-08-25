'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function PrintReport() {
  const { id } = useParams()
  
  const [report, setReport] = useState(null)
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [id])

  async function fetchData() {
    try {
      // 1. Fetch Report & Hospital info
      const { data: reportData } = await supabase
        .from('reports')
        .select(`
          *,
          hospitals(name, governorate)
        `)
        .eq('id', id)
        .single()
      
      setReport(reportData)

      if (!reportData) return

      // 2. Fetch Findings linked to this report, grouped by department
      const { data: findingsData } = await supabase
        .from('findings')
        .select(`
          id,
          canonical_text,
          original_text,
          corrective_action,
          status,
          repeat_count,
          departments(id, name)
        `)
        .eq('report_id', id)

      if (findingsData) {
        // Group by department
        const deptsMap = {}
        findingsData.forEach(f => {
          const dept = f.departments
          if (!dept) return
          if (!deptsMap[dept.id]) {
            deptsMap[dept.id] = { id: dept.id, name: dept.name, findings: [] }
          }
          deptsMap[dept.id].findings.push(f)
        })
        setDepartments(Object.values(deptsMap))
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!loading && report) {
      setTimeout(() => {
        window.print()
      }, 500)
    }
  }, [loading, report])

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>جاري تجهيز التقرير...</div>
  if (!report) return <div style={{ padding: 40, textAlign: 'center' }}>التقرير غير موجود</div>

  return (
    <div className="print-document">
      {/* Document Header */}
      <div className="print-header">
        <div className="print-header-right">
          <p>جمهورية مصر العربية</p>
          <p>وزارة الصحة والسكان</p>
          <p>مديرية الشئون الصحية بـ {report.hospitals?.governorate || '......'}</p>
        </div>
        <div className="print-header-center">
          <img src="/logo.png" alt="Logo" style={{ height: 60, opacity: 0.8 }} onError={(e) => e.target.style.display = 'none'} />
        </div>
        <div className="print-header-left">
          <p>تاريخ المرور: {new Date(report.inspection_date).toLocaleDateString('ar-EG')}</p>
          <p>المرفقات: ....................</p>
        </div>
      </div>

      <div className="print-title">
        <h1>تقرير مرور (سلامة المرضى)</h1>
        <h2>{report.hospitals?.name}</h2>
      </div>

      {/* Document Body - Original Raw Text / File */}
      <div className="print-body">
        {report.file_url ? (
          <div style={{ textAlign: 'center' }}>
            {report.file_url.toLowerCase().endsWith('.pdf') ? (
              <iframe 
                src={report.file_url} 
                style={{ width: '100%', height: '1000px', border: 'none' }}
                title="ملف التقرير للطباعة"
              />
            ) : report.file_url.match(/\.(jpeg|jpg|gif|png)$/i) ? (
              <img 
                src={report.file_url} 
                alt="ملف التقرير للطباعة" 
                style={{ maxWidth: '100%' }} 
              />
            ) : (
              <p style={{ textAlign: 'center', marginTop: 40 }}>هذا الملف يتطلب التحميل للطباعة.</p>
            )}
          </div>
        ) : report.raw_text ? (
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.8', fontSize: '16px', fontFamily: 'Cairo, sans-serif' }}>
            {report.raw_text}
          </div>
        ) : (
          <p style={{ textAlign: 'center', marginTop: 40 }}>التقرير غير متوفر.</p>
        )}
      </div>

      {/* Signatures */}
      <div className="print-footer">
        <table className="signatures-table">
          <tbody>
            <tr>
              <td>
                <p>عضو فريق المرور</p>
                <p>الاسم: {report.inspector_name || '..........................'}</p>
                <p>التوقيع: ........................</p>
              </td>
              <td>
                <p>مدير المستشفى</p>
                <p>الاسم: ..........................</p>
                <p>التوقيع: ........................</p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
