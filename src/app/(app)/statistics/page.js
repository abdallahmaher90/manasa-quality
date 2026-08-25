'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line
} from 'recharts'

export default function StatisticsPage() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    totalReports: 0,
    totalFindings: 0,
    openFindings: 0,
    recurringFindings: 0,
    hospitalsData: [],
    statusData: []
  })

  useEffect(() => {
    fetchStats()
  }, [])

  async function fetchStats() {
    try {
      // Fetch all reports to count them
      const { count: reportsCount } = await supabase
        .from('reports')
        .select('*', { count: 'exact', head: true })

      // Fetch all findings for analysis
      const { data: findings } = await supabase
        .from('findings')
        .select(`
          id, status, repeat_count,
          hospitals (name)
        `)

      if (!findings) throw new Error('لا توجد بيانات')

      // Basic stats
      let totalFindings = findings.length
      let openCount = 0
      let recurringCount = 0
      
      const hospitalCounts = {}

      findings.forEach(f => {
        if (f.status === 'open') openCount++
        if (f.status === 'recurring') recurringCount++

        // Count by hospital
        const hName = f.hospitals?.name || 'غير محدد'
        if (!hospitalCounts[hName]) {
          hospitalCounts[hName] = { name: hName, open: 0, recurring: 0, resolved: 0 }
        }
        if (f.status === 'open') hospitalCounts[hName].open++
        else if (f.status === 'recurring') hospitalCounts[hName].recurring++
        else hospitalCounts[hName].resolved++
      })

      const hospitalsData = Object.values(hospitalCounts)
        .sort((a, b) => (b.open + b.recurring) - (a.open + a.recurring))
        .slice(0, 10) // Top 10

      const statusData = [
        { name: 'جديدة', value: openCount, color: '#4caf50' },
        { name: 'متكررة', value: recurringCount, color: '#ff9800' },
        { name: 'تم التلافي', value: totalFindings - openCount - recurringCount, color: '#2196f3' }
      ].filter(d => d.value > 0)

      setStats({
        totalReports: reportsCount || 0,
        totalFindings,
        openFindings: openCount,
        recurringFindings: recurringCount,
        hospitalsData,
        statusData
      })
    } catch (error) {
      console.error('Error fetching stats:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="loading-state">
        <div className="spinner"></div>
        <p>جاري تحميل الإحصائيات...</p>
      </div>
    )
  }

  return (
    <div className="page-container fade-in">
      <div className="page-header">
        <div className="header-title">
          <h1>الإحصائيات والتحليلات 📊</h1>
          <p>نظرة شاملة على أداء المستشفيات وحالة السلبيات المرصودة</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '30px' }}>
        
        <div className="stat-card glass-card" style={{ padding: '20px', borderRadius: '15px', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '10px' }}>📄</div>
          <h3 style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>إجمالي التقارير</h3>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--text)' }}>{stats.totalReports}</div>
        </div>

        <div className="stat-card glass-card" style={{ padding: '20px', borderRadius: '15px', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '10px' }}>🔍</div>
          <h3 style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>إجمالي السلبيات</h3>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--text)' }}>{stats.totalFindings}</div>
        </div>

        <div className="stat-card glass-card" style={{ padding: '20px', borderRadius: '15px', textAlign: 'center', borderBottom: '4px solid #4caf50' }}>
          <div style={{ fontSize: '3rem', marginBottom: '10px' }}>⚠️</div>
          <h3 style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>سلبيات جديدة (مفتوحة)</h3>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#4caf50' }}>{stats.openFindings}</div>
        </div>

        <div className="stat-card glass-card" style={{ padding: '20px', borderRadius: '15px', textAlign: 'center', borderBottom: '4px solid #ff9800' }}>
          <div style={{ fontSize: '3rem', marginBottom: '10px' }}>🔄</div>
          <h3 style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>سلبيات متكررة</h3>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#ff9800' }}>{stats.recurringFindings}</div>
        </div>

      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px' }}>
        
        {/* Bar Chart: Hospitals */}
        <div className="glass-card" style={{ padding: '20px', borderRadius: '15px' }}>
          <h3 style={{ marginBottom: '20px', color: 'var(--text)', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
            أكثر المستشفيات تسجيلاً للسلبيات (النشطة)
          </h3>
          <div style={{ width: '100%', height: 350 }} dir="ltr">
            <ResponsiveContainer>
              <BarChart data={stats.hospitalsData} margin={{ top: 20, right: 30, left: 20, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis 
                  dataKey="name" 
                  angle={-45} 
                  textAnchor="end" 
                  height={80} 
                  tick={{ fill: 'var(--text-muted)' }} 
                />
                <YAxis tick={{ fill: 'var(--text-muted)' }} />
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--text)' }}
                  itemStyle={{ color: 'var(--text)' }}
                />
                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                <Bar dataKey="open" name="جديدة" stackId="a" fill="#4caf50" radius={[0, 0, 4, 4]} />
                <Bar dataKey="recurring" name="متكررة" stackId="a" fill="#ff9800" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Pie Chart: Status Breakdown */}
        <div className="glass-card" style={{ padding: '20px', borderRadius: '15px' }}>
          <h3 style={{ marginBottom: '20px', color: 'var(--text)', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
            توزيع حالة السلبيات
          </h3>
          <div style={{ width: '100%', height: 350 }} dir="ltr">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={stats.statusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={80}
                  outerRadius={120}
                  paddingAngle={5}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {stats.statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--text)' }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </div>
  )
}
