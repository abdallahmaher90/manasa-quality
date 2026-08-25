'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function RecurringPage() {
  const [crossHospitalRecurring, setCrossHospitalRecurring] = useState([])
  const [expandedDept, setExpandedDept] = useState(null)
  const [loading, setLoading] = useState(true)

  const getCategory = (name) => {
    if (!name) return 'أخرى'
    const n = name.toLowerCase()
    if (n.includes('صيدلي')) return 'الصيدلة'
    if (n.includes('كلى') || n.includes('غسيل كلو') || n.includes('كلي')) return 'الكلى'
    if (n.includes('عناي') || n.includes('رعاي')) return 'العناية المركزة'
    if (n.includes('معمل') || n.includes('بنك دم')) return 'المعامل'
    if (n.includes('اشع') || n.includes('أشع') || n.includes('إشع')) return 'الأشعة'
    if (n.includes('استقبال') || n.includes('طوارئ')) return 'الاستقبال والطوارئ'
    if (n.includes('عمليات') || n.includes('افاقه') || n.includes('إفاقه')) return 'العمليات'
    if (n.includes('حضانات') || n.includes('مبتسرين') || n.includes('مبتسر')) return 'الحضانات'
    if (n.includes('داخلي') || n.includes('اقامة') || n.includes('إقامة')) return 'القسم الداخلي'
    if (n.includes('عيادات') || n.includes('خارجيه')) return 'العيادات الخارجية'
    if (n.includes('اسنان') || n.includes('أسنان')) return 'الأسنان'
    if (n.includes('مخزن') || n.includes('مخازن') || n.includes('مستلزمات')) return 'المخازن'
    if (n.includes('تذاكر') || n.includes('دخول') || n.includes('تسجيل')) return 'التذاكر والدخول'
    if (n.includes('مطبخ') || n.includes('تغذيه') || n.includes('تغذية')) return 'التغذية والمطبخ'
    if (n.includes('مغسله') || n.includes('مغسلة') || n.includes('مفروشات')) return 'المغسلة'
    if (n.includes('نفايات') || n.includes('محرقه') || n.includes('محرقة')) return 'النفايات الطبية'
    if (n.includes('تعقيم')) return 'التعقيم'
    if (n.includes('علاج طبيعي')) return 'العلاج الطبيعي'
    return 'أخرى'
  }

  useEffect(() => {
    fetchCrossHospitalFindings()
  }, [])

  const fetchCrossHospitalFindings = async () => {
    try {
      // 1. Fetch all unresolved findings (open or recurring)
      const { data, error } = await supabase.from('findings')
        .select(`
          id,
          canonical_text,
          original_text,
          departments (name),
          hospitals (id, name)
        `)
        .in('status', ['open', 'recurring'])

      if (error) throw error

      if (data) {
        const groupedByCategory = {}

        data.forEach(f => {
          if (!f.hospitals || !f.departments) return
          const category = getCategory(f.departments.name)
          const textKey = (f.canonical_text || f.original_text).trim()

          if (!groupedByCategory[category]) {
            groupedByCategory[category] = {}
          }

          if (!groupedByCategory[category][textKey]) {
            groupedByCategory[category][textKey] = {
              text: textKey,
              hospitals: new Map() // Map to ensure unique hospitals
            }
          }

          // Add hospital to this finding
          groupedByCategory[category][textKey].hospitals.set(f.hospitals.id, f.hospitals.name)
        })

        // Filter and format the data
        const finalResults = []

        for (const [category, textGroups] of Object.entries(groupedByCategory)) {
          const crossFindings = []

          for (const [text, info] of Object.entries(textGroups)) {
            // ONLY keep findings that appear in MULTIPLE distinct hospitals
            if (info.hospitals.size > 1) {
              crossFindings.push({
                text,
                hospitalsList: Array.from(info.hospitals.values())
              })
            }
          }

          if (crossFindings.length > 0) {
            // Sort findings within category by how many hospitals they appear in (descending)
            crossFindings.sort((a, b) => b.hospitalsList.length - a.hospitalsList.length)
            finalResults.push({
              category,
              findings: crossFindings
            })
          }
        }

        // Sort categories by total cross-findings
        finalResults.sort((a, b) => b.findings.length - a.findings.length)

        setCrossHospitalRecurring(finalResults)
      }
    } catch (err) {
      console.error('Error fetching cross-hospital findings:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="loading-state">
        <div className="loading-spinner" />
        <span>جاري تجميع السلبيات المشتركة بين المستشفيات...</span>
      </div>
    )
  }

  return (
    <div>
      <div className="card" style={{ borderColor: 'var(--danger-light)' }}>
        <div className="card-header">
          <h2 className="card-title" style={{ color: 'var(--danger)', fontSize: 16 }}>
            🚨 السلبيات المنتشرة بين المستشفيات (مجمعة بالأقسام)
          </h2>
        </div>
        
        {crossHospitalRecurring.length === 0 ? (
          <div className="empty-state">
            ✅ لا توجد سلبيات مشتركة متكررة بين المستشفيات حالياً.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            <div className="alert alert-warning" style={{ marginBottom: '16px', fontSize: 13 }}>
              💡 <strong>تنبيه:</strong> هذه الصفحة تعرض فقط السلبيات التي تم رصدها في <strong>أكثر من مستشفى واحد</strong> لنفس القسم، لمساعدتك في تحديد المشاكل الشائعة على مستوى المحافظة.
            </div>

            {crossHospitalRecurring.map((dept) => (
              <div key={dept.category} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                <div 
                  style={{ 
                    padding: '12px 16px', 
                    background: 'var(--bg-secondary)', 
                    display: 'flex', 
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    cursor: 'pointer',
                    fontWeight: 700
                  }}
                  onClick={() => setExpandedDept(expandedDept === dept.category ? null : dept.category)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 15, color: 'var(--text-primary)' }}>🏥 {dept.category}</span>
                    <span style={{ fontSize: 12, background: '#fee2e2', color: '#b91c1c', padding: '2px 8px', borderRadius: 100, whiteSpace: 'nowrap' }}>
                      {dept.findings.length} سلبيات مشتركة
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 12, flexShrink: 0 }}>{expandedDept === dept.category ? '🔼' : '🔽'}</div>
                </div>
                
                {expandedDept === dept.category && (
                  <div style={{ padding: '12px', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {dept.findings.map((f, idx) => (
                      <div key={idx} style={{ borderRight: '3px solid var(--danger)', padding: '12px', display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg-card)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-main)', wordBreak: 'break-word' }}>
                          {f.text}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                          <strong style={{ color: 'var(--danger-dark)' }}>تكررت في {f.hospitalsList.length} مستشفيات:</strong>
                          {f.hospitalsList.map((h, i) => (
                            <span key={i} style={{ background: 'var(--bg-input)', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)' }}>
                              {h}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
