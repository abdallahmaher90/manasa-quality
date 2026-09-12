'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { HomeIcon, HospitalIcon, ClipboardIcon, ArchiveIcon, ChartIcon, UploadIcon, UsersIcon, SettingsIcon, ExclamationCircleIcon } from '@/components/Icons'

export default function Dashboard() {
  const [stats, setStats] = useState({
    pendingConfirmation: 0,
    totalOpen: 0,
    totalRecurring: 0,
    totalReports: 0,
    totalHospitals: 0,
  })
  const [recurringByDept, setRecurringByDept] = useState([])
  const [expandedDept, setExpandedDept] = useState(null)
  
  const [topHospitals, setTopHospitals] = useState([])
  const [recentReports, setRecentReports] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDashboardData()
  }, [])

  const fetchDashboardData = async () => {
    try {
      // Fetch stats
      const { data: { session } } = await supabase.auth.getSession()

      // Fetch stats from DB and recurring endpoint in parallel
      const [dbResults, recurringApiRes] = await Promise.all([
        Promise.all([
          supabase.from('v_report_findings').select('id', { count: 'exact', head: true }).eq('status', 'resolved_by_hospital'),
          supabase.from('hospitals').select(`
            id, name, governorate,
            findings(count)
          `).order('name'),
          supabase.from('reports')
            .select('id, inspection_date, inspector_name, hospitals(name)')
            .order('inspection_date', { ascending: false })
            .limit(5),
          supabase.from('v_report_findings').select('id', { count: 'exact', head: true }).in('status', ['open', 'recurring']),
          supabase.from('reports').select('id', { count: 'exact', head: true }),
          supabase.from('hospitals').select('id', { count: 'exact', head: true })
        ]),
        fetch('/api/analytics/recurring', {
          headers: {
            'Authorization': session ? `Bearer ${session.access_token}` : ''
          }
        })
      ])

      const [pendingRes, hospitalsListRes, reportsRes, totalOpenRes, totalReportsRes, totalHospitalsRes] = dbResults
      
      let recurringData = { recurringInSameHospital: [] }
      if (recurringApiRes.ok) {
        const json = await recurringApiRes.json()
        if (json.success) recurringData = json.data
      }
      
      const recurringGroups = recurringData.recurringInSameHospital

      setStats({
        pendingConfirmation: pendingRes.count || 0,
        totalOpen: totalOpenRes.count || 0,
        totalRecurring: recurringGroups.length,
        totalReports: totalReportsRes.count || 0,
        totalHospitals: totalHospitalsRes.count || 0,
      })

      // Group recurring issues by department (flatten allDepartments from groups)
      const grouped = {}
      recurringGroups.forEach(group => {
        const depts = group.allDepartments && group.allDepartments.length > 0 
                      ? group.allDepartments 
                      : [{ name: 'أقسام أخرى' }]
        
        depts.forEach(dept => {
          const deptName = dept.name || 'أقسام أخرى'
          if (!grouped[deptName]) grouped[deptName] = []
          grouped[deptName].push(group)
        })
      })
      
      // Sort by number of recurring groups
      const sorted = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length)
      setRecurringByDept(sorted)

      // Process hospitals to get finding counts
      if (hospitalsListRes.data) {
        const processed = hospitalsListRes.data
          .map(h => ({
            ...h,
            findingCount: h.findings?.[0]?.count || 0,
          }))
          .sort((a, b) => b.findingCount - a.findingCount)
          .slice(0, 5)
        setTopHospitals(processed)
      }

      if (reportsRes.data) {
        setRecentReports(reportsRes.data)
      }
    } catch (err) {
      console.error('Error fetching dashboard data:', err)
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  if (loading) {
    return (
      <div className="loading-state">
        <div className="loading-spinner" />
        <span>جاري تحميل البيانات...</span>
      </div>
    )
  }

  return (
    <div>
      {/* Pending Confirmation Alert */}
      {stats.pendingConfirmation > 0 && (
        <div className="alert alert-warning mb-lg">
          <span>⚠️</span>
          <div>
            <strong>يوجد {stats.pendingConfirmation} سلبية</strong> أفاد فريق المستشفى بتلافيها وتحتاج تأكيداً من المديرية.
            <Link href="/hospitals" style={{ color: 'inherit', marginRight: 8, textDecoration: 'underline' }}>
              مراجعة الآن ←
            </Link>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
        <div className="card" style={{ padding: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <div style={{ width: 48, height: 48, borderRadius: 'var(--radius-md)', background: 'var(--danger-light)', color: 'var(--danger-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ClipboardIcon className="w-6 h-6" />
          </div>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>سلبيات نشطة</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-main)' }}>{stats.totalOpen}</div>
          </div>
        </div>
        <div className="card" style={{ padding: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <div style={{ width: 48, height: 48, borderRadius: 'var(--radius-md)', background: 'var(--warning-light)', color: 'var(--warning-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ExclamationCircleIcon className="w-6 h-6" />
          </div>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>سلبيات متكررة</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-main)' }}>{stats.totalRecurring}</div>
          </div>
        </div>
        <div className="card" style={{ padding: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <div style={{ width: 48, height: 48, borderRadius: 'var(--radius-md)', background: 'var(--primary-glow)', color: 'var(--primary-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ArchiveIcon className="w-6 h-6" />
          </div>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>إجمالي التقارير</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-main)' }}>{stats.totalReports}</div>
          </div>
        </div>
        <div className="card" style={{ padding: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <div style={{ width: 48, height: 48, borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <HospitalIcon className="w-6 h-6" />
          </div>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>المستشفيات المسجلة</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-main)' }}>{stats.totalHospitals}</div>
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid-responsive-2">

        {/* Top Hospitals */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">🏥 المستشفيات الأعلى في السلبيات</h2>
            <Link href="/hospitals" className="btn btn-ghost btn-sm">عرض الكل</Link>
          </div>
          {topHospitals.length === 0 ? (
            <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
              <span className="empty-state-icon" style={{ fontSize: 40 }}>🏥</span>
              <p className="empty-state-desc">لا توجد بيانات بعد. ابدأ برفع أول تقرير.</p>
            </div>
          ) : (
            <div className="mobile-table-card" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'right' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 8px' }}>الترتيب</th>
                    <th style={{ padding: '12px 8px' }}>المستشفى</th>
                    <th style={{ padding: '12px 8px', textAlign: 'center' }}>السلبيات المفتوحة</th>
                  </tr>
                </thead>
                <tbody>
                  {topHospitals.map((hospital, idx) => (
                    <tr key={hospital.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px 8px', fontWeight: 800, color: idx === 0 ? 'var(--danger)' : idx === 1 ? 'var(--warning-dark)' : 'var(--text-muted)' }}>
                        {idx + 1}
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        <Link href={`/hospitals/${hospital.id}`} style={{ fontWeight: 700, color: 'var(--primary-dark)', textDecoration: 'none' }}>
                          {hospital.name}
                        </Link>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>📍 {hospital.governorate}</div>
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 700, color: 'var(--danger)' }}>
                        {hospital.findingCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent Reports */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title"><ClipboardIcon className="w-5 h-5 inline-block ml-2" /> آخر تقارير المرور</h2>
            <Link href="/archive" className="btn btn-ghost btn-sm">الأرشيف</Link>
          </div>
          {recentReports.length === 0 ? (
            <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
              <span className="empty-state-icon" style={{ fontSize: 40 }}><ClipboardIcon className="w-10 h-10" /></span>
              <p className="empty-state-desc">لا توجد تقارير بعد.</p>
              <Link href="/upload" className="btn btn-primary btn-sm">
                <span><UploadIcon className="w-4 h-4 inline-block ml-1" /></span> رفع أول تقرير
              </Link>
            </div>
          ) : (
            <div className="mobile-table-card" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'right' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 8px' }}>التاريخ</th>
                    <th style={{ padding: '12px 8px' }}>المستشفى</th>
                    <th style={{ padding: '12px 8px' }}>القائم بالمرور</th>
                    <th style={{ padding: '12px 8px', textAlign: 'left' }}>إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {recentReports.map((report) => (
                    <tr key={report.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px 8px' }}>
                        <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                          {new Date(report.inspection_date).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </div>
                      </td>
                      <td style={{ padding: '12px 8px', fontWeight: 600, color: 'var(--text-main)' }}>
                        {report.hospitals?.name}
                      </td>
                      <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>
                        {report.inspector_name}
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'left' }}>
                        <Link href={`/archive/${report.id}`} className="btn btn-ghost btn-sm no-print" style={{ fontSize: 11, padding: '4px 8px' }}>
                          عرض
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card mt-md">
        <div className="card-header">
          <h2 className="card-title"><ExclamationCircleIcon className="w-5 h-5 inline-block ml-2" /> إجراءات سريعة</h2>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
          <Link href="/upload" className="btn btn-primary" id="quick-upload">
            <span><UploadIcon className="w-4 h-4 inline-block ml-1" /></span> رفع تقرير جديد
          </Link>
          <Link href="/hospitals" className="btn btn-accent" id="quick-hospitals">
            <span><HospitalIcon className="w-4 h-4 inline-block ml-1" /></span> عرض كل المستشفيات
          </Link>
          <Link href="/cross-report" className="btn btn-ghost" id="quick-cross">
            <span><ChartIcon className="w-4 h-4 inline-block ml-1" /></span> تقرير مقارن بالأقسام
          </Link>
          <Link href="/archive" className="btn btn-ghost" id="quick-archive">
            <span><ArchiveIcon className="w-4 h-4 inline-block ml-1" /></span> الأرشيف
          </Link>
        </div>
      </div>
    </div>
  )
}
