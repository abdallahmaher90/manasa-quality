'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function CrossReportPage() {
  const [departments, setDepartments] = useState([])
  const [selectedDept, setSelectedDept] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [deptNames, setDeptNames] = useState([]) // These are now Categories
  const [statusFilter, setStatusFilter] = useState('active')
  const [printMode, setPrintMode] = useState(false)

  const getCategory = (name) => {
    if (!name) return 'أخرى'
    const n = name.toLowerCase()
    if (n.includes('صيدل')) return 'الصيدلة'
    if (n.includes('كلى') || n.includes('كلي') || n.includes('كلو')) return 'الكلى'
    if (n.includes('عناي') || n.includes('رعاي')) return 'العناية المركزة'
    if (n.includes('معمل') || n.includes('معامل') || n.includes('دم')) return 'المعامل'
    if (n.includes('اشع') || n.includes('أشع') || n.includes('إشع')) return 'الأشعة'
    if (n.includes('استقبال') || n.includes('طوار')) return 'الاستقبال والطوارئ'
    if (n.includes('عمليات') || n.includes('افاق') || n.includes('إفاق')) return 'العمليات'
    if (n.includes('حضان') || n.includes('مبتسر')) return 'الحضانات'
    if (n.includes('داخلي') || n.includes('اقام') || n.includes('إقام')) return 'القسم الداخلي'
    if (n.includes('عياد') || n.includes('خارجي')) return 'العيادات الخارجية'
    if (n.includes('اسنان') || n.includes('أسنان')) return 'الأسنان'
    if (n.includes('مخزن') || n.includes('مخازن') || n.includes('مستلزم')) return 'المخازن'
    if (n.includes('تذاكر') || n.includes('دخول') || n.includes('تسجيل')) return 'التذاكر والدخول'
    if (n.includes('مطبخ') || n.includes('تغذي')) return 'التغذية والمطبخ'
    if (n.includes('مغسل') || n.includes('مفروش')) return 'المغسلة'
    if (n.includes('نفاي') || n.includes('محرق')) return 'النفايات الطبية'
    if (n.includes('تعقيم')) return 'التعقيم'
    if (n.includes('طبيع')) return 'العلاج الطبيعي'
    return 'أخرى'
  }

  useEffect(() => {
    fetchDeptNames()
  }, [])

  const fetchDeptNames = async () => {
    // Get unique department names across all hospitals and categorize them
    const { data } = await supabase
      .from('departments')
      .select('name')
    if (data) {
      const categories = [...new Set(data.map(d => getCategory(d.name)))].sort()
      // ensure 'أخرى' is at the end
      const sortedCategories = categories.filter(c => c !== 'أخرى').concat(categories.includes('أخرى') ? ['أخرى'] : [])
      setDeptNames(sortedCategories)
    }
  }

  const handleSearch = async () => {
    if (!selectedDept) return
    setLoading(true)

    // 1. Find all department names that map to the selected category
    const { data: allDepts } = await supabase.from('departments').select('name')
    const matchingNames = allDepts
      ? [...new Set(allDepts.map(d => d.name).filter(name => getCategory(name) === selectedDept))]
      : []

    if (matchingNames.length === 0) {
      setResults([])
      setLoading(false)
      return
    }

    // 2. Fetch data for those specific names
    const { data: depts } = await supabase
      .from('departments')
      .select(`
        id, name,
        hospitals(id, name, governorate),
        findings!findings_department_id_fkey(
          id, canonical_text, original_text, status, repeat_count,
          priority, corrective_action, responsible, deadline,
          first_seen_date, last_seen_date, resolved_date
        )
      `)
      .in('name', matchingNames)

    if (depts) {
      // Group by hospital
      const deptsWithFindings = depts.map(d => {
        const filtered = d.findings?.filter(f => {
          if (statusFilter === 'active') return ['open', 'recurring'].includes(f.status)
          if (statusFilter === 'resolved') return f.status === 'resolved_confirmed'
          return true
        }) || []

        // Sort findings: recurring first, then by repeat count
        const sorted = [...filtered].sort((a, b) => {
          if (a.status === 'recurring' && b.status !== 'recurring') return -1
          if (b.status === 'recurring' && a.status !== 'recurring') return 1
          return b.repeat_count - a.repeat_count
        })

        return { ...d, filteredFindings: sorted }
      }).filter(d => d.filteredFindings.length > 0)

      const hospitalGroups = {}
      deptsWithFindings.forEach(d => {
        const hId = d.hospitals?.id
        if (!hId) return
        if (!hospitalGroups[hId]) {
          hospitalGroups[hId] = {
            hospital: d.hospitals,
            departments: [],
            totalFindingsCount: 0
          }
        }
        hospitalGroups[hId].departments.push(d)
        hospitalGroups[hId].totalFindingsCount += d.filteredFindings.length
      })

      const processed = Object.values(hospitalGroups).sort((a, b) => b.totalFindingsCount - a.totalFindingsCount)

      setResults(processed)
    }
    setLoading(false)
  }

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' }) : '-'

  const totalFindings = results.reduce((acc, r) => acc + (r.totalFindingsCount || 0), 0)
  const totalRecurring = results.reduce((acc, r) => {
    return acc + (r.departments ? r.departments.reduce((dAcc, d) => dAcc + (d.filteredFindings || []).filter(f => f.status === 'recurring').length, 0) : 0)
  }, 0)

  // Calculate frequencies of findings across hospitals to identify cross-hospital repeated findings
  const findingTextFrequencies = {}
  if (results.length > 0) {
    results.forEach(r => {
      if (!r.departments) return // Safe-guard against old state during hot-reload
      // Use a Set to only count a finding once per hospital, even if repeated within the same hospital
      const allTextsInHospital = r.departments.flatMap(d => d.filteredFindings.map(f => (f.canonical_text || f.original_text).trim()))
      const uniqueTextsInHospital = new Set(allTextsInHospital)
      uniqueTextsInHospital.forEach(text => {
        findingTextFrequencies[text] = (findingTextFrequencies[text] || 0) + 1
      })
    })
  }

  return (
    <div>
      <div className="card mb-lg">
        <div className="card-header">
          <h2 className="card-title">📊 تقرير مقارن - قسم عبر كل المستشفيات</h2>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 'var(--space-lg)' }}>
          اختر اسم القسم لتظهر لك جميع سلبيات هذا القسم في كل المستشفيات في تقرير موحد
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
            <label className="form-label">اسم القسم</label>
            <select
              id="dept-name-select"
              className="form-select"
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
            >
              <option value="">-- اختر القسم --</option>
              {deptNames.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ minWidth: 150, marginBottom: 0 }}>
            <label className="form-label">الحالة</label>
            <select
              id="status-filter-select"
              className="form-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="active">النشطة والمتكررة</option>
              <option value="resolved">المحلولة</option>
              <option value="all">الكل</option>
            </select>
          </div>
          <button
            id="cross-report-search"
            className="btn btn-primary"
            onClick={handleSearch}
            disabled={!selectedDept || loading}
          >
            {loading ? <><div className="loading-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> جاري...</> : <><span>🔍</span> عرض التقرير</>}
          </button>
          {results.length > 0 && (
            <div className="flex gap-sm no-print">
              <button
                id="print-cross-report"
                className="btn btn-ghost"
                onClick={() => window.print()}
              >
                🖨️ طباعة
              </button>
              <button
                id="export-word-report"
                className="btn btn-primary"
                onClick={() => {
                  const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>Report</title><style>body { direction: rtl; font-family: Arial, sans-serif; }</style></head><body>";
                  const footer = "</body></html>";
                  const sourceHTML = header + document.getElementById("report-content").innerHTML + footer;
                  const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(sourceHTML);
                  const fileDownload = document.createElement("a");
                  document.body.appendChild(fileDownload);
                  fileDownload.href = source;
                  fileDownload.download = `تقرير_قسم_${selectedDept}.doc`;
                  fileDownload.click();
                  document.body.removeChild(fileDownload);
                }}
              >
                📄 تنزيل كملف Word
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Results Document View */}
      {results.length > 0 && (
        <div 
          id="report-content" 
          style={{ 
            background: 'white', 
            color: 'black', 
            padding: '40px', 
            borderRadius: '4px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            maxWidth: '800px',
            margin: '0 auto',
            fontFamily: 'Arial, sans-serif'
          }}
        >
          <h2 style={{ textAlign: 'center', marginBottom: '30px', fontSize: 24, fontWeight: 'bold' }}>
            تقرير سلبيات قسم {selectedDept}
          </h2>

          {results.map(r => (
            <div key={r.hospital.id} style={{ marginBottom: '30px' }}>
              <h3 style={{ fontSize: 18, fontWeight: 'bold', textDecoration: 'underline', marginBottom: '15px' }}>
                {r.hospital.name}
              </h3>
              
              {r.departments.map((dept, deptIdx) => (
                <div key={dept.id} style={{ marginBottom: '15px' }}>
                  <h4 style={{ fontSize: 16, fontWeight: 'bold', marginBottom: '10px' }}>
                    {deptIdx + 1}- {dept.name}:
                  </h4>
                  <ol style={{ paddingRight: '20px', margin: 0, listStylePosition: 'outside' }}>
                    {dept.filteredFindings.map((f) => {
                      const text = (f.canonical_text || f.original_text).trim()
                      const isCrossHospitalCommon = findingTextFrequencies[text] > 1
                      const isHospitalRecurring = f.status === 'recurring' || f.repeat_count > 1
                      
                      let fontWeight = 'normal'
                      let color = 'inherit'
                      
                      if (isHospitalRecurring) {
                        fontWeight = 'bold'
                        color = 'red'
                      } else if (isCrossHospitalCommon) {
                        fontWeight = 'bold'
                      }

                      return (
                        <li key={f.id} style={{ marginBottom: '8px', fontSize: 16, lineHeight: '1.5', fontWeight, color }}>
                          {text}
                        </li>
                      )
                    })}
                  </ol>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {results.length === 0 && selectedDept && !loading && (
        <div className="empty-state">
          <span className="empty-state-icon">✅</span>
          <div className="empty-state-title">لا توجد سلبيات بهذا الفلتر</div>
          <p className="empty-state-desc">جرب تغيير فلتر الحالة</p>
        </div>
      )}
    </div>
  )
}
