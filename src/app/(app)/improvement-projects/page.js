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
  ExclamationCircleIcon
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
    const approved = projects.filter(p => ['approved', 'in_progress'].includes(p.status)).length
    const completed = projects.filter(p => p.status === 'completed').length
    const high = projects.filter(p => p.priority === 'high').length
    return { total, approved, completed, high }
  }, [projects])

  // Status Labels and Badges
  const getStatusBadge = (status) => {
    switch (status) {
      case 'completed':
        return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">مكتمل ومحقق للمستهدف ✓</span>
      case 'in_progress':
        return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300">قيد التنفيذ بالمستشفى ⏳</span>
      case 'approved':
        return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-300">معتمد من المديرية 📋</span>
      case 'suspended':
        return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-300">معلق</span>
      default:
        return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">مقترح بالذكاء الاصطناعي (مسودة)</span>
    }
  }

  const getPriorityBadge = (priority) => {
    switch (priority) {
      case 'high':
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-700 border border-rose-200">أولوية قصوى ⚡</span>
      case 'medium':
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">أولوية متوسطة</span>
      default:
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-700">أولوية عادية</span>
    }
  }

  // Print Project Charter
  const handlePrintCharter = () => {
    window.print()
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <div className="w-10 h-10 border-4 border-teal-600 border-t-transparent rounded-full animate-spin" />
        <span className="text-slate-600 font-medium">جاري تحميل مشاريع التحسين...</span>
      </div>
    )
  }

  // Directorate Access Guard
  if (!['directorate_admin', 'directorate_member'].includes(userRole)) {
    return (
      <div className="max-w-xl mx-auto my-16 p-8 bg-white rounded-2xl shadow-sm border border-slate-200 text-center">
        <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <ExclamationCircleIcon className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-800 mb-2">قسم مخصص لأعضاء المديرية فقط</h2>
        <p className="text-slate-600 text-sm mb-6">
          قسم مشاريع التحسين ومقترحات الأداء متاح حصرياً لأعضاء فريق إدارة الجودة بالمديرية لمراجعة واعتماد مشاريع المستشفيات.
        </p>
        <Link href="/dashboard" className="inline-flex items-center justify-center px-6 py-2.5 rounded-xl bg-teal-700 text-white font-medium hover:bg-teal-800 transition">
          العودة للرئيسية
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-12">
      {/* 1. Header Banner */}
      <div className="bg-gradient-to-r from-teal-800 via-teal-700 to-cyan-800 text-white rounded-2xl p-6 lg:p-8 shadow-md relative overflow-hidden">
        <div className="absolute top-0 left-0 w-96 h-96 bg-white/5 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 backdrop-blur-sm text-teal-100 text-xs font-semibold">
              <SparklesIcon className="w-4 h-4 text-amber-300" />
              منظومة مشاريع التحسين المستمر (QIPs) • خاص بأعضاء المديرية
            </div>
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">
              مشاريع التحسين المبنية على الأداء والدليل
            </h1>
            <p className="text-teal-100/90 text-sm max-w-2xl leading-relaxed">
              تحليل شامل لكافة تقارير المرور والسلبيات المتكررة ومؤشرات الأداء، وتوليد مقترحات مشاريع تحسين سريرية وتشغيلية تتبع منهجية FOCUS-PDCA ومعايير GAHAR الوطنية.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => {
                setGenerateHospitalId(selectedHospitalId || hospitals[0]?.id || '')
                setIsGenerateModalOpen(true)
              }}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-900 font-bold shadow-lg shadow-amber-500/20 transition transform active:scale-95"
            >
              <SparklesIcon className="w-5 h-5 text-slate-900" />
              توليد مشاريع بالذكاء الاصطناعي
            </button>
            <button
              onClick={() => {
                setManualForm(prev => ({ ...prev, hospital_id: selectedHospitalId || hospitals[0]?.id || '' }))
                setIsManualModalOpen(true)
              }}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white text-sm font-semibold backdrop-blur-sm transition"
            >
              ➕ مشروع جديد
            </button>
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8 pt-6 border-t border-white/15 text-center">
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 border border-white/10">
            <div className="text-2xl font-black text-white">{stats.total}</div>
            <div className="text-xs text-teal-100 mt-1">إجمالي المشاريع</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 border border-white/10">
            <div className="text-2xl font-black text-purple-200">{stats.approved}</div>
            <div className="text-xs text-teal-100 mt-1">معتمدة / قيد التنفيذ</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 border border-white/10">
            <div className="text-2xl font-black text-emerald-300">{stats.completed}</div>
            <div className="text-xs text-teal-100 mt-1">مكتملة ومحققة</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 border border-white/10">
            <div className="text-2xl font-black text-rose-300">{stats.high}</div>
            <div className="text-xs text-teal-100 mt-1">أولوية قصوى</div>
          </div>
        </div>
      </div>

      {/* 2. Controls & Filters */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Hospital Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">المستشفى المستهدف:</label>
            <select
              value={selectedHospitalId}
              onChange={(e) => handleHospitalFilterChange(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600 transition"
            >
              <option value="">كافة المستشفيات ({hospitals.length})</option>
              {hospitals.map(h => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">حالة المشروع:</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600 transition"
            >
              <option value="all">كافة الحالات</option>
              <option value="draft">مقترح ذكاء اصطناعي (مسودة)</option>
              <option value="approved">معتمد من المديرية</option>
              <option value="in_progress">قيد التنفيذ بالمستشفى</option>
              <option value="completed">مكتمل ومحقق للمستهدف</option>
              <option value="suspended">معلق</option>
            </select>
          </div>

          {/* Priority Filter */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">مستوى الأولوية:</label>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600 transition"
            >
              <option value="all">كافة الأولويات</option>
              <option value="high">أولوية قصوى</option>
              <option value="medium">أولوية متوسطة</option>
              <option value="low">أولوية عادية</option>
            </select>
          </div>

          {/* Search */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">بحث سريع في المشاريع:</label>
            <input
              type="text"
              placeholder="ابحث بالعنوان، القسم، أو المشكلة..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600 transition"
            />
          </div>
        </div>

        {selectedHospitalId && (
          <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-600">
            <span>
              عرض مشاريع: <strong>{hospitals.find(h => h.id === selectedHospitalId)?.name}</strong> ({filteredProjects.length} مشروع)
            </span>
            <button
              onClick={() => handleHospitalFilterChange('')}
              className="text-teal-700 hover:underline font-semibold"
            >
              عرض كافة المستشفيات
            </button>
          </div>
        )}
      </div>

      {/* 3. Projects Grid */}
      {filteredProjects.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center max-w-2xl mx-auto space-y-4">
          <div className="w-16 h-16 bg-teal-50 text-teal-600 rounded-full flex items-center justify-center mx-auto">
            <SparklesIcon className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-slate-800">لا توجد مشاريع تحسين مطابقة</h3>
          <p className="text-slate-500 text-sm">
            {selectedHospitalId 
              ? 'لم يتم إنشاء أو توليد مشاريع تحسين لهذا المستشفى بعد. اضغط على الزر أدناه لتوليد مشاريع بالذكاء الاصطناعي استناداً لتقارير المرور والسلبيات المرصودة.' 
              : 'قم باختيار مستشفى واضغط على توليد مشاريع بالذكاء الاصطناعي لفحص السلبيات واقتراح خطط التحسين.'}
          </p>
          <button
            onClick={() => {
              setGenerateHospitalId(selectedHospitalId || hospitals[0]?.id || '')
              setIsGenerateModalOpen(true)
            }}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-sm shadow transition"
          >
            <SparklesIcon className="w-4 h-4" />
            توليد مقترحات مشاريع لهذا المستشفى
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProjects.map((project) => (
            <div 
              key={project.id}
              className="bg-white rounded-2xl border border-slate-200 hover:border-teal-400/80 shadow-sm hover:shadow-md transition flex flex-col justify-between overflow-hidden group"
            >
              {/* Card Header */}
              <div className="p-5 space-y-3.5 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-teal-50 text-teal-800 text-xs font-bold border border-teal-100">
                      <HospitalIcon className="w-3.5 h-3.5" />
                      {project.hospital_name}
                    </span>
                    {project.department_name && (
                      <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-700 font-medium truncate max-w-[120px]">
                        {project.department_name}
                      </span>
                    )}
                  </div>
                  {getPriorityBadge(project.priority)}
                </div>

                {/* Title */}
                <h3 className="font-bold text-slate-800 text-base leading-snug group-hover:text-teal-700 transition">
                  {project.title}
                </h3>

                {/* Status Badge */}
                <div>
                  {getStatusBadge(project.status)}
                </div>

                {/* SMART Goal Snippet */}
                {project.smart_goal && (
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-700 space-y-1">
                    <div className="font-bold text-teal-800 flex items-center gap-1">
                      🎯 الهدف الذكي (SMART Goal):
                    </div>
                    <p className="line-clamp-2 text-slate-600 leading-relaxed">
                      {project.smart_goal}
                    </p>
                  </div>
                )}

                {/* Evidence & Metrics Snippet */}
                <div className="space-y-2 pt-2 border-t border-slate-100 text-xs">
                  {project.evidence_reference && (
                    <div className="flex items-start gap-1.5 text-slate-600">
                      <span className="font-bold text-slate-700 whitespace-nowrap">المرجع:</span>
                      <span className="truncate">{project.evidence_reference}</span>
                    </div>
                  )}

                  {project.linked_findings_summary && project.linked_findings_summary.length > 0 && (
                    <div className="text-slate-500 flex items-center gap-1 font-medium">
                      📋 يعالج <strong>{project.linked_findings_summary.length}</strong> سلبيات مرصودة من تقارير المرور
                    </div>
                  )}
                </div>
              </div>

              {/* Card Footer Actions */}
              <div className="bg-slate-50 px-5 py-3 border-t border-slate-100 flex items-center justify-between gap-2">
                <button
                  onClick={() => {
                    setSelectedProject(project)
                    setIsCharterModalOpen(true)
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-teal-700 hover:text-teal-900 transition"
                >
                  <ClipboardIcon className="w-4 h-4" />
                  عرض ميثاق المشروع
                </button>

                <div className="flex items-center gap-1">
                  {project.status === 'draft' && (
                    <button
                      onClick={() => handleUpdateStatus(project.id, 'approved')}
                      title="اعتماد المشروع من المديرية"
                      className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-teal-600 hover:bg-teal-700 text-white transition"
                    >
                      اعتماد
                    </button>
                  )}
                  {project.status === 'approved' && (
                    <button
                      onClick={() => handleUpdateStatus(project.id, 'in_progress')}
                      title="بدء تنفيذ المشروع بالمستشفى"
                      className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
                    >
                      بدء التنفيذ
                    </button>
                  )}
                  {project.status === 'in_progress' && (
                    <button
                      onClick={() => handleUpdateStatus(project.id, 'completed')}
                      title="تحديد كمكتمل ومحقق للمستهدف"
                      className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition"
                    >
                      إتمام
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteProject(project.id)}
                    title="حذف المشروع"
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                  >
                    <XMarkIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 4. AI Generation Modal */}
      {isGenerateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 lg:p-8 shadow-2xl border border-slate-100 space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                  <SparklesIcon className="w-4 h-4 text-amber-600" />
                  تحليل استراتيجي بالذكاء الاصطناعي
                </div>
                <h3 className="text-xl font-bold text-slate-800">
                  توليد مشاريع تحسين جودة للمستشفى
                </h3>
              </div>
              <button 
                onClick={() => !isGenerating && setIsGenerateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              سيقوم المحرك الذكي بقراءة كافة تقارير المرور والسلبيات المرصودة في قاعدة البيانات لهذا المستشفى، وتحليل تركز السلبيات المتكررة وضعف الامتثال، وصياغة مقترحات مشاريع تحسين متكاملة وفق معايير الاعتماد GAHAR.
            </p>

            {generateError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-medium">
                ⚠️ {generateError}
              </div>
            )}

            <form onSubmit={handleGenerate} className="space-y-4">
              {/* Select Hospital */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">اختر المستشفى المراد تحليله: *</label>
                <select
                  disabled={isGenerating}
                  value={generateHospitalId}
                  onChange={(e) => setGenerateHospitalId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                  required
                >
                  <option value="">-- اختر مستشفى --</option>
                  {hospitals.map(h => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
              </div>

              {/* Focus Department (Optional) */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">التركيز على قسم معين (اختياري):</label>
                <input
                  type="text"
                  disabled={isGenerating}
                  placeholder="مثال: الصيدلية، المعمل، الطوارئ، العمليات... (أو اتركه فارغاً لشامل المستشفى)"
                  value={generateFocusDept}
                  onChange={(e) => setGenerateFocusDept(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              {/* Number of Projects */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">عدد المشاريع المقترحة:</label>
                <select
                  disabled={isGenerating}
                  value={generateCount}
                  onChange={(e) => setGenerateCount(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                >
                  <option value={2}>2 مشاريع تحسين أساسية</option>
                  <option value={3}>3 مشاريع تحسين متوازنة (موصى به)</option>
                  <option value={4}>4 مشاريع شاملة</option>
                  <option value={5}>5 مشاريع تفصيلية للأقسام الرئيسية</option>
                </select>
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  disabled={isGenerating}
                  onClick={() => setIsGenerateModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 transition"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isGenerating || !generateHospitalId}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white font-bold text-sm shadow transition"
                >
                  {isGenerating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      جاري فحص تقارير المرور والتحليل...
                    </>
                  ) : (
                    <>
                      <SparklesIcon className="w-4 h-4" />
                      بدء التحليل والتوليد
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. Project Full Charter Modal (Executive Quality View) */}
      {isCharterModalOpen && selectedProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto animate-fade-in print:p-0 print:bg-white">
          <div className="bg-white rounded-3xl max-w-4xl w-full p-6 lg:p-10 shadow-2xl border border-slate-200 my-8 space-y-6 print:m-0 print:border-none print:shadow-none">
            
            {/* Header actions (Hidden on print) */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 print:hidden">
              <div className="flex items-center gap-3">
                <button
                  onClick={handlePrintCharter}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition"
                >
                  🖨️ طباعة ميثاق المشروع
                </button>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500 font-semibold">تغيير الحالة:</span>
                  <select
                    disabled={statusUpdating}
                    value={selectedProject.status}
                    onChange={(e) => handleUpdateStatus(selectedProject.id, e.target.value)}
                    className="text-xs font-bold border border-slate-300 rounded-lg px-2.5 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
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
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            {/* Official Project Charter Document */}
            <div className="space-y-6 printable-charter text-slate-800">
              
              {/* Official Header */}
              <div className="border-b-2 border-slate-800 pb-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-teal-800 tracking-wide uppercase">
                    مديرية الشئون الصحية بكفر الشيخ • إدارة الجودة وتوكيد الأداء
                  </div>
                  <h2 className="text-2xl font-black text-slate-900">
                    ميثاق مشروع تحسين جودة الرعاية الصحية (QIP)
                  </h2>
                  <div className="text-sm font-semibold text-slate-600">
                    Quality Improvement Project Charter
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-right text-xs space-y-1 min-w-[200px]">
                  <div><strong>المستشفى:</strong> {selectedProject.hospital_name}</div>
                  <div><strong>القسم المستهدف:</strong> {selectedProject.department_name || 'عام'}</div>
                  <div><strong>تاريخ الاعتماد:</strong> {new Date(selectedProject.created_at).toLocaleDateString('ar-EG')}</div>
                  <div><strong>الموعد المستهدف:</strong> {selectedProject.target_completion_date || 'خلال 90 يوماً'}</div>
                </div>
              </div>

              {/* Title & Category Banner */}
              <div className="bg-teal-50 border border-teal-200 rounded-2xl p-5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold px-2.5 py-1 rounded bg-teal-800 text-white">
                    {selectedProject.category || 'سلامة المرضى'}
                  </span>
                  {getPriorityBadge(selectedProject.priority)}
                </div>
                <h3 className="text-xl font-black text-teal-950">
                  {selectedProject.title}
                </h3>
              </div>

              {/* 1. Problem Statement & Baseline */}
              <div className="space-y-2">
                <h4 className="text-sm font-black text-slate-900 border-r-4 border-teal-700 pr-2">
                  ١. مبررات المشروع وبيان المشكلة وتحليل الأداء الفعلي (Problem Statement & Baseline Performance):
                </h4>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs text-slate-700 space-y-2 leading-relaxed">
                  <p>{selectedProject.problem_statement}</p>
                  {selectedProject.baseline_metrics && (
                    <div className="p-2.5 bg-white rounded-lg border border-slate-200 font-medium text-slate-800">
                      📊 <strong>أرقام الأداء الأساسية (Baseline):</strong> {selectedProject.baseline_metrics}
                    </div>
                  )}
                </div>
              </div>

              {/* 2. Evidence-Based Standards & References */}
              <div className="space-y-2">
                <h4 className="text-sm font-black text-slate-900 border-r-4 border-teal-700 pr-2">
                  ٢. المرجع العلمي والدليل الإرشادي ومعايير الاعتماد (Evidence-Based Reference & Accreditation Standards):
                </h4>
                <div className="p-3.5 bg-blue-50/60 rounded-xl border border-blue-200 text-xs text-blue-900 font-semibold leading-relaxed">
                  🏛️ {selectedProject.evidence_reference || 'معايير الهيئة العامة للاعتماد والرقابة الصحية (GAHAR) ودليل سلامة المرضى لمنظمة الصحة العالمية (WHO).'}
                </div>
              </div>

              {/* 3. SMART Goal */}
              <div className="space-y-2">
                <h4 className="text-sm font-black text-slate-900 border-r-4 border-teal-700 pr-2">
                  ٣. الهدف الذكي القابل للقياس وموعد الإنجاز (SMART Objective & Target):
                </h4>
                <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200 text-xs font-bold text-emerald-950 leading-relaxed">
                  🎯 {selectedProject.smart_goal}
                </div>
              </div>

              {/* 4. KPIs Table */}
              {selectedProject.kpis && selectedProject.kpis.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-black text-slate-900 border-r-4 border-teal-700 pr-2">
                    ٤. مؤشرات قياس نجاح المشروع (Project Key Performance Indicators - KPIs):
                  </h4>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-right text-xs">
                      <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                        <tr>
                          <th className="p-3">اسم المؤشر</th>
                          <th className="p-3">نوع المؤشر</th>
                          <th className="p-3">القيمة الحالية (Baseline)</th>
                          <th className="p-3">المستهدف (Target)</th>
                          <th className="p-3">دورية القياس</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedProject.kpis.map((kpi, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/80">
                            <td className="p-3 font-semibold text-slate-800">{kpi.name}</td>
                            <td className="p-3 text-slate-600">
                              <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${kpi.type === 'outcome' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                {kpi.type === 'outcome' ? 'مؤشر نتيجة' : 'مؤشر عملية'}
                              </span>
                            </td>
                            <td className="p-3 font-bold text-rose-700">{kpi.baseline || '-'}</td>
                            <td className="p-3 font-bold text-emerald-700">{kpi.target || '-'}</td>
                            <td className="p-3 text-slate-500">{kpi.frequency || 'شهري'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 5. FOCUS-PDCA Action Plan */}
              {selectedProject.interventions && selectedProject.interventions.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-black text-slate-900 border-r-4 border-teal-700 pr-2">
                    ٥. خطة العمل والتدخلات الإجرائية (Action Plan / FOCUS-PDCA Interventions):
                  </h4>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-right text-xs">
                      <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                        <tr>
                          <th className="p-3 w-12">#</th>
                          <th className="p-3">الخطوة الإجرائية / التدخل</th>
                          <th className="p-3">المسؤول عن التنفيذ</th>
                          <th className="p-3">المدى الزمني</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedProject.interventions.map((step, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/80">
                            <td className="p-3 font-bold text-slate-500">{idx + 1}</td>
                            <td className="p-3 font-medium text-slate-800">{step.step}</td>
                            <td className="p-3 text-teal-800 font-bold">{step.responsible || 'فريق الجودة'}</td>
                            <td className="p-3 text-slate-600 whitespace-nowrap">{step.duration || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 6. Linked Findings from Inspection Reports */}
              {selectedProject.linked_findings_summary && selectedProject.linked_findings_summary.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-black text-slate-900 border-r-4 border-teal-700 pr-2">
                    ٦. السلبيات المرصودة في تقارير المرور التي يستهدفها المشروع:
                  </h4>
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs space-y-1.5">
                    {selectedProject.linked_findings_summary.map((finding, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-slate-700">
                        <span className="text-teal-600 font-bold">•</span>
                        <span>{finding}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 7. Leadership & Team */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-200 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="font-bold text-slate-700 block mb-1">قائد المشروع المقترح:</span>
                  <span className="text-slate-900 font-semibold">{selectedProject.project_lead || 'رئيس قسم الجودة بالمستشفى'}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="font-bold text-slate-700 block mb-1">أعضاء فريق التحسين:</span>
                  <span className="text-slate-800 font-medium">
                    {Array.isArray(selectedProject.team_members) && selectedProject.team_members.length > 0
                      ? selectedProject.team_members.join('، ')
                      : 'مشرفو التمريض، رؤساء الأقسام المعنية، منسق الجودة'}
                  </span>
                </div>
              </div>

              {/* 8. Directorate Endorsement & Signatures */}
              <div className="pt-8 border-t-2 border-slate-800 flex items-center justify-between text-center text-xs">
                <div>
                  <div className="font-bold text-slate-900 mb-8">مسؤول مشاريع التحسين بالمديرية</div>
                  <div className="text-slate-500">التوقيع: ............................</div>
                </div>
                <div>
                  <div className="font-bold text-slate-900 mb-8">مدير إدارة الجودة بالمديرية</div>
                  <div className="text-slate-500">التوقيع: ............................</div>
                </div>
                <div>
                  <div className="font-bold text-slate-900 mb-8">وكيل الوزارة / مدير المديرية</div>
                  <div className="text-slate-500">الاعتماد: ............................</div>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* 6. Manual Project Creation Modal */}
      {isManualModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto animate-fade-in">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 lg:p-8 shadow-2xl border border-slate-100 my-8 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-xl font-bold text-slate-800">إضافة مشروع تحسين جودة جديد (يدوياً)</h3>
              <button onClick={() => setIsManualModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">المستشفى: *</label>
                <select
                  value={manualForm.hospital_id}
                  onChange={(e) => setManualForm(prev => ({ ...prev, hospital_id: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm bg-slate-50 focus:bg-white"
                  required
                >
                  <option value="">-- اختر مستشفى --</option>
                  {hospitals.map(h => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">عنوان المشروع: *</label>
                <input
                  type="text"
                  placeholder="مثال: مشروع تطبيق معايير السلامة الدوائية وفصل الأدوية الخطرة"
                  value={manualForm.title}
                  onChange={(e) => setManualForm(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm bg-slate-50 focus:bg-white"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">القسم المعني:</label>
                  <input
                    type="text"
                    placeholder="مثال: الصيدلية والعناية"
                    value={manualForm.department_name}
                    onChange={(e) => setManualForm(prev => ({ ...prev, department_name: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm bg-slate-50 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">المجال / الفئة:</label>
                  <select
                    value={manualForm.category}
                    onChange={(e) => setManualForm(prev => ({ ...prev, category: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm bg-slate-50 focus:bg-white"
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
                <label className="block text-xs font-bold text-slate-700 mb-1">بيان المشكلة ومبررات المشروع:</label>
                <textarea
                  rows={2}
                  placeholder="وصف المشكلة والأداء الفعلي ونسب السلبيات المرصودة..."
                  value={manualForm.problem_statement}
                  onChange={(e) => setManualForm(prev => ({ ...prev, problem_statement: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm bg-slate-50 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الهدف الذكي القابل للقياس (SMART Goal):</label>
                <input
                  type="text"
                  placeholder="مثال: رفع نسبة الامتثال إلى 95% خلال 90 يوماً وتصفير السلبيات المتكررة"
                  value={manualForm.smart_goal}
                  onChange={(e) => setManualForm(prev => ({ ...prev, smart_goal: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm bg-slate-50 focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الأولوية:</label>
                  <select
                    value={manualForm.priority}
                    onChange={(e) => setManualForm(prev => ({ ...prev, priority: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm bg-slate-50 focus:bg-white"
                  >
                    <option value="high">أولوية قصوى</option>
                    <option value="medium">أولوية متوسطة</option>
                    <option value="low">أولوية عادية</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">تاريخ الإنجاز المستهدف:</label>
                  <input
                    type="date"
                    value={manualForm.target_completion_date}
                    onChange={(e) => setManualForm(prev => ({ ...prev, target_completion_date: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm bg-slate-50 focus:bg-white"
                  />
                </div>
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsManualModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-sm shadow"
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
