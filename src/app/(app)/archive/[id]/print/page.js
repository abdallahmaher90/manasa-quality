'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function PrintReportPage() {
  const { id } = useParams()
  const router = useRouter()
  
  const [report, setReport] = useState(null)
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchReportData()
  }, [id])

  async function fetchReportData() {
    try {
      // 1. Fetch the report
      const { data: reportData, error: reportErr } = await supabase
        .from('reports')
        .select('*, hospitals(name)')
        .eq('id', id)
        .single()
        
      if (reportErr) throw reportErr
      setReport(reportData)

      // 2. Fetch the findings for this report
      const { data: findingsData, error: findingsErr } = await supabase
        .from('findings')
        .select('*, departments(name)')
        .eq('last_report_id', id)
        
      if (findingsErr) throw findingsErr

      // 3. Group by department
      const grouped = {}
      findingsData.forEach(finding => {
        const deptName = finding.departments?.name || 'أخرى'
        if (!grouped[deptName]) {
          grouped[deptName] = { newFindings: [], recurringFindings: [] }
        }
        
        // If it's the first time we see it, it's new. Otherwise recurring.
        // Or if status is recurring / repeat_count > 1
        if (finding.repeat_count > 1 || finding.status === 'recurring') {
          grouped[deptName].recurringFindings.push(finding)
        } else {
          grouped[deptName].newFindings.push(finding)
        }
      })

      const formattedDepts = Object.entries(grouped).map(([name, data]) => ({
        name,
        ...data
      }))

      setDepartments(formattedDepts)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
      // Automatically trigger print shortly after loading
      setTimeout(() => {
        window.print()
      }, 500)
    }
  }

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '50px' }}>
      <div className="loading-spinner" />
      <div>تجهيز التقرير للطباعة...</div>
    </div>
  )

  if (!report) return <div className="empty-state">التقرير غير موجود</div>

  return (
    <div className="print-page-container">
      {/* Hide this action bar when printing */}
      <div className="no-print" style={{ marginBottom: 20, display: 'flex', gap: 10 }}>
        <button onClick={() => router.back()} className="btn btn-ghost">
          &larr; العودة
        </button>
        <button onClick={() => window.print()} className="btn btn-primary">
          🖨️ طباعة الآن
        </button>
      </div>

      <div className="print-document">
        {/* Header */}
        <div className="print-header">
          <div>
            <h1>تقرير مرور دوري</h1>
            <h2 style={{ marginTop: 5 }}>مستشفى {report.hospitals?.name}</h2>
          </div>
          <div className="print-meta">
            <p><strong>تاريخ المرور:</strong> {new Date(report.inspection_date).toLocaleDateString('ar-EG')}</p>
            <p><strong>القائم بالمرور:</strong> {report.inspector_name || 'غير محدد'}</p>
          </div>
        </div>

        <hr style={{ margin: '20px 0', border: 'none', borderBottom: '2px solid #000' }} />

        {/* Content */}
        {departments.length === 0 ? (
          <p style={{ textAlign: 'center', padding: 40 }}>لا توجد سلبيات مسجلة في هذا التقرير.</p>
        ) : (
          departments.map((dept, idx) => (
            <div key={idx} className="print-dept-section">
              <h3 className="print-dept-title">{dept.name}</h3>

              {dept.newFindings.length > 0 && (
                <div className="findings-group">
                  <h4 className="findings-group-title">السلبيات المستحدثة (أول مرة)</h4>
                  <table className="print-table">
                    <thead>
                      <tr>
                        <th style={{ width: '40px' }}>م</th>
                        <th>البيان / السلبية</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dept.newFindings.map((f, i) => (
                        <tr key={f.id}>
                          <td style={{ textAlign: 'center' }}>{i + 1}</td>
                          <td>{f.canonical_text || f.original_text}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {dept.recurringFindings.length > 0 && (
                <div className="findings-group">
                  <h4 className="findings-group-title" style={{ color: '#b45309' }}>السلبيات المتكررة (لم يتم تلافيها)</h4>
                  <table className="print-table">
                    <thead>
                      <tr>
                        <th style={{ width: '40px' }}>م</th>
                        <th>البيان / السلبية</th>
                        <th style={{ width: '100px', textAlign: 'center' }}>التكرار</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dept.recurringFindings.map((f, i) => (
                        <tr key={f.id}>
                          <td style={{ textAlign: 'center' }}>{i + 1}</td>
                          <td>
                            {f.canonical_text || f.original_text}
                            {f.first_seen_date && (
                              <div style={{ fontSize: '11px', color: '#666', marginTop: 4 }}>
                                أول ظهور: {f.first_seen_date}
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{f.repeat_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))
        )}

        {/* Signatures */}
        <div className="print-signatures">
          <div className="signature-box">
            <h4>{report.signatory_1_title || 'إمضاء'}</h4>
            <p>{report.signatory_1_name || '...................'}</p>
          </div>
          <div className="signature-box">
            <h4>{report.signatory_2_title || 'إمضاء'}</h4>
            <p>{report.signatory_2_name || '...................'}</p>
          </div>
        </div>
      </div>

      <style jsx global>{`
        .print-page-container {
          max-width: 900px;
          margin: 0 auto;
          background: #f4f7f9;
        }
        .print-document {
          background: white;
          padding: 40px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.05);
          color: #000;
        }
        .print-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
        }
        .print-header h1 {
          font-size: 24px;
          margin: 0;
        }
        .print-header h2 {
          font-size: 18px;
          font-weight: 600;
          margin: 0;
        }
        .print-meta p {
          margin: 4px 0;
          font-size: 14px;
        }
        .print-dept-section {
          margin-bottom: 30px;
        }
        .print-dept-title {
          background: #eee;
          padding: 8px 12px;
          border: 1px solid #ccc;
          margin-bottom: 15px;
          font-size: 16px;
        }
        .findings-group {
          margin-bottom: 20px;
        }
        .findings-group-title {
          font-size: 14px;
          margin-bottom: 8px;
        }
        .print-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 14px;
        }
        .print-table th, .print-table td {
          border: 1px solid #000;
          padding: 8px;
          text-align: right;
        }
        .print-table th {
          background: #f9f9f9;
          font-weight: bold;
        }
        .print-signatures {
          display: flex;
          justify-content: space-around;
          margin-top: 60px;
          padding-top: 40px;
        }
        .signature-box {
          text-align: center;
        }
        .signature-box h4 {
          margin-bottom: 40px;
          font-size: 14px;
        }

        @media print {
          body {
            background: white !important;
          }
          .app-layout > .sidebar, 
          .app-layout > .header, 
          .mobile-menu-btn,
          .no-print {
            display: none !important;
          }
          .app-layout > .main-content,
          .page-content {
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
          }
          .print-document {
            padding: 0 !important;
            box-shadow: none !important;
          }
        }
      `}</style>
    </div>
  )
}
