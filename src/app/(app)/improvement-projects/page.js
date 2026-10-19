'use client'

import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { 
  SparklesIcon, 
  HospitalIcon, 
  ClipboardIcon, 
  CheckIcon, 
  XMarkIcon, 
  ArrowPathIcon,
  ExclamationCircleIcon,
  ChartIcon
} from '@/components/Icons'

export default function ImprovementProjectsPage() {
  const searchParams = useSearchParams()
  const initialHospitalId = searchParams.get('hospitalId') || ''

  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState(null)
  const [hospitals, setHospitals] = useState([])
  const [projects, setProjects] = useState([])
  const [selectedHospitalId, setSelectedHospitalId] = useState(initialHospitalId)
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState('cards') // 'cards' | 'table'

  // Modals state
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false)
  const [generateHospitalId, setGenerateHospitalId] = useState(initialHospitalId)
  const [generateCount, setGenerateCount] = useState(3)
  const [generateFocusDept, setGenerateFocusDept] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generateError, setGenerateError] = useState('')

  // View / Charter Modal state
  const [selectedProject, setSelectedProject] = useState(null)
  const [isCharterModalOpen, setIsCharterModalOpen] = useState(false)
  const [statusUpdating, setStatusUpdating] = useState(false)

  // Manual Project Modal state
  const [isManualModalOpen, setIsManualModalOpen] = useState(false)
  const [manualForm, setManualForm] = useState({
    hospital_id: '',
    title: '',
    department_name: '',
    category: 'سلامة المرضى',
    priority: 'high',
    problem_statement: '',
    baseline_metrics: '',
    smart_goal: '',
    evidence_reference: 'معايير الهيئة العامة للاعتماد والرقابة الصحية (GAHAR)',
    target_completion_date: '',
    project_lead: '',
    directorate_notes: ''
  })

  // 1. Check Auth and Fetch Data
  useEffect(() => {
    initPage()
  }, [])

  const initPage = async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      const role = profile?.role
      setUserRole(role)

      if (!['directorate_admin', 'directorate_member'].includes(role)) {
        setLoading(false)
        return
      }

      // Fetch hospitals
      const { data: hospData } = await supabase
        .from('hospitals')
        .select('id, name, code')
        .order('name')
      setHospitals(hospData || [])

      if (initialHospitalId) {
        setGenerateHospitalId(initialHospitalId)
      } else if (hospData && hospData.length > 0) {
        setGenerateHospitalId(hospData[0].id)
      }

      // Fetch projects
      await fetchProjects(initialHospitalId)
    } catch (err) {
      console.error('Error initializing improvement projects page:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchProjects = async (hId = selectedHospitalId) => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      let url = '/api/improvement-projects'
      const params = new URLSearchParams()
      if (hId) params.append('hospitalId', hId)
      if (statusFilter !== 'all') params.append('status', statusFilter)
      if (priorityFilter !== 'all') params.append('priority', priorityFilter)
      
      const queryString = params.toString()
      if (queryString) url += `?${queryString}`

      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const data = await res.json()
      if (data.success) {
        setProjects(data.projects || [])
      }
    } catch (err) {
      console.error('Error fetching projects:', err)
    }
  }

  // Handle hospital filter change
  const handleHospitalFilterChange = (hId) => {
    setSelectedHospitalId(hId)
    fetchProjects(hId)
  }

  // 2. Handle AI Generation
  const handleGenerate = async (e) => {
    e.preventDefault()
    if (!generateHospitalId) {
      setGenerateError('يرجى اختيار المستشفى أولاً')
      return
    }

    setIsGenerating(true)
    setGenerateError('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const res = await fetch('/api/improvement-projects/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          hospitalId: generateHospitalId,
          focusDepartment: generateFocusDept.trim() || null,
          count: generateCount
        })
      })

      const result = await res.json()
      if (!res.ok || !result.success) {
        throw new Error(result.error || 'فشل في توليد مشاريع التحسين')
      }

      setIsGenerateModalOpen(false)
      setSelectedHospitalId(generateHospitalId)
      await fetchProjects(generateHospitalId)
    } catch (err) {
      console.error('Generation error:', err)
      setGenerateError(err.message)
    } finally {
      setIsGenerating(false)
    }
  }

  // 3. Update Project Status
  const handleUpdateStatus = async (projectId, newStatus) => {
    setStatusUpdating(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const res = await fetch(`/api/improvement-projects/${projectId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      })

      const result = await res.json()
      if (result.success) {
        setProjects(prev => prev.map(p => p.id === projectId ? { ...p, status: newStatus } : p))
        if (selectedProject?.id === projectId) {
          setSelectedProject(prev => ({ ...prev, status: newStatus }))
        }
      }
    } catch (err) {
      console.error('Error updating project status:', err)
    } finally {
      setStatusUpdating(false)
    }
  }

  // 4. Delete Project
  const handleDeleteProject = async (projectId) => {
    if (!confirm('هل أنت متأكد من رغبتك في حذف مشروع التحسين هذا؟')) return

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const res = await fetch(`/api/improvement-projects/${projectId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const result = await res.json()
      if (result.success) {
        setProjects(prev => prev.filter(p => p.id !== projectId))
        if (selectedProject?.id === projectId) {
          setIsCharterModalOpen(false)
        }
      }
    } catch (err) {
      console.error('Error deleting project:', err)
    }
  }

  // 5. Handle Manual Project Submit
  const handleManualSubmit = async (e) => {
    e.preventDefault()
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const selectedHosp = hospitals.find(h => h.id === manualForm.hospital_id)
      const res = await fetch('/api/improvement-projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          ...manualForm,
          hospital_name: selectedHosp?.name || 'مستشفى'
        })
      })

      const result = await res.json()
      if (result.success) {
        setIsManualModalOpen(false)
        await fetchProjects(manualForm.hospital_id || selectedHospitalId)
      }
    } catch (err) {
      console.error('Error creating manual project:', err)
    }
  }

  // Status counts for filter tabs
  const statusCounts = useMemo(() => {
    const counts = {
      all: projects.length,
      draft: 0,
      approved: 0,
      in_progress: 0,
      completed: 0,
      suspended: 0
    }
    projects.forEach(p => {
      if (counts[p.status] !== undefined) counts[p.status]++
    })
    return counts
  }, [projects])

  // Computed & Filtered Projects
  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (priorityFilter !== 'all' && p.priority !== priorityFilter) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchTitle = (p.title || '').toLowerCase().includes(q)
        const matchDept = (p.department_name || '').toLowerCase().includes(q)
        const matchHosp = (p.hospital_name || '').toLowerCase().includes(q)
        const matchProblem = (p.problem_statement || '').toLowerCase().includes(q)
        if (!matchTitle && !matchDept && !matchHosp && !matchProblem) return false
      }
      return true
    })
  }, [projects, statusFilter, priorityFilter, searchQuery])

  // Stats calculation
  const stats = useMemo(() => {
    const total = projects.length
    const inProgress = projects.filter(p => ['approved', 'in_progress'].includes(p.status)).length
    const completed = projects.filter(p => p.status === 'completed').length
    const high = projects.filter(p => p.priority === 'high').length
    return { total, inProgress, completed, high }
  }, [projects])

  // Status Labels and Badges
  const getStatusBadge = (status) => {
    switch (status) {
      case 'completed':
        return <span className="badge badge-success" style={{ fontWeight: 800, padding: '4px 10px' }}>✅ مكتمل ومحقق للمستهدف</span>
      case 'in_progress':
        return <span className="badge badge-primary" style={{ fontWeight: 800, padding: '4px 10px' }}>⏳ قيد التنفيذ بالمستشفى</span>
      case 'approved':
        return <span className="badge" style={{ background: '#ede9fe', color: '#6d28d9', fontWeight: 800, padding: '4px 10px', border: '1px solid #ddd6fe' }}>📋 معتمد من المديرية</span>
      case 'suspended':
        return <span className="badge badge-neutral" style={{ fontWeight: 700, padding: '4px 10px' }}>معلق</span>
      default:
        return <span className="badge badge-warning" style={{ fontWeight: 800, padding: '4px 10px' }}>💡 مقترح بالذكاء الاصطناعي</span>
    }
  }

  const getPriorityBadge = (priority) => {
    switch (priority) {
      case 'high':
        return <span className="badge badge-danger" style={{ fontSize: 11, fontWeight: 800 }}>⚡ أولوية قصوى</span>
      case 'medium':
        return <span className="badge badge-warning" style={{ fontSize: 11, fontWeight: 700 }}>أولوية متوسطة</span>
      default:
        return <span className="badge badge-neutral" style={{ fontSize: 11 }}>أولوية عادية</span>
    }
  }

  const handlePrintCharter = () => {
    window.print()
  }

  if (loading) {
    return (
      <div className="loading-state">
        <div className="loading-spinner" />
        <span>جاري تحميل مشاريع التحسين ومؤشرات الأداء...</span>
      </div>
    )
  }

  // Directorate Access Guard
  if (!['directorate_admin', 'directorate_member'].includes(userRole)) {
    return (
      <div className="card" style={{ maxWidth: 540, margin: '60px auto', padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>
          قسم مخصص لأعضاء المديرية فقط
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
          قسم مشاريع التحسين ومقترحات الأداء متاح حصرياً لأعضاء فريق إدارة الجودة بالمديرية لمراجعة واعتماد مشاريع المستشفيات.
        </p>
        <Link href="/dashboard" className="btn btn-primary" style={{ padding: '8px 24px' }}>
          العودة للرئيسية
        </Link>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', paddingBottom: 40 }}>
      
      {/* 1. Header Executive Banner */}
      <div className="qip-header-banner" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ maxWidth: 750 }}>
            <div className="qip-badge-header">
              <SparklesIcon style={{ width: 15, height: 15, color: '#fde047' }} />
              منظومة مشاريع التحسين المستمر (QIPs) • خاص بأعضاء المديرية
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 8px 0', lineHeight: 1.3 }}>
              مشاريع التحسين المبنية على الأداء والدليل العلمي
            </h1>
            <p style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.92)', margin: 0, lineHeight: 1.6 }}>
              فحص وتحليل شامل لتقارير المرور والسلبيات المتكررة ومؤشرات الأداء لكل مستشفى، وتوليد مقترحات مشاريع تحسين سريرية وتشغيلية تتبع منهجية FOCUS-PDCA ومعايير GAHAR الوطنية.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              onClick={() => {
                setGenerateHospitalId(selectedHospitalId || hospitals[0]?.id || '')
                setIsGenerateModalOpen(true)
              }}
              className="btn btn-warning"
              style={{ fontWeight: 800, padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}
            >
              <SparklesIcon style={{ width: 17, height: 17 }} />
              توليد مشاريع بالذكاء الاصطناعي
            </button>
            <button
              onClick={() => {
                setManualForm(prev => ({ ...prev, hospital_id: selectedHospitalId || hospitals[0]?.id || '' }))
                setIsManualModalOpen(true)
              }}
              className="btn btn-outline"
              style={{ color: '#ffffff', borderColor: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.12)', padding: '10px 16px', fontSize: 13 }}
            >
              ➕ مشروع جديد (يدوي)
            </button>
          </div>
        </div>
      </div>

      {/* 2. Platform Standard KPI Stat Cards */}
      <div className="stats-grid" style={{ marginBottom: 0 }}>
        <div className="stat-card primary">
          <div className="stat-icon">💡</div>
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">إجمالي مشاريع التحسين</div>
        </div>
        <div className="stat-card warning">
          <div className="stat-icon">⏳</div>
          <div className="stat-value">{stats.inProgress}</div>
          <div className="stat-label">معتمدة / قيد التنفيذ بالمستشفيات</div>
        </div>
        <div className="stat-card success">
          <div className="stat-icon">✅</div>
          <div className="stat-value">{stats.completed}</div>
          <div className="stat-label">مكتملة ومحققة للمستهدف</div>
        </div>
        <div className="stat-card danger">
          <div className="stat-icon">⚡</div>
          <div className="stat-value">{stats.high}</div>
          <div className="stat-label">مشاريع أولوية قصوى</div>
        </div>
      </div>

      {/* 3. Controls & Filters Toolbar */}
      <div className="card" style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        
        {/* Top Filter Controls Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, alignItems: 'flex-end' }}>
          
          {/* Hospital Selector */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>
              المستشفى المستهدف:
            </label>
            <select
              value={selectedHospitalId}
              onChange={(e) => handleHospitalFilterChange(e.target.value)}
              className="form-select"
              style={{ padding: '8px 12px', fontSize: 13 }}
            >
              <option value="">كافة المستشفيات ({hospitals.length})</option>
              {hospitals.map(h => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </div>

          {/* Priority Filter */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>
              مستوى الأولوية:
            </label>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="form-select"
              style={{ padding: '8px 12px', fontSize: 13 }}
            >
              <option value="all">كافة الأولويات</option>
              <option value="high">أولوية قصوى (High)</option>
              <option value="medium">أولوية متوسطة (Medium)</option>
              <option value="low">أولوية عادية (Standard)</option>
            </select>
          </div>

          {/* Search Box */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>
              بحث سريع:
            </label>
            <input
              type="text"
              placeholder="ابحث بالعنوان، القسم، أو المشكلة..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="form-input"
              style={{ padding: '8px 12px', fontSize: 13 }}
            />
          </div>

          {/* View Mode Toggle */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ display: 'inline-flex', background: 'var(--bg-primary)', padding: 3, borderRadius: 8, border: '1px solid var(--border)' }}>
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                style={{
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 700,
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: viewMode === 'cards' ? 'var(--primary)' : 'transparent',
                  color: viewMode === 'cards' ? '#ffffff' : 'var(--text-secondary)',
                  transition: 'all 0.15s ease'
                }}
              >
                🗂️ بطاقات
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                style={{
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 700,
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: viewMode === 'table' ? 'var(--primary)' : 'transparent',
                  color: viewMode === 'table' ? '#ffffff' : 'var(--text-secondary)',
                  transition: 'all 0.15s ease'
                }}
              >
                📊 جدول
              </button>
            </div>
          </div>
        </div>

        {/* Status Filter Tabs / Pills */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => setStatusFilter('all')}
            className={`btn btn-sm ${statusFilter === 'all' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ borderRadius: 20, fontSize: 12, fontWeight: 700 }}
          >
            كافة المشاريع ({statusCounts.all})
          </button>
          <button
            onClick={() => setStatusFilter('draft')}
            className={`btn btn-sm ${statusFilter === 'draft' ? 'btn-warning' : 'btn-ghost'}`}
            style={{ borderRadius: 20, fontSize: 12, fontWeight: 700 }}
          >
            💡 مقترحات ذكاء اصطناعي ({statusCounts.draft})
          </button>
          <button
            onClick={() => setStatusFilter('approved')}
            className={`btn btn-sm ${statusFilter === 'approved' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ borderRadius: 20, fontSize: 12, fontWeight: 700 }}
          >
            📋 معتمدة من المديرية ({statusCounts.approved})
          </button>
          <button
            onClick={() => setStatusFilter('in_progress')}
            className={`btn btn-sm ${statusFilter === 'in_progress' ? 'btn-accent' : 'btn-ghost'}`}
            style={{ borderRadius: 20, fontSize: 12, fontWeight: 700 }}
          >
            ⏳ قيد التنفيذ ({statusCounts.in_progress})
          </button>
          <button
            onClick={() => setStatusFilter('completed')}
            className={`btn btn-sm ${statusFilter === 'completed' ? 'btn-success' : 'btn-ghost'}`}
            style={{ borderRadius: 20, fontSize: 12, fontWeight: 700 }}
          >
            ✅ مكتملة ومحققة ({statusCounts.completed})
          </button>
          {statusCounts.suspended > 0 && (
            <button
              onClick={() => setStatusFilter('suspended')}
              className={`btn btn-sm ${statusFilter === 'suspended' ? 'btn-ghost' : 'btn-ghost'}`}
              style={{ borderRadius: 20, fontSize: 12, fontWeight: 700 }}
            >
              معلقة ({statusCounts.suspended})
            </button>
          )}
        </div>

        {selectedHospitalId && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
            <span>
              عرض مشاريع: <strong>{hospitals.find(h => h.id === selectedHospitalId)?.name}</strong> ({filteredProjects.length} مشروع مطابقة)
            </span>
            <button
              onClick={() => handleHospitalFilterChange('')}
              className="btn btn-ghost btn-sm"
              style={{ padding: '2px 8px', fontSize: 12, color: 'var(--primary)', fontWeight: 700 }}
            >
              عرض كافة المستشفيات
            </button>
          </div>
        )}
      </div>

      {/* 4. Projects Content (Cards Mode or Table Mode) */}
      {filteredProjects.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: 'center', border: '1px dashed var(--border)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✨</div>
          <h3 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>
            لا توجد مشاريع تحسين مطابقة للمحددات
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, maxWidth: 500, margin: '0 auto 20px auto', lineHeight: 1.6 }}>
            {selectedHospitalId 
              ? 'لم يتم إنشاء أو توليد مشاريع تحسين لهذا المستشفى بعد. اضغط على الزر أدناه لتوليد مشاريع بالذكاء الاصطناعي استناداً لتقارير المرور والسلبيات المرصودة.' 
              : 'قم باختيار مستشفى واضغط على توليد مشاريع بالذكاء الاصطناعي لفحص السلبيات واقتراح خطط التحسين.'}
          </p>
          <button
            onClick={() => {
              setGenerateHospitalId(selectedHospitalId || hospitals[0]?.id || '')
              setIsGenerateModalOpen(true)
            }}
            className="btn btn-primary"
            style={{ padding: '8px 20px', fontWeight: 700, margin: '0 auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            <SparklesIcon style={{ width: 16, height: 16 }} />
            توليد مقترحات مشاريع لهذا المستشفى
          </button>
        </div>
      ) : viewMode === 'cards' ? (
        <div className="qip-grid">
          {filteredProjects.map((project) => (
            <div key={project.id} className="qip-card">
              
              {/* Card Body */}
              <div className="qip-card-body">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className="badge" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <HospitalIcon style={{ width: 13, height: 13 }} />
                      {project.hospital_name}
                    </span>
                    {project.department_name && (
                      <span className="badge badge-neutral" style={{ fontSize: 11 }}>
                        {project.department_name}
                      </span>
                    )}
                  </div>
                  {getPriorityBadge(project.priority)}
                </div>

                {/* Title */}
                <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: 0, lineHeight: 1.4 }}>
                  {project.title}
                </h3>

                {/* Status Badge */}
                <div>
                  {getStatusBadge(project.status)}
                </div>

                {/* SMART Goal Snippet */}
                {project.smart_goal && (
                  <div style={{ background: 'var(--bg-primary)', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }}>
                    <div style={{ fontWeight: 800, color: 'var(--primary-dark)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                      🎯 الهدف الذكي (SMART Goal):
                    </div>
                    <div style={{ color: 'var(--text-primary)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {project.smart_goal}
                    </div>
                  </div>
                )}

                {/* Evidence & Findings Counter */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8, borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)' }}>
                  {project.evidence_reference && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                      <span style={{ fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>المرجع:</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.evidence_reference}</span>
                    </div>
                  )}

                  {project.linked_findings_summary && project.linked_findings_summary.length > 0 && (
                    <div style={{ fontWeight: 700, color: 'var(--primary)' }}>
                      📋 يعالج <strong>{project.linked_findings_summary.length}</strong> سلبيات مرصودة من تقارير المرور
                    </div>
                  )}
                </div>
              </div>

              {/* Card Footer Actions */}
              <div className="qip-card-footer">
                <button
                  onClick={() => {
                    setSelectedProject(project)
                    setIsCharterModalOpen(true)
                  }}
                  className="btn btn-outline btn-sm"
                  style={{ fontSize: 12, fontWeight: 800, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <ClipboardIcon style={{ width: 14, height: 14 }} />
                  عرض الميثاق
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {project.status === 'draft' && (
                    <button
                      onClick={() => handleUpdateStatus(project.id, 'approved')}
                      title="اعتماد المشروع من المديرية"
                      className="btn btn-primary btn-sm"
                      style={{ padding: '5px 10px', fontSize: 11, fontWeight: 700 }}
                    >
                      اعتماد
                    </button>
                  )}
                  {project.status === 'approved' && (
                    <button
                      onClick={() => handleUpdateStatus(project.id, 'in_progress')}
                      title="بدء تنفيذ المشروع بالمستشفى"
                      className="btn btn-accent btn-sm"
                      style={{ padding: '5px 10px', fontSize: 11, fontWeight: 700 }}
                    >
                      بدء التنفيذ
                    </button>
                  )}
                  {project.status === 'in_progress' && (
                    <button
                      onClick={() => handleUpdateStatus(project.id, 'completed')}
                      title="تحديد كمكتمل ومحقق للمستهدف"
                      className="btn btn-success btn-sm"
                      style={{ padding: '5px 10px', fontSize: 11, fontWeight: 700 }}
                    >
                      إتمام
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteProject(project.id)}
                    title="حذف المشروع"
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '5px 8px', color: 'var(--danger)' }}
                  >
                    <XMarkIcon style={{ width: 14, height: 14 }} />
                  </button>
                </div>
              </div>

            </div>
          ))}
        </div>
      ) : (
        /* Table View */
        <div className="table-wrapper card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>المستشفى</th>
                <th>القسم المعني</th>
                <th>عنوان المشروع والهدف الذكي</th>
                <th>الأولوية</th>
                <th>الحالة</th>
                <th>مؤشرات الأداء</th>
                <th style={{ textAlign: 'center' }}>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((project) => (
                <tr key={project.id}>
                  <td style={{ fontWeight: 700 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <HospitalIcon style={{ width: 14, height: 14, color: 'var(--primary)' }} />
                      <span>{project.hospital_name}</span>
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-neutral" style={{ fontSize: 11 }}>
                      {project.department_name || 'عام'}
                    </span>
                  </td>
                  <td style={{ maxWidth: 320 }}>
                    <div style={{ fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
                      {project.title}
                    </div>
                    {project.smart_goal && (
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        🎯 {project.smart_goal}
                      </div>
                    )}
                  </td>
                  <td>
                    {getPriorityBadge(project.priority)}
                  </td>
                  <td>
                    {getStatusBadge(project.status)}
                  </td>
                  <td style={{ fontSize: 11.5 }}>
                    {Array.isArray(project.kpis) && project.kpis.length > 0 ? (
                      <div>
                        <strong>{project.kpis.length}</strong> مؤشرات قياس
                        <div style={{ color: 'var(--text-muted)' }}>
                          {project.kpis[0]?.name?.slice(0, 25)}...
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>-</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <button
                        onClick={() => {
                          setSelectedProject(project)
                          setIsCharterModalOpen(true)
                        }}
                        className="btn btn-outline btn-sm"
                        style={{ padding: '4px 10px', fontSize: 11 }}
                      >
                        الميثاق
                      </button>
                      {project.status === 'draft' && (
                        <button
                          onClick={() => handleUpdateStatus(project.id, 'approved')}
                          className="btn btn-primary btn-sm"
                          style={{ padding: '4px 8px', fontSize: 11 }}
                        >
                          اعتماد
                        </button>
                      )}
                      {project.status === 'approved' && (
                        <button
                          onClick={() => handleUpdateStatus(project.id, 'in_progress')}
                          className="btn btn-accent btn-sm"
                          style={{ padding: '4px 8px', fontSize: 11 }}
                        >
                          بدء
                        </button>
                      )}
                      {project.status === 'in_progress' && (
                        <button
                          onClick={() => handleUpdateStatus(project.id, 'completed')}
                          className="btn btn-success btn-sm"
                          style={{ padding: '4px 8px', fontSize: 11 }}
                        >
                          إتمام
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteProject(project.id)}
                        className="btn btn-ghost btn-sm"
                        style={{ padding: '4px 6px', color: 'var(--danger)' }}
                      >
                        <XMarkIcon style={{ width: 14, height: 14 }} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 5. AI Generation Modal */}
      {isGenerateModalOpen && (
        <div 
          className="qip-charter-modal no-print"
          onClick={() => !isGenerating && setIsGenerateModalOpen(false)}
        >
          <div 
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              maxWidth: 540,
              width: '100%',
              padding: 24,
              boxShadow: 'var(--shadow-lg)',
              display: 'flex',
              flexDirection: 'column',
              gap: 16
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="badge badge-warning" style={{ fontWeight: 800, marginBottom: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <SparklesIcon style={{ width: 14, height: 14 }} />
                  تحليل استراتيجي بالذكاء الاصطناعي
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  توليد مشاريع تحسين جودة للمستشفى
                </h3>
              </div>
              <button 
                onClick={() => !isGenerating && setIsGenerateModalOpen(false)}
                className="btn btn-ghost btn-sm"
                style={{ padding: '4px 8px' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
              سيقوم المحرك الذكي بفحص كافة تقارير المرور والسلبيات المرصودة لهذا المستشفى، وتحليل تركز السلبيات المتكررة وضعف الامتثال، وصياغة مقترحات مشاريع تحسين متوافقة مع معايير GAHAR الوطنية.
            </p>

            {generateError && (
              <div className="alert alert-danger" style={{ padding: '8px 12px', fontSize: 12 }}>
                ⚠️ {generateError}
              </div>
            )}

            <form onSubmit={handleGenerate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                  اختر المستشفى المراد تحليله: *
                </label>
                <select
                  disabled={isGenerating}
                  value={generateHospitalId}
                  onChange={(e) => setGenerateHospitalId(e.target.value)}
                  className="form-select"
                  style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
                  required
                >
                  <option value="">-- اختر مستشفى --</option>
                  {hospitals.map(h => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                  التركيز على قسم معين (اختياري):
                </label>
                <input
                  type="text"
                  disabled={isGenerating}
                  placeholder="مثال: الصيدلية، المعمل، الطوارئ، العمليات... (أو اتركه فارغاً لشامل المستشفى)"
                  value={generateFocusDept}
                  onChange={(e) => setGenerateFocusDept(e.target.value)}
                  className="form-input"
                  style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                  عدد المشاريع المقترحة:
                </label>
                <select
                  disabled={isGenerating}
                  value={generateCount}
                  onChange={(e) => setGenerateCount(Number(e.target.value))}
                  className="form-select"
                  style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
                >
                  <option value={2}>2 مشاريع تحسين أساسية</option>
                  <option value={3}>3 مشاريع تحسين متوازنة (موصى به)</option>
                  <option value={4}>4 مشاريع شاملة</option>
                  <option value={5}>5 مشاريع تفصيلية للأقسام الرئيسية</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <button
                  type="button"
                  disabled={isGenerating}
                  onClick={() => setIsGenerateModalOpen(false)}
                  className="btn btn-ghost"
                  style={{ padding: '8px 16px' }}
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isGenerating || !generateHospitalId}
                  className="btn btn-primary"
                  style={{ padding: '8px 20px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  {isGenerating ? (
                    <>
                      <div className="loading-spinner" style={{ width: 14, height: 14 }} />
                      جاري فحص تقارير المرور والتحليل...
                    </>
                  ) : (
                    <>
                      <SparklesIcon style={{ width: 16, height: 16 }} />
                      بدء التحليل والتوليد
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. Project Full Charter Modal (Official Executive Quality View) */}
      {isCharterModalOpen && selectedProject && (
        <div 
          className="qip-charter-modal"
          onClick={() => setIsCharterModalOpen(false)}
        >
          <div 
            className="qip-charter-content"
            onClick={(e) => e.stopPropagation()}
          >
            
            {/* Header actions (Hidden on print) */}
            <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  onClick={handlePrintCharter}
                  className="btn btn-secondary btn-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
                >
                  🖨️ طباعة ميثاق المشروع
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 }}>الحالة:</span>
                  <select
                    disabled={statusUpdating}
                    value={selectedProject.status}
                    onChange={(e) => handleUpdateStatus(selectedProject.id, e.target.value)}
                    className="form-select"
                    style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', width: 'auto' }}
                  >
                    <option value="draft">مسودة مقترحة</option>
                    <option value="approved">معتمد من المديرية</option>
                    <option value="in_progress">قيد التنفيذ بالمستشفى</option>
                    <option value="completed">مكتمل ومحقق للمستهدف</option>
                    <option value="suspended">معلق</option>
                  </select>
                </div>
              </div>
              <button 
                onClick={() => setIsCharterModalOpen(false)}
                className="btn btn-ghost btn-sm"
                style={{ padding: '4px 10px', fontSize: 14 }}
              >
                ✕ إغلاق
              </button>
            </div>

            {/* Official Project Charter Document */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, color: 'var(--text-primary)', lineHeight: 1.6 }}>
              
              {/* Official Header */}
              <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--primary)', letterSpacing: 0.5 }}>
                    مديرية الشئون الصحية بكفر الشيخ • إدارة الجودة وتوكيد الأداء
                  </div>
                  <h2 style={{ fontSize: 22, fontWeight: 900, color: '#0f172a', margin: '6px 0 2px 0' }}>
                    ميثاق مشروع تحسين جودة الرعاية الصحية (QIP)
                  </h2>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)' }}>
                    Quality Improvement Project Charter
                  </div>
                </div>

                <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, fontSize: 12, minWidth: 220 }}>
                  <div><strong>المستشفى:</strong> {selectedProject.hospital_name}</div>
                  <div><strong>القسم المعني:</strong> {selectedProject.department_name || 'عام'}</div>
                  <div><strong>تاريخ الاعتماد:</strong> {new Date(selectedProject.created_at).toLocaleDateString('ar-EG')}</div>
                  <div><strong>الموعد المستهدف:</strong> {selectedProject.target_completion_date || 'خلال 90 يوماً'}</div>
                </div>
              </div>

              {/* Title & Category Banner */}
              <div style={{ background: 'var(--primary-glow)', border: '1px solid var(--primary-light)', borderRadius: 10, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span className="badge badge-primary" style={{ fontWeight: 800 }}>
                    {selectedProject.category || 'سلامة المرضى'}
                  </span>
                  {getPriorityBadge(selectedProject.priority)}
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 900, color: 'var(--primary-dark)', margin: 0 }}>
                  {selectedProject.title}
                </h3>
              </div>

              {/* 1. Problem Statement & Baseline */}
              <div>
                <h4 style={{ fontSize: 14, fontWeight: 900, color: '#0f172a', borderRight: '4px solid var(--primary)', paddingRight: 8, margin: '0 0 8px 0' }}>
                  ١. مبررات المشروع وبيان المشكلة وتحليل الأداء الفعلي (Problem Statement & Baseline Performance):
                </h4>
                <div style={{ background: 'var(--bg-primary)', padding: 14, borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, lineHeight: 1.6 }}>
                  <p style={{ margin: '0 0 8px 0' }}>{selectedProject.problem_statement}</p>
                  {selectedProject.baseline_metrics && (
                    <div style={{ background: '#ffffff', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', fontWeight: 700, color: 'var(--primary-dark)', fontSize: 12 }}>
                      📊 <strong>أرقام الأداء الأساسية (Baseline):</strong> {selectedProject.baseline_metrics}
                    </div>
                  )}
                </div>
              </div>

              {/* 2. Evidence-Based Standards & References */}
              <div>
                <h4 style={{ fontSize: 14, fontWeight: 900, color: '#0f172a', borderRight: '4px solid var(--primary)', paddingRight: 8, margin: '0 0 8px 0' }}>
                  ٢. المرجع العلمي والدليل الإرشادي ومعايير الاعتماد (Evidence-Based Reference & Accreditation Standards):
                </h4>
                <div style={{ background: '#f0f9ff', padding: 12, borderRadius: 8, border: '1px solid #bae6fd', fontSize: 12, color: '#0369a1', fontWeight: 700 }}>
                  🏛️ {selectedProject.evidence_reference || 'معايير الهيئة العامة للاعتماد والرقابة الصحية (GAHAR) ودليل سلامة المرضى لمنظمة الصحة العالمية (WHO).'}
                </div>
              </div>

              {/* 3. SMART Goal */}
              <div>
                <h4 style={{ fontSize: 14, fontWeight: 900, color: '#0f172a', borderRight: '4px solid var(--primary)', paddingRight: 8, margin: '0 0 8px 0' }}>
                  ٣. الهدف الذكي القابل للقياس وموعد الإنجاز (SMART Objective & Target):
                </h4>
                <div style={{ background: '#f0fdf4', padding: 14, borderRadius: 8, border: '1px solid #bbf7d0', fontSize: 13, fontWeight: 800, color: '#166534' }}>
                  🎯 {selectedProject.smart_goal}
                </div>
              </div>

              {/* 4. KPIs Table */}
              {selectedProject.kpis && selectedProject.kpis.length > 0 && (
                <div>
                  <h4 style={{ fontSize: 14, fontWeight: 900, color: '#0f172a', borderRight: '4px solid var(--primary)', paddingRight: 8, margin: '0 0 8px 0' }}>
                    ٤. مؤشرات قياس نجاح المشروع (Project Key Performance Indicators - KPIs):
                  </h4>
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th>اسم المؤشر</th>
                          <th>نوع المؤشر</th>
                          <th>القيمة الحالية (Baseline)</th>
                          <th>المستهدف (Target)</th>
                          <th>دورية القياس</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedProject.kpis.map((kpi, idx) => (
                          <tr key={idx}>
                            <td style={{ fontWeight: 700 }}>{kpi.name}</td>
                            <td>
                              <span className={`badge ${kpi.type === 'outcome' ? 'badge-primary' : 'badge-neutral'}`} style={{ fontSize: 11 }}>
                                {kpi.type === 'outcome' ? 'مؤشر نتيجة' : 'مؤشر عملية'}
                              </span>
                            </td>
                            <td style={{ fontWeight: 800, color: 'var(--danger-dark)' }}>{kpi.baseline || '-'}</td>
                            <td style={{ fontWeight: 800, color: 'var(--success-dark)' }}>{kpi.target || '-'}</td>
                            <td style={{ color: 'var(--text-muted)' }}>{kpi.frequency || 'شهري'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 5. FOCUS-PDCA Action Plan */}
              {selectedProject.interventions && selectedProject.interventions.length > 0 && (
                <div>
                  <h4 style={{ fontSize: 14, fontWeight: 900, color: '#0f172a', borderRight: '4px solid var(--primary)', paddingRight: 8, margin: '0 0 8px 0' }}>
                    ٥. خطة العمل والتدخلات الإجرائية (Action Plan / FOCUS-PDCA Interventions):
                  </h4>
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th style={{ width: 40 }}>#</th>
                          <th>الخطوة الإجرائية / التدخل</th>
                          <th>المسؤول عن التنفيذ</th>
                          <th>المدى الزمني</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedProject.interventions.map((step, idx) => (
                          <tr key={idx}>
                            <td style={{ fontWeight: 700, color: 'var(--text-muted)' }}>{idx + 1}</td>
                            <td style={{ fontWeight: 600 }}>{step.step}</td>
                            <td style={{ fontWeight: 800, color: 'var(--primary-dark)' }}>{step.responsible || 'فريق الجودة'}</td>
                            <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{step.duration || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 6. Linked Findings from Inspection Reports */}
              {selectedProject.linked_findings_summary && selectedProject.linked_findings_summary.length > 0 && (
                <div>
                  <h4 style={{ fontSize: 14, fontWeight: 900, color: '#0f172a', borderRight: '4px solid var(--primary)', paddingRight: 8, margin: '0 0 8px 0' }}>
                    ٦. السلبيات المرصودة في تقارير المرور التي يستهدفها المشروع:
                  </h4>
                  <div style={{ background: 'var(--bg-primary)', padding: 14, borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {selectedProject.linked_findings_summary.map((finding, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                        <span style={{ color: 'var(--primary)', fontWeight: 800 }}>•</span>
                        <span>{finding}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 7. Leadership & Team */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 12 }}>
                <div style={{ background: 'var(--bg-primary)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
                  <strong style={{ display: 'block', color: 'var(--text-primary)', marginBottom: 2 }}>قائد المشروع بالمستشفى:</strong>
                  <span style={{ color: 'var(--primary-dark)', fontWeight: 800 }}>{selectedProject.project_lead || 'رئيس قسم الجودة بالمستشفى'}</span>
                </div>
                <div style={{ background: 'var(--bg-primary)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
                  <strong style={{ display: 'block', color: 'var(--text-primary)', marginBottom: 2 }}>أعضاء فريق التحسين:</strong>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {Array.isArray(selectedProject.team_members) && selectedProject.team_members.length > 0
                      ? selectedProject.team_members.join('، ')
                      : 'مشرفو التمريض، رؤساء الأقسام المعنية، منسق الجودة'}
                  </span>
                </div>
              </div>

              {/* 8. Directorate Endorsement & Signatures */}
              <div style={{ marginTop: 24, paddingTop: 20, borderTop: '2px solid #0f172a', display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'center', fontSize: 12 }}>
                <div>
                  <div style={{ fontWeight: 800, marginBottom: 36 }}>مسؤول مشاريع التحسين بالمديرية</div>
                  <div style={{ color: 'var(--text-muted)' }}>التوقيع: ............................</div>
                </div>
                <div>
                  <div style={{ fontWeight: 800, marginBottom: 36 }}>مدير إدارة الجودة بالمديرية</div>
                  <div style={{ color: 'var(--text-muted)' }}>التوقيع: ............................</div>
                </div>
                <div>
                  <div style={{ fontWeight: 800, marginBottom: 36 }}>وكيل الوزارة / مدير المديرية</div>
                  <div style={{ color: 'var(--text-muted)' }}>الاعتماد: ............................</div>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* 7. Manual Project Creation Modal */}
      {isManualModalOpen && (
        <div 
          className="qip-charter-modal no-print"
          onClick={() => setIsManualModalOpen(false)}
        >
          <div 
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              maxWidth: 580,
              width: '100%',
              padding: 24,
              boxShadow: 'var(--shadow-lg)',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              maxHeight: '90vh',
              overflowY: 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                إضافة مشروع تحسين جودة جديد (يدوياً)
              </h3>
              <button onClick={() => setIsManualModalOpen(false)} className="btn btn-ghost btn-sm" style={{ padding: '4px 8px' }}>
                ✕
              </button>
            </div>

            <form onSubmit={handleManualSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>المستشفى: *</label>
                <select
                  value={manualForm.hospital_id}
                  onChange={(e) => setManualForm(prev => ({ ...prev, hospital_id: e.target.value }))}
                  className="form-select"
                  style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
                  required
                >
                  <option value="">-- اختر مستشفى --</option>
                  {hospitals.map(h => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>عنوان المشروع: *</label>
                <input
                  type="text"
                  placeholder="مثال: مشروع تطبيق معايير السلامة الدوائية وفصل الأدوية الخطرة"
                  value={manualForm.title}
                  onChange={(e) => setManualForm(prev => ({ ...prev, title: e.target.value }))}
                  className="form-input"
                  style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>القسم المعني:</label>
                  <input
                    type="text"
                    placeholder="مثال: الصيدلية والعناية"
                    value={manualForm.department_name}
                    onChange={(e) => setManualForm(prev => ({ ...prev, department_name: e.target.value }))}
                    className="form-input"
                    style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>المجال / الفئة:</label>
                  <select
                    value={manualForm.category}
                    onChange={(e) => setManualForm(prev => ({ ...prev, category: e.target.value }))}
                    className="form-select"
                    style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
                  >
                    <option value="سلامة المرضى">سلامة المرضى</option>
                    <option value="إدارة الدواء">إدارة واستخدام الدواء</option>
                    <option value="مكافحة العدوى">مكافحة العدوى والتعقيم</option>
                    <option value="الرعاية الحرجة والطوارئ">الرعاية الحرجة والطوارئ</option>
                    <option value="الملف الطبي والتوثيق">الملف الطبي والتوثيق</option>
                    <option value="إدارة السلامة والمرافق">إدارة السلامة والمرافق (FMS)</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>بيان المشكلة ومبررات المشروع:</label>
                <textarea
                  rows={2}
                  placeholder="وصف المشكلة والأداء الفعلي ونسب السلبيات المرصودة..."
                  value={manualForm.problem_statement}
                  onChange={(e) => setManualForm(prev => ({ ...prev, problem_statement: e.target.value }))}
                  className="form-textarea"
                  style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>الهدف الذكي (SMART Goal):</label>
                <input
                  type="text"
                  placeholder="مثال: رفع نسبة الامتثال إلى 95% خلال 90 يوماً وتصفير السلبيات المتكررة"
                  value={manualForm.smart_goal}
                  onChange={(e) => setManualForm(prev => ({ ...prev, smart_goal: e.target.value }))}
                  className="form-input"
                  style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>الأولوية:</label>
                  <select
                    value={manualForm.priority}
                    onChange={(e) => setManualForm(prev => ({ ...prev, priority: e.target.value }))}
                    className="form-select"
                    style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
                  >
                    <option value="high">أولوية قصوى</option>
                    <option value="medium">أولوية متوسطة</option>
                    <option value="low">أولوية عادية</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>تاريخ الإنجاز المستهدف:</label>
                  <input
                    type="date"
                    value={manualForm.target_completion_date}
                    onChange={(e) => setManualForm(prev => ({ ...prev, target_completion_date: e.target.value }))}
                    className="form-input"
                    style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <button
                  type="button"
                  onClick={() => setIsManualModalOpen(false)}
                  className="btn btn-ghost"
                  style={{ padding: '8px 16px' }}
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ padding: '8px 24px', fontWeight: 800 }}
                >
                  حفظ المشروع
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}
