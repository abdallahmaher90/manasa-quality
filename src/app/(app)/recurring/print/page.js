'use client'
import { useEffect, useState, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getCategory } from '@/lib/utils'

function PrintContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialFilter = searchParams.get('filter') || 'active' // 'active' | 'all'

  const [filter, setFilter] = useState(initialFilter)
  const [crossHospitalRecurring, setCrossHospitalRecurring] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchFindings()
  }, [])

  const fetchFindings = async () => {
    try {
      setLoading(true)

      let allFindings = []
      let page = 0
      const pageSize = 1000

      while (true) {
        const { data, error } = await supabase
          .from('findings')
          .select(`
            id,
            canonical_text,
            original_text,
            status,
            repeat_count,
            last_seen_date,
            resolved_date,
            departments (name),
            hospitals (id, name, governorate)
          `)
          .range(page * pageSize, (page + 1) * pageSize - 1)

        if (error) throw error
        if (!data || data.length === 0) break
        allFindings = allFindings.concat(data)
        page++
        if (data.length < pageSize) break
      }

      if (allFindings.length > 0) {
        const groupedByCategory = {}

        allFindings.forEach((f) => {
          if (!f.hospitals || !f.departments) return
          const category = getCategory(f.departments.name)

          let textKey = (f.canonical_text || f.original_text || '').trim().replace(/^\[.*?\]\s*/, '')
          if (!textKey) return

          if (!groupedByCategory[category]) {
            groupedByCategory[category] = {}
          }

          if (!groupedByCategory[category][textKey]) {
            groupedByCategory[category][textKey] = {
              text: textKey,
              hospitalsMap: new Map(),
            }
          }

          const hospMap = groupedByCategory[category][textKey].hospitalsMap
          if (!hospMap.has(f.hospitals.id)) {
            hospMap.set(f.hospitals.id, {
              id: f.hospitals.id,
              name: f.hospitals.name,
              findings: [],
            })
          }

          hospMap.get(f.hospitals.id).findings.push(f)
        })

        const finalResults = []

        for (const [category, textGroups] of Object.entries(groupedByCategory)) {
          const crossFindings = []

          for (const [text, info] of Object.entries(textGroups)) {
            const hospitalEntries = Array.from(info.hospitalsMap.values())

            if (hospitalEntries.length >= 2) {
              let activeCount = 0
              let resolvedCount = 0

              const hospitalsList = hospitalEntries.map((h) => {
                const hasActive = h.findings.some((f) => ['open', 'recurring'].includes(f.status))
                const allResolved = h.findings.every((f) => f.status === 'resolved_confirmed')

                if (allResolved) {
                  resolvedCount++
                  return { ...h, status: 'resolved' }
                } else {
                  activeCount++
                  return { ...h, status: 'active' }
                }
              })

              crossFindings.push({
                text,
                category,
                totalHospitals: hospitalsList.length,
                activeCount,
                resolvedCount,
                isFullyResolved: activeCount === 0,
                hospitalsList,
              })
            }
          }

          if (crossFindings.length > 0) {
            crossFindings.sort((a, b) => b.activeCount - a.activeCount || b.totalHospitals - a.totalHospitals)
            finalResults.push({
              category,
              findings: crossFindings,
              totalActive: crossFindings.filter((f) => f.activeCount > 0).length,
            })
          }
        }

        finalResults.sort((a, b) => b.totalActive - a.totalActive)
        setCrossHospitalRecurring(finalResults)
      }
    } catch (err) {
      console.error('Error fetching findings for print:', err)
    } finally {
      setLoading(false)
    }
  }

  const filteredData = useMemo(() => {
    return crossHospitalRecurring
      .map((dept) => {
        const filteredFindings = dept.findings.filter((f) => {
          if (filter === 'active') return f.activeCount > 0
          return true
        })
        return {
          ...dept,
          findings: filteredFindings,
        }
      })
      .filter((dept) => dept.findings.length > 0)
  }, [crossHospitalRecurring, filter])

  const totalFilteredCount = useMemo(() => {
    return filteredData.reduce((acc, d) => acc + d.findings.length, 0)
  }, [filteredData])

  // Export to actual Microsoft Word (.doc)
  const exportToWord = () => {
    const documentElement = document.getElementById('printable-word-document')
    if (!documentElement) return

    const header = `<html xmlns:o='urn:schemas-microsoft-com:office:office' 
          xmlns:w='urn:schemas-microsoft-com:office:word' 
          xmlns='http://www.w3.org/TR/REC-html40'>
          <head>
            <meta charset='utf-8'>
            <title>تقرير السلبيات المتكررة والمشتركة</title>
            <style>
              body { font-family: 'Traditional Arabic', 'Simplified Arabic', 'Arial', sans-serif; direction: rtl; text-align: right; }
              table { width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 20px; }
              th, td { border: 1px solid #000; padding: 6px 10px; font-size: 13pt; vertical-align: top; }
              th { background-color: #f2f2f2; font-weight: bold; text-align: center; }
              h1 { font-size: 18pt; text-align: center; margin-bottom: 5px; }
              h2 { font-size: 15pt; text-align: center; margin-top: 0; }
              h3 { font-size: 14pt; margin-top: 15px; border-bottom: 1px solid #000; padding-bottom: 3px; }
              p { font-size: 13pt; line-height: 1.5; margin: 4px 0; }
              .header-table { border: none; margin-bottom: 25px; }
              .header-table td { border: none; padding: 2px; }
              .footer-table { border: none; margin-top: 40px; }
              .footer-table td { border: none; text-align: center; font-size: 13pt; }
            </style>
          </head>
          <body>`

    const footer = `</body></html>`
    const sourceHTML = header + documentElement.innerHTML + footer

    const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(sourceHTML)
    const fileDownload = document.createElement('a')
    document.body.appendChild(fileDownload)
    fileDownload.href = source
    fileDownload.download = `تقرير_السلبيات_المتكررة_${new Date().toISOString().split('T')[0]}.doc`
    fileDownload.click()
    document.body.removeChild(fileDownload)
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', fontFamily: 'Arial, sans-serif' }}>
        <div className="loading-spinner" style={{ margin: '0 auto 16px', width: 40, height: 40 }} />
        <h3 style={{ fontSize: 16, color: '#444' }}>جاري إعداد التقرير للطباعة والتصدير...</h3>
      </div>
    )
  }

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', padding: '20px 10px' }}>
      {/* Control Bar (Hidden during Print) */}
      <div
        className="no-print"
        style={{
          maxWidth: 950,
          margin: '0 auto 20px auto',
          background: '#ffffff',
          padding: '14px 20px',
          borderRadius: 8,
          border: '1px solid #e2e8f0',
          boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => router.back()}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              background: '#f8fafc',
              color: '#334155',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            ← العودة للمنصة
          </button>

          <div style={{ display: 'flex', gap: 6, background: '#f1f5f9', padding: 3, borderRadius: 6 }}>
            <button
              onClick={() => setFilter('active')}
              style={{
                padding: '4px 12px',
                borderRadius: 4,
                border: 'none',
                background: filter === 'active' ? '#dc2626' : 'transparent',
                color: filter === 'active' ? '#ffffff' : '#475569',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: 12,
              }}
            >
              السلبيات النشطة فقط
            </button>
            <button
              onClick={() => setFilter('all')}
              style={{
                padding: '4px 12px',
                borderRadius: 4,
                border: 'none',
                background: filter === 'all' ? '#2563eb' : 'transparent',
                color: filter === 'all' ? '#ffffff' : '#475569',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: 12,
              }}
            >
              كافة السلبيات (بما فيها المنجزة)
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={exportToWord}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: '1px solid #2563eb',
              background: '#eff6ff',
              color: '#1d4ed8',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            📥 تحميل بصيغة Word (.doc)
          </button>

          <button
            onClick={() => window.print()}
            style={{
              padding: '8px 20px',
              borderRadius: 6,
              border: 'none',
              background: '#0f172a',
              color: '#ffffff',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            }}
          >
            🖨️ طباعة الآن (Print)
          </button>
        </div>
      </div>

      {/* Printable Paper Document (A4 Word Document Format) */}
      <div
        id="printable-word-document"
        className="print-paper"
        style={{
          maxWidth: 900,
          margin: '0 auto',
          background: '#ffffff',
          padding: '40px 50px',
          boxShadow: '0 4px 15px rgba(0,0,0,0.08)',
          border: '1px solid #e2e8f0',
          color: '#000000',
          fontFamily: "'Traditional Arabic', 'Simplified Arabic', 'Arial', sans-serif",
          direction: 'rtl',
          textAlign: 'right',
          lineHeight: 1.6,
        }}
      >
        {/* Official Header Table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', border: 'none', marginBottom: 20 }}>
          <tbody>
            <tr>
              <td style={{ width: '38%', verticalAlign: 'top', border: 'none', padding: 0, fontSize: '12pt', fontWeight: 'bold' }}>
                <p style={{ margin: '2px 0' }}>جمهورية مصر العربية</p>
                <p style={{ margin: '2px 0' }}>وزارة الصحة والسكان</p>
                <p style={{ margin: '2px 0' }}>مديرية الشئون الصحية بكفر الشيخ</p>
                <p style={{ margin: '2px 0' }}>إدارة الجودة وسلامة المرضى</p>
              </td>

              <td style={{ width: '24%', textAlign: 'center', verticalAlign: 'top', border: 'none', padding: 0 }}>
                {/* Ministry / Directorate Logo placeholder */}
                <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: 1 }}>🏥</div>
                <div style={{ fontSize: '10pt', color: '#555', marginTop: 4 }}>منصة الجودة المركزية</div>
              </td>

              <td style={{ width: '38%', textAlign: 'left', verticalAlign: 'top', border: 'none', padding: 0, fontSize: '11pt' }}>
                <p style={{ margin: '2px 0' }}>التاريخ: {new Date().toLocaleDateString('ar-EG')}</p>
                <p style={{ margin: '2px 0' }}>رقم التقرير: تقرير مجمع رقم (٢٠٢٦/{new Date().getMonth() + 1})</p>
                <p style={{ margin: '2px 0' }}>درجة السرية: هام وعاجل</p>
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ borderBottom: '2px solid #000', marginBottom: 20 }} />

        {/* Title */}
        <div style={{ textAlign: 'center', marginBottom: 25 }}>
          <h1 style={{ fontSize: '18pt', fontWeight: 'bold', margin: '0 0 6px 0', textDecoration: 'underline' }}>
            تقرير حصر السلبيات المتكررة والمشتركة بين مستشفيات المحافظة
          </h1>
          <h2 style={{ fontSize: '13pt', fontWeight: 'normal', margin: 0, color: '#333' }}>
            {filter === 'active'
              ? `(حصر السلبيات النشطة الجاري متابعتها - إجمالي ${totalFilteredCount} ملاحظة مشتركة)`
              : `(الحصر الشامل للسلبيات وموقف التلافي - إجمالي ${totalFilteredCount} ملاحظة)`}
          </h2>
        </div>

        {/* Formal Opening Paragraph */}
        <div style={{ fontSize: '13pt', marginBottom: 20, textAlign: 'justify' }}>
          <p style={{ fontWeight: 'bold', margin: '0 0 8px 0' }}>
            السيد الأستاذ الدكتور / وكيل وزارة الصحة بكفر الشيخ
          </p>
          <p style={{ margin: '0 0 10px 0', textIndent: '20px' }}>
            تحية طيبة وبعد ،،،
          </p>
          <p style={{ margin: '0 0 15px 0', textIndent: '30px' }}>
            بناءً على نتائج أعمال لجان المرور الميداني المستمر على المستشفيات التابعة للمديرية للتحقق من تطبيق معايير الجودة وسلامة المرضى، نتشرف بأن نعرض على سيادتكم فيما يلي حصر وموقف السلبيات المتكررة التي تم رصدها في أكثر من منشأة صحية على مستوى المحافظة مصنفة بحسب الأقسام الطبية، وذلك لسرعة اتخاذ اللازم وتوجيه إدارات المستشفيات بتلافيها:
          </p>
        </div>

        {/* Department Sections & Formal Word Tables */}
        {filteredData.map((dept, deptIndex) => (
          <div key={dept.category} style={{ marginBottom: 30, pageBreakInside: 'avoid' }}>
            <div
              style={{
                fontSize: '14pt',
                fontWeight: 'bold',
                background: '#f1f5f9',
                border: '1px solid #cbd5e1',
                padding: '6px 12px',
                marginBottom: 10,
              }}
            >
              {deptIndex + 1}. قسم: {dept.category} ({dept.findings.length} سلبية مشتركة)
            </div>

            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                border: '1px solid #000000',
                fontSize: '11pt',
                marginBottom: 15,
              }}
            >
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={{ border: '1px solid #000', padding: '8px 6px', width: '5%', textAlign: 'center' }}>م</th>
                  <th style={{ border: '1px solid #000', padding: '8px 10px', width: '42%', textAlign: 'right' }}>
                    السلبية / الملاحظة المعيارية المرصودة
                  </th>
                  <th style={{ border: '1px solid #000', padding: '8px 10px', width: '33%', textAlign: 'right' }}>
                    المستشفيات التي تكررت بها
                  </th>
                  <th style={{ border: '1px solid #000', padding: '8px 6px', width: '20%', textAlign: 'center' }}>
                    الموقف الحالي
                  </th>
                </tr>
              </thead>
              <tbody>
                {dept.findings.map((f, fIdx) => (
                  <tr key={fIdx} style={{ pageBreakInside: 'avoid' }}>
                    <td style={{ border: '1px solid #000', padding: '6px', textAlign: 'center', fontWeight: 'bold' }}>
                      {fIdx + 1}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '6px 10px', lineHeight: 1.5 }}>
                      <strong>{f.text}</strong>
                    </td>
                    <td style={{ border: '1px solid #000', padding: '6px 10px', fontSize: '10.5pt' }}>
                      <ul style={{ margin: 0, paddingRight: 16 }}>
                        {f.hospitalsList.map((h, hIdx) => (
                          <li key={hIdx} style={{ marginBottom: 2 }}>
                            {h.name} {h.status === 'resolved' ? ' (تم التلافي ✅)' : ''}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td style={{ border: '1px solid #000', padding: '6px', textAlign: 'center', fontSize: '10pt' }}>
                      {f.isFullyResolved ? (
                        <span style={{ color: '#166534', fontWeight: 'bold' }}>تم التلافي بالكامل ✅</span>
                      ) : f.resolvedCount > 0 ? (
                        <div>
                          <div style={{ color: '#b91c1c', fontWeight: 'bold' }}>{f.activeCount} مستشفى لم تتلافَ</div>
                          <div style={{ color: '#15803d', fontSize: '9pt' }}>{f.resolvedCount} تم التلافي</div>
                        </div>
                      ) : (
                        <span style={{ color: '#b91c1c', fontWeight: 'bold' }}>قيد المتابعة ({f.activeCount} مستشفى)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {/* General Recommendations Section */}
        <div style={{ marginTop: 25, marginBottom: 30, pageBreakInside: 'avoid', fontSize: '12pt' }}>
          <p style={{ fontWeight: 'bold', textDecoration: 'underline', marginBottom: 6 }}>
            التوصيات العامة لإدارات المستشفيات:
          </p>
          <ol style={{ margin: 0, paddingRight: 20, lineHeight: 1.7 }}>
            <li>التشديد على مسؤولي الأقسام بسرعة تلافي الملاحظات النشطة الواردة بالتقرير وإفادة المديرية بما تم.</li>
            <li>إلزام الكوادر الطبية والتمريضية بالمعايير القياسية للتوثيق الطبي والتبليغ عن النتائج الحرجة.</li>
            <li>المراجعة الصباحية الدورية لجاهزية عربات الطوارئ (Crash Cart) وصلاحيات الأدوية وتطبيق شروط مكافحة العدوى.</li>
          </ol>
        </div>

        {/* Signatures Table (Official Word Format) */}
        <div style={{ marginTop: 40, pageBreakInside: 'avoid' }}>
          <table style={{ width: '100%', border: 'none', textAlign: 'center', fontSize: '12pt', fontWeight: 'bold' }}>
            <tbody>
              <tr>
                <td style={{ border: 'none', width: '33%', padding: '10px 0' }}>
                  <p style={{ margin: '0 0 35px 0' }}>عضو فريق المرور المركزي</p>
                  <p style={{ margin: 0 }}>..................................</p>
                </td>
                <td style={{ border: 'none', width: '33%', padding: '10px 0' }}>
                  <p style={{ margin: '0 0 35px 0' }}>مدير إدارة الجودة وسلامة المرضى</p>
                  <p style={{ margin: 0 }}>..................................</p>
                </td>
                <td style={{ border: 'none', width: '33%', padding: '10px 0' }}>
                  <p style={{ margin: '0 0 35px 0' }}>يعتمد،،، وكيل الوزارة</p>
                  <p style={{ margin: 0 }}>..................................</p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Global Print Stylesheet for true A4 Word look */}
      <style jsx global>{`
        @media print {
          body {
            background: #ffffff !important;
            color: #000000 !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .sidebar,
          .top-header,
          .header,
          .no-print,
          nav,
          button {
            display: none !important;
          }
          .print-paper {
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
            margin: 0 auto !important;
            width: 100% !important;
            max-width: 100% !important;
          }
          table {
            page-break-inside: auto;
          }
          tr {
            page-break-inside: avoid;
            page-break-after: auto;
          }
          thead {
            display: table-header-group;
          }
          @page {
            size: A4 portrait;
            margin: 15mm 15mm 15mm 15mm;
          }
        }
      `}</style>
    </div>
  )
}

export default function PrintRecurringReportPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}>جاري التحميل...</div>}>
      <PrintContent />
    </Suspense>
  )
}
