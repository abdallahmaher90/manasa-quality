'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/Toast'

const STEPS = ['رفع الملف', 'تحليل AI', 'مراجعة وتأكيد', 'تم الحفظ']

const COMMON_HOSPITAL_DEPARTMENTS = [
  'الاستقبال والطوارئ',
  'العناية المركزة',
  'عناية القلب',
  'الحضانات والمبتسرين',
  'العمليات والإفاقة',
  'القسم الداخلي',
  'العيادات الخارجية',
  'الغسيل الكلوي',
  'الصيدلة',
  'المعامل وبنك الدم',
  'الأشعة والتصوير الطبي',
  'مكافحة العدوى',
  'السلامة والصحة المهنية',
  'التوثيق الطبي والملفات',
  'الإدارة الهندسية والصيانة',
  'التغذية والمطبخ',
  'المغسلة',
  'النفايات الطبية والمحرقة',
  'الأسنان',
  'العلاج الطبيعي',
  'التعقيم المركزي',
  'المخازن والمستلزمات',
  'التذاكر والدخول',
  'الشؤون الإدارية والموارد البشرية',
  'إدارة الجودة وسلامة المرضى'
]

export default function UploadPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const fileInputRef = useRef(null)
  const [step, setStep] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [inputMethod, setInputMethod] = useState(null) // 'file' | 'text'
  const [rawText, setRawText] = useState('')
  const [fileName, setFileName] = useState('')
  const [fileObj, setFileObj] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [parsedData, setParsedData] = useState(null)
  const [parsedHospitalId, setParsedHospitalId] = useState(null)
  const [fileHash, setFileHash] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(0)

  // Phase 3 Step 1: Department Modal (replace window.prompt)
  const [deptModal, setDeptModal] = useState(null) // { mode: 'add' | 'move', fromDIdx, fIdx, title, defaultValue, targetDept }
  const [modalInputVal, setModalInputVal] = useState('')

  // Phase 3 Step 2: Collapsible departments & Safe finding deletion
  const [collapsedDepts, setCollapsedDepts] = useState({}) // { [deptIndex]: boolean }
  const [deleteConfirmModal, setDeleteConfirmModal] = useState(null) // { dIdx, fIdx, text, deptName }

  const toggleDeptCollapse = (dIdx) => {
    setCollapsedDepts(prev => ({
      ...prev,
      [dIdx]: !prev[dIdx]
    }))
  }

  const isDeptCollapsed = (dIdx) => {
    if (collapsedDepts[dIdx] !== undefined) {
      return collapsedDepts[dIdx]
    }
    // Default: first department (0) expanded, remaining collapsed
    return dIdx !== 0
  }

  const handleClearFile = (e) => {
    if (e) e.stopPropagation()
    setFileObj(null)
    setFileName('')
    setFileHash(null)
    setRawText('')
    setError('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const extractTextFromFile = async (file) => {
    setFileName(file.name)
    const ext = file.name.split('.').pop().toLowerCase()

    if (ext === 'txt') {
      return await file.text()
    }

    if (ext === 'docx') {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/extract-text', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      return data.text
    }

    if (ext === 'pdf') {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/extract-text', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      return data.text
    }

    throw new Error('نوع الملف غير مدعوم. يرجى رفع ملف Word أو PDF أو نص.')
  }

  const computeFileHash = async (file) => {
    try {
      const arrayBuffer = await file.arrayBuffer()
      const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    } catch (e) {
      console.error('Hash error', e)
      return null
    }
  }

  const handleFile = async (file) => {
    setInputMethod('file')
    setError('')
    setFileObj(file)
    setFileName(file.name)
    setFileHash(null)
    try {
      const hash = await computeFileHash(file)
      if (hash) setFileHash(hash)
      
      const text = await extractTextFromFile(file)
      setRawText(text)
    } catch (err) {
      setError(err.message)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const handleAnalyze = async () => {
    if (!rawText.trim()) {
      setError('يرجى إدخال نص التقرير أو رفع ملف أولاً.')
      return
    }

    setParsing(true)
    setError('')
    setStep(1)
    setProgress(10)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      setProgress(30)
      const res = await fetch('/api/parse-report', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': session ? `Bearer ${session.access_token}` : ''
        },
        body: JSON.stringify({ text: rawText, fileHash }),
      })

      setProgress(70)
      const data = await res.json()

      if (data.error) throw new Error(data.error)

      setParsedData(data.result)
      setParsedHospitalId(data.hospitalId)
      setCollapsedDepts({})
      setProgress(100)
      setStep(2)
    } catch (err) {
      setError('حدث خطأ أثناء التحليل: ' + err.message)
      setStep(0)
    } finally {
      setParsing(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')

    try {
      let fileUrl = null
      
      // Upload file to Supabase Storage if present
      if (fileObj) {
        if (!parsedHospitalId) {
          throw new Error('لا يمكن حفظ الملف: تعذر التعرف على المستشفى بشكل صحيح.')
        }
        const fileExt = fileObj.name.split('.').pop()
        const reportId = crypto.randomUUID()
        const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
        const filePath = `${parsedHospitalId}/${reportId}/${uniqueName}`
        
        const { error: uploadError } = await supabase.storage
          .from('reports_files')
          .upload(filePath, fileObj)
          
        if (uploadError) throw new Error('فشل في رفع الملف: ' + uploadError.message)
        
        fileUrl = filePath
      }

      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/save-report', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': session ? `Bearer ${session.access_token}` : ''
        },
        body: JSON.stringify({
          parsedData,
          rawText,
          fileName: fileObj ? fileObj.name : null,
          fileUrl,
          fileHash
        }),
      })

      const data = await res.json()
      if (data.error) throw new Error(data.error)

      setStep(3)
      setTimeout(() => {
        router.push(`/hospitals/${data.hospitalId}`)
      }, 2000)
    } catch (err) {
      setError('حدث خطأ أثناء الحفظ: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  // Helpers for editing parsed data
  const updateDeptName = (dIdx, val) => {
    const newData = { ...parsedData }
    newData.departments[dIdx].name = val
    setParsedData(newData)
  }

  const updateFinding = (dIdx, fIdx, field, val) => {
    const newData = { ...parsedData }
    newData.departments[dIdx].findings[fIdx][field] = val
    setParsedData(newData)
  }

  const requestDeleteFinding = (dIdx, fIdx) => {
    const targetDept = parsedData?.departments?.[dIdx]
    const targetFinding = targetDept?.findings?.[fIdx]
    if (!targetFinding) return

    setDeleteConfirmModal({
      dIdx,
      fIdx,
      text: targetFinding.canonical_text || targetFinding.original_text || 'هذه السلبية',
      deptName: targetDept.name || 'القسم'
    })
  }

  const confirmDeleteFinding = () => {
    if (!deleteConfirmModal) return
    const { dIdx, fIdx } = deleteConfirmModal
    const newData = { ...parsedData }
    if (newData.departments?.[dIdx]?.findings) {
      newData.departments[dIdx].findings.splice(fIdx, 1)
      if (newData.departments[dIdx].findings.length === 0) {
        newData.departments.splice(dIdx, 1) // Remove empty department
      }
      setParsedData(newData)
      showToast('تم حذف السلبية من التقرير بنجاح', 'info')
    }
    setDeleteConfirmModal(null)
  }

  const addNewDepartment = () => {
    setModalInputVal('')
    setDeptModal({
      mode: 'add',
      title: 'إضافة قسم جديد للتقرير',
      subtitle: 'أدخل اسم القسم الطبي أو الإداري لإدراجه في قائمة أقسام التقرير:'
    })
  }

  const executeAddDepartment = (name) => {
    if (!name || !name.trim()) return
    const cleanName = name.trim()
    const newData = { ...parsedData }
    const exists = newData.departments?.some(d => d.name.trim().toLowerCase() === cleanName.toLowerCase())
    if (exists) {
      showToast('هذا القسم موجود بالفعل في التقرير!', 'error')
      return
    }
    newData.departments = newData.departments || []
    newData.departments.push({
      name: cleanName,
      findings: []
    })
    setParsedData(newData)
    setDeptModal(null)
    setModalInputVal('')
    // Ensure newly added department is expanded
    const newIdx = newData.departments.length - 1
    setCollapsedDepts(prev => ({ ...prev, [newIdx]: false }))
    showToast(`تمت إضافة قسم "${cleanName}" بنجاح`, 'success')
  }

  const executeMoveFindingToName = (fromDIdx, fIdx, targetDeptName) => {
    if (!targetDeptName || !targetDeptName.trim()) return
    const cleanName = targetDeptName.trim()

    const newData = { ...parsedData }
    const finding = newData.departments[fromDIdx]?.findings?.[fIdx]
    if (!finding) return

    // Remove from source department
    newData.departments[fromDIdx].findings.splice(fIdx, 1)

    // Check if the department already exists in report
    const existingIdx = newData.departments.findIndex(
      d => d.name.trim().toLowerCase() === cleanName.toLowerCase()
    )

    let targetIdx = existingIdx
    if (existingIdx !== -1) {
      // Add finding to existing department
      newData.departments[existingIdx].findings.push(finding)
    } else {
      // Create new department with this finding
      newData.departments.push({
        name: cleanName,
        findings: [finding]
      })
      targetIdx = newData.departments.length - 1
    }

    // If source department is now empty, remove it
    if (newData.departments[fromDIdx] && newData.departments[fromDIdx].findings.length === 0) {
      newData.departments.splice(fromDIdx, 1)
    }

    setParsedData(newData)
    setDeptModal(null)
    setModalInputVal('')
    // Ensure the target department is expanded so user sees the moved finding
    if (targetIdx !== undefined && targetIdx >= 0) {
      setCollapsedDepts(prev => ({ ...prev, [targetIdx]: false }))
    }
    showToast(`تم نقل السلبية إلى "${cleanName}" بنجاح`, 'success')
  }

  const handleMoveFinding = (fromDIdx, fIdx, targetVal) => {
    if (targetVal === '' || targetVal === String(fromDIdx)) return

    if (targetVal === '__custom_new__') {
      setModalInputVal('')
      setDeptModal({
        mode: 'move',
        fromDIdx,
        fIdx,
        title: 'نقل السلبية إلى قسم جديد',
        subtitle: 'أدخل اسم القسم الجديد الذي ترغب في نقل هذه السلبية إليه:'
      })
      return
    }

    if (typeof targetVal === 'string' && targetVal.startsWith('dept_name:')) {
      const targetDeptName = targetVal.replace('dept_name:', '').trim()
      executeMoveFindingToName(fromDIdx, fIdx, targetDeptName)
      return
    }

    const toIndex = parseInt(targetVal, 10)
    if (!isNaN(toIndex) && toIndex !== fromDIdx) {
      moveFinding(fromDIdx, fIdx, toIndex)
    }
  }

  const moveFinding = (fromDIdx, fIdx, toDIdx) => {
    if (fromDIdx === parseInt(toDIdx)) return
    const newData = { ...parsedData }
    const finding = newData.departments[fromDIdx].findings[fIdx]
    newData.departments[fromDIdx].findings.splice(fIdx, 1)
    newData.departments[toDIdx].findings.push(finding)
    
    if (newData.departments[fromDIdx].findings.length === 0) {
      newData.departments.splice(fromDIdx, 1) // Remove empty department
    }
    setParsedData(newData)
    // Expand the target department so user immediately sees the moved finding
    setCollapsedDepts(prev => ({ ...prev, [toDIdx]: false }))
    showToast('تم نقل السلبية بنجاح', 'success')
  }

  const totalFindings = parsedData?.departments?.reduce((acc, d) => acc + (d.findings?.length || 0), 0) || 0

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>

      {/* Step Indicator */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--space-2xl)', gap: 0 }}>
        {STEPS.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'initial' }}>
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: i < step ? 'var(--success)' : i === step ? 'var(--primary)' : 'var(--bg-card)',
                border: `2px solid ${i < step ? 'var(--success)' : i === step ? 'var(--primary-light)' : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700, transition: 'all 0.3s',
                color: i <= step ? 'white' : 'var(--text-muted)',
                boxShadow: i === step ? '0 0 15px rgba(26,95,158,0.4)' : 'none',
              }}>
                {i < step ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: 12, color: i === step ? 'var(--accent-light)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {s}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{
                flex: 1, height: 2, margin: '0 var(--space-sm)', marginBottom: 20,
                background: i < step ? 'var(--success)' : 'var(--border)',
                transition: 'background 0.3s',
              }} />
            )}
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="alert alert-danger mb-md">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* STEP 0: Upload */}
      {step === 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">📤 رفع تقرير المرور</h2>
          </div>

          {/* Method selector */}
          <div style={{ display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
            <button
              id="upload-method-file"
              className={`btn ${inputMethod !== 'text' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setInputMethod('file')}
            >
              <span>📎</span> رفع ملف (Word / PDF)
            </button>
            <button
              id="upload-method-text"
              className={`btn ${inputMethod === 'text' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setInputMethod('text')}
            >
              <span>📝</span> قص ولزق نص
            </button>
          </div>

          {/* File Upload Zone */}
          {inputMethod !== 'text' && (
            <div
              id="upload-dropzone"
              className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => {
                if (!fileName) fileInputRef.current?.click()
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.pdf,.txt"
                style={{ display: 'none' }}
                id="file-input"
                onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
              />
              <span className="upload-icon">
                {fileName ? '📄' : '☁️'}
              </span>
              {fileName ? (
                <>
                  <div className="upload-title" style={{ color: 'var(--success-light)' }}>
                    ✅ تم اختيار الملف بنجاح
                  </div>
                  <div className="upload-subtitle" style={{ wordBreak: 'break-all', fontWeight: 600 }}>{fileName}</div>
                  <div style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      id="remove-file-btn"
                      className="btn btn-ghost btn-sm"
                      style={{ border: '1px solid var(--border)', color: 'var(--danger-light)', background: 'var(--bg-card)' }}
                      onClick={handleClearFile}
                    >
                      <span>✕</span> إزالة الملف واختيار آخر
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="upload-title">اسحب الملف هنا أو اضغط للاختيار</div>
                  <div className="upload-subtitle">
                    يدعم النظام ملفات Word وPDF والنصوص العادية<br />
                    الذكاء الاصطناعي سيقرأ التقرير ويستخرج السلبيات تلقائياً
                  </div>
                </>
              )}
              <div className="upload-types">
                <span className="badge badge-primary">📄 DOCX</span>
                <span className="badge badge-primary">📕 PDF</span>
                <span className="badge badge-primary">📝 TXT</span>
              </div>
            </div>
          )}

          {/* Text Input */}
          {inputMethod === 'text' && (
            <div className="form-group">
              <label className="form-label">الصق نص التقرير هنا</label>
              <textarea
                id="report-text-input"
                className="form-textarea"
                placeholder="الصق نص تقرير المرور هنا..."
                style={{ minHeight: 300, direction: 'rtl', color: '#0f172a', background: '#ffffff', border: '1.5px solid #cbd5e1' }}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
              />
            </div>
          )}

          {/* Preview of extracted text */}
          {rawText && inputMethod === 'file' && (
            <div style={{ marginTop: 'var(--space-md)' }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 'var(--space-sm)' }}>
                معاينة النص المستخرج ({rawText.length} حرف):
              </div>
              <div style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--space-md)',
                maxHeight: 150,
                overflow: 'hidden',
                fontSize: 13,
                color: 'var(--text-muted)',
                lineHeight: 1.6,
                position: 'relative',
              }}>
                {rawText.slice(0, 400)}...
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0, height: 40,
                  background: 'linear-gradient(transparent, var(--bg-secondary))',
                }} />
              </div>
            </div>
          )}

          <div style={{ marginTop: 'var(--space-xl)', display: 'flex', gap: 'var(--space-md)', justifyContent: 'flex-end' }}>
            <button
              id="analyze-btn"
              className="btn btn-primary btn-lg"
              onClick={handleAnalyze}
              disabled={!rawText.trim() && !fileName}
            >
              <span>🤖</span>
              تحليل بالذكاء الاصطناعي
            </button>
          </div>
        </div>
      )}

      {/* STEP 1: Parsing */}
      {step === 1 && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-3xl)' }}>
          <div style={{ fontSize: 64, marginBottom: 'var(--space-lg)' }}>🤖</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 'var(--space-md)' }}>
            جاري تحليل التقرير...
          </h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-xl)' }}>
            الذكاء الاصطناعي يقرأ التقرير ويستخرج المستشفى والأقسام والسلبيات تلقائياً
          </p>
          <div className="progress-bar" style={{ maxWidth: 400, margin: '0 auto' }}>
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 'var(--space-md)' }}>
            {progress < 30 ? 'جاري قراءة الملف...' : progress < 70 ? 'جاري التحليل...' : 'جاري المراجعة...'}
          </p>
        </div>
      )}

      {/* STEP 2: Review */}
      {step === 2 && parsedData && (
        <div>
          {/* Summary */}
          <div className="card mb-lg">
            <div className="card-header">
              <h2 className="card-title">✅ تم التحليل بنجاح - مراجعة البيانات</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 'var(--space-md)' }}>
              <div>
                <div className="text-muted text-sm">المنشأة</div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{parsedData.hospital_name || '-'}</div>
              </div>
              <div>
                <div className="text-muted text-sm">المحافظة</div>
                <div style={{ fontWeight: 700 }}>{parsedData.governorate || '-'}</div>
              </div>
              <div>
                <div className="text-muted text-sm">القائم بالمرور</div>
                <div style={{ fontWeight: 700 }}>{parsedData.inspector_name || '-'}</div>
              </div>
              <div>
                <label className="text-muted text-sm" style={{ display: 'block', marginBottom: 4 }}>
                  تاريخ المرور {parsedData.inspection_date && <span style={{ fontSize: 11, color: 'var(--accent-light)' }}>✓ معتمد</span>}
                </label>
                <input
                  type="date"
                  value={parsedData.inspection_date || ''}
                  onChange={(e) => setParsedData({ ...parsedData, inspection_date: e.target.value })}
                  style={{
                    padding: '8px 12px',
                    fontSize: 14,
                    fontWeight: '700',
                    background: '#ffffff',
                    border: '1.5px solid #cbd5e1',
                    borderRadius: 'var(--radius-sm)',
                    color: '#0f172a',
                    fontFamily: 'inherit',
                    width: '100%',
                    maxWidth: 180,
                    outline: 'none'
                  }}
                  title="تاريخ المرور (إذا كان المرور يومين يتم اعتماد اليوم الأخير تلقائياً ويمكن تعديله)"
                />
              </div>
              <div>
                <div className="text-muted text-sm">عدد الأقسام</div>
                <div style={{ fontWeight: 700, color: 'var(--accent-light)' }}>
                  {parsedData.departments?.length || 0} قسم
                </div>
              </div>
              <div>
                <div className="text-muted text-sm">إجمالي السلبيات</div>
                <div style={{ fontWeight: 700, color: 'var(--danger-light)' }}>
                  {totalFindings} سلبية
                </div>
              </div>
            </div>
          </div>

          {/* Departments Header & Add Action */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)', flexWrap: 'wrap', gap: 10 }}>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>الأقسام والسلبيات المرصودة</h3>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={addNewDepartment}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, border: '1.5px dashed var(--primary)', color: 'var(--primary)', background: '#ffffff', padding: '6px 14px', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
            >
              <span>➕</span> إضافة قسم جديد للتقرير
            </button>
          </div>

          {/* Departments & Findings (Collapsible & Responsive) */}
          {parsedData.departments?.map((dept, dIdx) => {
            const collapsed = isDeptCollapsed(dIdx)
            const findingCount = dept.findings?.length || 0

            return (
              <div key={dIdx} className="card mb-md" style={{ overflow: 'hidden' }}>
                {/* Collapsible Header */}
                <div 
                  className={`dept-collapse-header ${collapsed ? 'collapsed' : ''}`}
                  onClick={() => toggleDeptCollapse(dIdx)}
                  style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 20px', cursor: 'pointer', borderBottom: collapsed ? 'none' : '1px solid var(--border)' }}
                >
                  <span 
                    className={`dept-collapse-arrow ${!collapsed ? 'open' : ''}`}
                    title={collapsed ? 'فتح القسم' : 'طي القسم'}
                  >
                    ▼
                  </span>
                  <span style={{ fontSize: 20 }}>🏨</span>
                  <input 
                    type="text" 
                    className="dept-name-input"
                    value={dept.name} 
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateDeptName(dIdx, e.target.value)}
                    style={{ flex: 1, padding: '6px 12px', fontSize: 16, fontWeight: '700', background: '#ffffff', border: '1.5px solid #cbd5e1', borderRadius: 'var(--radius-sm)', color: '#0f172a', outline: 'none' }}
                  />
                  <span className={`badge ${findingCount > 0 ? 'badge-danger' : 'badge-neutral'}`} style={{ whiteSpace: 'nowrap' }}>
                    {findingCount} سلبية
                  </span>
                  {findingCount === 0 && (
                    <button 
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        const newData = { ...parsedData }
                        newData.departments.splice(dIdx, 1)
                        setParsedData(newData)
                      }}
                      style={{ background: 'transparent', border: 'none', color: 'var(--danger-light)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                    >
                      🗑️ حذف القسم
                    </button>
                  )}
                </div>

                {/* Collapsible Body */}
                {!collapsed && (
                  <div style={{ padding: 'var(--space-md)', borderTop: '1px solid var(--border)' }}>
                    {findingCount === 0 ? (
                      <div style={{ padding: 'var(--space-md)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, border: '1.5px dashed var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-card)' }}>
                        لا توجد سلبيات في هذا القسم حالياً. يمكنك نقل سلبيات إليه من الأقسام الأخرى عبر خيار "نقل إلى".
                      </div>
                    ) : (
                      dept.findings?.map((f, fIdx) => (
                        <div key={fIdx} className="finding-card open" style={{ marginBottom: 'var(--space-sm)', flexDirection: 'column', gap: 10, alignItems: 'stretch' }}>
                          <div className="review-finding-row" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', width: '100%' }}>
                            <div className="review-finding-index" style={{ fontWeight: 800, fontSize: 14, color: 'var(--text-muted)', minWidth: 24, marginTop: 10 }}>
                              {fIdx + 1}
                            </div>
                            <div style={{ flex: 1, width: '100%' }}>
                              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
                                نص السلبية #{fIdx + 1}
                              </label>
                              <textarea 
                                style={{ width: '100%', minHeight: 70, marginBottom: 8, fontSize: 15, fontWeight: '600', lineHeight: 1.6, padding: '10px 14px', background: '#ffffff', border: '1.5px solid #cbd5e1', borderRadius: 'var(--radius-sm)', color: '#0f172a', fontFamily: 'inherit', outline: 'none' }}
                                value={f.canonical_text || f.original_text || ''}
                                onChange={(e) => updateFinding(dIdx, fIdx, 'canonical_text', e.target.value)}
                                placeholder="نص السلبية..."
                              />
                              <div className="review-finding-controls" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                <div style={{ flex: 1, minWidth: 200 }}>
                                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3 }}>
                                    الإجراء التصحيحي المقترح:
                                  </label>
                                  <input 
                                    type="text" 
                                    style={{ width: '100%', fontSize: 14, fontWeight: '500', padding: '8px 12px', background: '#ffffff', border: '1.5px solid #cbd5e1', borderRadius: 'var(--radius-sm)', color: '#0f172a', outline: 'none' }}
                                    value={f.corrective_action || ''}
                                    onChange={(e) => updateFinding(dIdx, fIdx, 'corrective_action', e.target.value)}
                                    placeholder="الإجراء التصحيحي (اختياري)..."
                                  />
                                </div>
                                <div style={{ minWidth: 140 }}>
                                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3 }}>
                                    مستوى الأولوية:
                                  </label>
                                  <select 
                                    style={{ width: '100%', fontSize: 13, fontWeight: '600', padding: '8px 12px', background: '#ffffff', border: '1.5px solid #cbd5e1', borderRadius: 'var(--radius-sm)', color: '#0f172a', outline: 'none' }}
                                    value={f.priority || 'medium'}
                                    onChange={(e) => updateFinding(dIdx, fIdx, 'priority', e.target.value)}
                                  >
                                    <option value="high">🔴 أولوية عالية</option>
                                    <option value="medium">🟡 متوسطة</option>
                                    <option value="low">🟢 منخفضة</option>
                                  </select>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Actions Row */}
                          <div className="review-finding-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                            <select 
                              className="review-move-select"
                              style={{ fontSize: 13, fontWeight: '600', padding: '7px 12px', background: '#ffffff', border: '1.5px solid #cbd5e1', borderRadius: 'var(--radius-sm)', color: '#0f172a', outline: 'none', cursor: 'pointer', maxWidth: 300 }}
                              value={dIdx}
                              onChange={(e) => handleMoveFinding(dIdx, fIdx, e.target.value)}
                            >
                              <optgroup label="📋 أقسام التقرير الحالي">
                                {parsedData.departments.map((d, i) => (
                                  <option key={i} value={i}>
                                    نقل إلى: {d.name} {i === dIdx ? '(القسم الحالي)' : ''}
                                  </option>
                                ))}
                              </optgroup>

                              <optgroup label="➕ نقل إلى قسم آخر بالمستشفى">
                                {COMMON_HOSPITAL_DEPARTMENTS
                                  .filter(name => !parsedData.departments.some(d => d.name.trim().toLowerCase() === name.trim().toLowerCase()))
                                  .map((name) => (
                                    <option key={`common_${name}`} value={`dept_name:${name}`}>
                                      ➕ {name} (إنشاء قسم جديد)
                                    </option>
                                  ))
                                }
                              </optgroup>

                              <optgroup label="✏️ كتابة اسم قسم مخصص">
                                <option value="__custom_new__">
                                  ✏️ نقل إلى قسم جديد (كتابة اسم القسم يدوي)...
                                </option>
                              </optgroup>
                            </select>

                            <button 
                              type="button"
                              className="review-delete-btn"
                              onClick={() => requestDeleteFinding(dIdx, fIdx)} 
                              style={{ background: 'transparent', border: 'none', color: 'var(--danger-light)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}
                            >
                              🗑️ حذف السلبية
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 'var(--space-md)', justifyContent: 'flex-end', marginTop: 'var(--space-xl)' }}>
            <button
              id="back-to-upload"
              className="btn btn-ghost"
              onClick={() => { setStep(0); setParsedData(null) }}
            >
              ← إعادة الرفع
            </button>
            <button
              id="confirm-save-btn"
              className="btn btn-success btn-lg"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? (
                <><div className="loading-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> جاري الحفظ...</>
              ) : (
                <><span>💾</span> تأكيد وحفظ ({totalFindings} سلبية)</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Done */}
      {step === 3 && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-3xl)' }}>
          <div style={{ fontSize: 80, marginBottom: 'var(--space-lg)' }}>🎉</div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--success-light)', marginBottom: 'var(--space-md)' }}>
            تم الحفظ بنجاح!
          </h2>
          <p style={{ color: 'var(--text-muted)' }}>
            تم حفظ التقرير وإضافة السلبيات للقسم المعني. جاري الانتقال لصفحة المستشفى...
          </p>
          <div className="loading-spinner" style={{ margin: 'var(--space-xl) auto 0' }} />
        </div>
      )}

      {/* Safe Finding Deletion Confirmation Modal (Phase 3 Step 2) */}
      {deleteConfirmModal && (
        <div 
          className="modal-overlay" 
          onClick={() => setDeleteConfirmModal(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setDeleteConfirmModal(null)
          }}
        >
          <div 
            className="confirm-modal-box" 
            onClick={(e) => e.stopPropagation()} 
            role="dialog" 
            aria-modal="true"
            style={{ maxWidth: 460 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: 'var(--danger-light)',
                  flexShrink: 0,
                  fontSize: 18
                }}
              >
                ⚠️
              </div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>
                تأكيد حذف السلبية
              </h3>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 14px 0' }}>
              هل أنت متأكد من حذف هذه السلبية من قسم <strong style={{ color: 'var(--text-primary)' }}>"{deleteConfirmModal.deptName}"</strong>؟
            </p>

            <div 
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 14px',
                fontSize: 13,
                color: 'var(--text-primary)',
                maxHeight: 100,
                overflowY: 'auto',
                marginBottom: 20,
                lineHeight: 1.5,
                fontWeight: 600
              }}
            >
              "{deleteConfirmModal.text}"
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                id="cancel-delete-modal-btn"
                className="btn btn-ghost"
                onClick={() => setDeleteConfirmModal(null)}
              >
                إلغاء
              </button>
              <button
                type="button"
                id="confirm-delete-modal-btn"
                className="btn btn-danger"
                onClick={confirmDeleteFinding}
              >
                حذف السلبية
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Department Custom Modal (Phase 3 Step 1 - replaces window.prompt) */}
      {deptModal && (
        <div 
          className="modal-overlay" 
          onClick={() => setDeptModal(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setDeptModal(null)
          }}
        >
          <div 
            className="confirm-modal-box" 
            onClick={(e) => e.stopPropagation()} 
            role="dialog" 
            aria-modal="true"
            style={{ maxWidth: 460 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(59, 130, 246, 0.15)',
                  color: 'var(--primary-light)',
                  flexShrink: 0,
                  fontSize: 18
                }}
              >
                🏨
              </div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>
                {deptModal.title}
              </h3>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 16px 0' }}>
              {deptModal.subtitle}
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!modalInputVal.trim()) return
                if (deptModal.mode === 'add') {
                  executeAddDepartment(modalInputVal)
                } else if (deptModal.mode === 'move') {
                  executeMoveFindingToName(deptModal.fromDIdx, deptModal.fIdx, modalInputVal)
                }
              }}
            >
              <div className="form-group" style={{ marginBottom: 20 }}>
                <label className="form-label" htmlFor="dept-name-modal-input">اسم القسم *</label>
                <input
                  id="dept-name-modal-input"
                  type="text"
                  className="form-input"
                  autoFocus
                  required
                  placeholder="مثال: الاستقبال والطوارئ، بنك الدم..."
                  value={modalInputVal}
                  onChange={(e) => setModalInputVal(e.target.value)}
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    background: '#ffffff',
                    color: '#0f172a',
                    border: '1.5px solid var(--border-accent)'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  id="cancel-dept-modal-btn"
                  className="btn btn-ghost"
                  onClick={() => {
                    setDeptModal(null)
                    setModalInputVal('')
                  }}
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  id="submit-dept-modal-btn"
                  className="btn btn-primary"
                  disabled={!modalInputVal.trim()}
                >
                  {deptModal.mode === 'add' ? 'إضافة القسم' : 'نقل السلبية'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
