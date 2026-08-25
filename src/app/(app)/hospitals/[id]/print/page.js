'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function PrintReport() {
  const { id } = useParams()
  const router = useRouter()
  
  const [hospital, setHospital] = useState(null)
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [id])

  async function fetchData() {
    try {
      // 1. Fetch Hospital
      const { data: hosp } = await supabase
        .from('hospitals')
        .select('*')
        .eq('id', id)
        .single()
      
      setHospital(hosp)

      // 2. Fetch Departments with open/recurring findings
      const { data: depts } = await supabase
        .from('departments')
        .select(`
          id,
          name,
          findings (
            id,
            canonical_text,
            original_text,
            corrective_action,
            status,
            priority,
            repeat_count
          )
        `)
        .eq('hospital_id', id)

      if (depts) {
        // Filter out departments with no active findings
        const activeDepts = depts
          .map(d => ({
            ...d,
            findings: d.findings.filter(f => ['open', 'recurring'].includes(f.status))
          }))
          .filter(d => d.findings.length > 0)
          
        setDepartments(activeDepts)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!loading && hospital) {
      // Trigger print dialog automatically when loaded
      setTimeout(() => {
        window.print()
      }, 500)
    }
  }, [loading, hospital])

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>جاري تجهيز التقرير...</div>
  if (!hospital) return <div style={{ padding: 40, textAlign: 'center' }}>المستشفى غير موجود</div>

  return (
    <div className="print-document">
      {/* Document Header */}
      <div className="print-header">
        <div className="print-header-right">
          <p>جمهورية مصر العربية</p>
          <p>وزارة الصحة والسكان</p>
          <p>مديرية الشئون الصحية بـ {hospital.governorate || '......'}</p>
        </div>
        <div className="print-header-center">
          <img src="/logo.png" alt="Logo" style={{ height: 60, opacity: 0.8 }} onError={(e) => e.target.style.display = 'none'} />
        </div>
        <div className="print-header-left">
          <p>التاريخ: {new Date().toLocaleDateString('ar-EG')}</p>
          <p>المرفقات: ....................</p>
        </div>
      </div>

      <div className="print-title">
        <h1>تقرير مرور مبدئي (سلامة المرضى)</h1>
        <h2>{hospital.name}</h2>
      </div>

      {/* Document Body */}
      <div className="print-body">
        {departments.length === 0 ? (
          <p style={{ textAlign: 'center', marginTop: 40 }}>لا توجد سلبيات مفتوحة حالياً في هذه المنشأة.</p>
        ) : (
          departments.map((dept, deptIndex) => (
            <div key={dept.id} className="print-department-section">
              <h3 className="print-dept-title">
                {deptIndex + 1}- قسم {dept.name}:
              </h3>
              
              <ul className="print-findings-list">
                {dept.findings.map((finding, fIndex) => (
                  <li key={finding.id} className="print-finding-item">
                    <div className="finding-text">
                      <strong>السلبية: </strong> 
                      {finding.canonical_text || finding.original_text}
                      {finding.repeat_count > 1 && (
                        <span className="print-badge"> (مكررة ×{finding.repeat_count})</span>
                      )}
                    </div>
                    {finding.corrective_action && (
                      <div className="finding-action">
                        <strong>الإجراء التصحيحي المطلوب: </strong>
                        {finding.corrective_action}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      {/* Signatures */}
      <div className="print-footer">
        <table className="signatures-table">
          <tbody>
            <tr>
              <td>
                <p>عضو فريق المرور</p>
                <p>الاسم: ..........................</p>
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

      {/* Print Specific CSS injected only on this page */}
      <style dangerouslySetInnerHTML={{__html: `
        body, html {
          background: #fff !important;
          color: #000 !important;
          font-family: 'Times New Roman', Arial, sans-serif !important;
        }
        /* Hide app sidebars and navs on this route completely */
        .sidebar, .top-header, .no-print {
          display: none !important;
        }
        .main-content, .app-layout {
          margin: 0 !important;
          padding: 0 !important;
          background: #fff !important;
        }
        .page-content {
          margin: 0 !important;
          padding: 0 !important;
          max-width: 100% !important;
        }
        
        .print-document {
          padding: 2cm;
          max-width: 21cm; /* A4 width */
          margin: 0 auto;
          background: #fff;
          color: #000;
          direction: rtl;
          line-height: 1.8;
          font-size: 16px;
        }
        
        .print-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 2px solid #000;
          padding-bottom: 10px;
          margin-bottom: 30px;
          font-weight: bold;
          font-size: 14px;
        }
        
        .print-title {
          text-align: center;
          margin-bottom: 40px;
        }
        .print-title h1 {
          font-size: 24px;
          text-decoration: underline;
          margin-bottom: 10px;
        }
        .print-title h2 {
          font-size: 20px;
        }
        
        .print-department-section {
          margin-bottom: 30px;
          page-break-inside: avoid;
        }
        
        .print-dept-title {
          font-size: 18px;
          font-weight: bold;
          margin-bottom: 10px;
          text-decoration: underline;
        }
        
        .print-findings-list {
          list-style-type: none;
          padding-right: 20px;
        }
        
        .print-finding-item {
          margin-bottom: 15px;
          page-break-inside: avoid;
        }
        
        .finding-text {
          font-size: 16px;
        }
        
        .finding-action {
          margin-top: 4px;
          font-size: 15px;
        }
        
        .print-badge {
          font-weight: bold;
          text-decoration: underline;
        }
        
        .print-footer {
          margin-top: 50px;
          page-break-inside: avoid;
        }
        
        .signatures-table {
          width: 100%;
          text-align: center;
          font-weight: bold;
        }
        
        .signatures-table td {
          padding: 20px;
          width: 50%;
        }
        
        @media print {
          @page {
            margin: 0;
            size: A4;
          }
          .print-document {
            padding: 1.5cm;
            margin: 0;
          }
          body {
            background: #fff;
          }
        }
      `}} />
    </div>
  )
}
