'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export default function BulkUpload({ hospitalsList = [] }) {
  const [fileList, setFileList] = useState([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isCancelled, setIsCancelled] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [currentStepMessage, setCurrentStepMessage] = useState('')
  const [filter, setFilter] = useState('all') // 'all' | 'saved' | 'skipped' | 'error'
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)
  const cancelRef = useRef(false)

  // Handle files selection
  const handleFilesAdded = (newFiles) => {
    if (!newFiles || newFiles.length === 0) return

    const validExtensions = ['docx', 'pdf', 'txt']
    const addedItems = []

    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i]
      const ext = file.name.split('.').pop().toLowerCase()
      if (!validExtensions.includes(ext)) continue

      // Avoid adding exact duplicate file in current queue
      const alreadyInList = fileList.some(item => item.name === file.name && item.size === file.size)
      if (!alreadyInList) {
        addedItems.push({
          id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
          file,
          name: file.name,
          size: file.size,
          ext,
          status: 'pending', // 'pending' | 'extracting' | 'parsing' | 'saving' | 'saved' | 'skipped' | 'error'
          hospitalName: '',
          inspectionDate: '',
          hospitalId: null,
          reportId: null,
          existingReportId: null,
          findingsCount: 0,
          departmentsCount: 0,
          message: 'في انتظار البدء',
          error: null
        })
      }
    }

    if (addedItems.length > 0) {
      setFileList(prev => [...prev, ...addedItems])
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer?.files) {
      handleFilesAdded(e.dataTransfer.files)
    }
  }

  const removeFile = (id) => {
    if (isProcessing) return
    setFileList(prev => prev.filter(f => f.id !== id))
  }

  const clearAllFiles = () => {
    if (isProcessing) return
    setFileList([])
    setCurrentIndex(-1)
    setCurrentStepMessage('')
  }

  // Extract text from file
  const extractTextFromFile = async (file) => {
    const ext = file.name.split('.').pop().toLowerCase()
    if (ext === 'txt') {
      return await file.text()
    }
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch('/api/extract-text', { method: 'POST', body: formData })
    const data = await res.json()
    if (!res.ok || data.error) {
      throw new Error(data.error || 'فشل في استخراج النص من الملف')
    }
    return data.text
  }

  // Process a single file item
  const processSingleFile = async (item, sessionToken) => {
    // 1. Text extraction
    item.status = 'extracting'
    item.message = 'جاري استخراج النص...'
    setFileList(prev => prev.map(f => f.id === item.id ? { ...item } : f))
    setCurrentStepMessage(`جاري قراءة محتوى الملف: ${item.name}`)

    const text = await extractTextFromFile(item.file)
    if (!text || text.trim().length < 50) {
      throw new Error('محتوى التقرير قصير جداً أو فارغ')
    }

    if (cancelRef.current) return

    // 2. AI Parsing & Duplicate Check
    item.status = 'parsing'
    item.message = 'جاري التحليل بالذكاء الاصطناعي وفحص الأرشيف...'
    setFileList(prev => prev.map(f => f.id === item.id ? { ...item } : f))
    setCurrentStepMessage(`جاري تحليل التقرير وفحص التكرار: ${item.name}`)

    const parseRes = await fetch('/api/parse-report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`
      },
      body: JSON.stringify({
        text,
        skipDuplicateError: true // Tells API to return duplicate status cleanly instead of throwing 409
      })
    })

    const parseData = await parseRes.json()

    if (!parseRes.ok && parseRes.status === 409) {
      // Duplicate report
      item.status = 'skipped'
      item.message = parseData.error || 'موجود مسبقاً في الأرشيف (تم تخطيه تلقائياً)'
      return
    }

    if (!parseRes.ok || parseData.error) {
      throw new Error(parseData.error || 'فشل في تحليل التقرير بالذكاء الاصطناعي')
    }

    const { result, hospitalId, isDuplicate, existingReportId } = parseData
    item.hospitalName = result?.hospital_name || 'غير محدد'
    item.inspectionDate = result?.inspection_date || 'غير محدد'
    item.hospitalId = hospitalId
    item.existingReportId = existingReportId

    // Check if duplicate was detected
    if (isDuplicate) {
      item.status = 'skipped'
      item.message = `موجود مسبقاً في الأرشيف (${item.hospitalName} - ${item.inspectionDate})`
      setFileList(prev => prev.map(f => f.id === item.id ? { ...item } : f))
      return
    }

    if (cancelRef.current) return

    // 3. Save Report Automatically
    item.status = 'saving'
    item.message = 'جاري حفظ التقرير والسلبيات في الأرشيف...'
    setFileList(prev => prev.map(f => f.id === item.id ? { ...item } : f))
    setCurrentStepMessage(`جاري حفظ التقرير الناقص: ${item.hospitalName}`)

    // Optional upload file to storage
    let fileUrl = null
    try {
      if (hospitalId) {
        const fileExt = item.file.name.split('.').pop()
        const reportId = crypto.randomUUID()
        const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
        const filePath = `${hospitalId}/${reportId}/${uniqueName}`
        const { error: uploadError } = await supabase.storage
          .from('reports_files')
          .upload(filePath, item.file)
        if (!uploadError) fileUrl = filePath
      }
    } catch (storageErr) {
      console.warn('Storage upload error (continuing save):', storageErr)
    }

    const saveRes = await fetch('/api/save-report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`
      },
      body: JSON.stringify({
        parsedData: result,
        hospitalId,
        rawText: text,
        fileName: item.file.name,
        fileUrl
      })
    })

    const saveData = await saveRes.json()

    if (!saveRes.ok) {
      if (saveRes.status === 409 || saveData.error?.includes('مسبقاً')) {
        item.status = 'skipped'
        item.message = saveData.error || 'موجود مسبقاً في الأرشيف'
        return
      }
      throw new Error(saveData.error || 'فشل في حفظ التقرير في قاعدة البيانات')
    }

    const findingsCount = result.departments?.reduce((acc, d) => acc + (d.findings?.length || 0), 0) || 0
    const deptsCount = result.departments?.length || 0

    item.status = 'saved'
    item.reportId = saveData.reportId
    item.hospitalId = saveData.hospitalId || hospitalId
    item.findingsCount = findingsCount
    item.departmentsCount = deptsCount
    item.message = `تمت الإضافة بنجاح (${deptsCount} قسم، ${findingsCount} سلبية)`
    setFileList(prev => prev.map(f => f.id === item.id ? { ...item } : f))
  }

  // Start processing all pending files sequentially
  const startProcessing = async () => {
    if (fileList.length === 0 || isProcessing) return

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      alert('يرجى تسجيل الدخول أولاً')
      return
    }

    setIsProcessing(true)
    setIsCancelled(false)
    cancelRef.current = false

    for (let i = 0; i < fileList.length; i++) {
      if (cancelRef.current) break

      const currentItem = fileList[i]
      // Skip already processed items unless user explicitly re-runs
      if (currentItem.status === 'saved' || currentItem.status === 'skipped') {
        continue
      }

      setCurrentIndex(i)

      try {
        await processSingleFile(currentItem, session.access_token)
      } catch (err) {
        console.error(`Error processing file ${currentItem.name}:`, err)
        currentItem.status = 'error'
        currentItem.error = err.message || 'خطأ غير معروف'
        currentItem.message = `فشل: ${err.message || 'خطأ أثناء المعالجة'}`
      } finally {
        setFileList(prev => prev.map(f => f.id === currentItem.id ? { ...currentItem } : f))
      }
    }

    setIsProcessing(false)
    setCurrentStepMessage('')
    setCurrentIndex(-1)
  }

  const stopProcessing = () => {
    cancelRef.current = true
    setIsCancelled(true)
    setIsProcessing(false)
    setCurrentStepMessage('تم إيقاف المعالجة بطلب من المستخدم.')
  }

  // Counters
  const totalCount = fileList.length
  const savedCount = fileList.filter(f => f.status === 'saved').length
  const skippedCount = fileList.filter(f => f.status === 'skipped').length
  const errorCount = fileList.filter(f => f.status === 'error').length
  const pendingCount = fileList.filter(f => ['pending', 'extracting', 'parsing', 'saving'].includes(f.status)).length
  const finishedCount = savedCount + skippedCount + errorCount
  const progressPercent = totalCount > 0 ? Math.round((finishedCount / totalCount) * 100) : 0

  // Filtered files for display
  const displayedFiles = fileList.filter(item => {
    if (filter === 'saved') return item.status === 'saved'
    if (filter === 'skipped') return item.status === 'skipped'
    if (filter === 'error') return item.status === 'error'
    return true
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
      {/* Intro Box */}
      <div 
        style={{
          background: 'linear-gradient(135deg, rgba(26, 95, 158, 0.08) 0%, rgba(13, 148, 136, 0.08) 100%)',
          border: '1px solid var(--border-accent)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 24px',
          display: 'flex',
          gap: 16,
          alignItems: 'flex-start'
        }}
      >
        <div 
          style={{
            fontSize: 28,
            width: 48,
            height: 48,
            borderRadius: 12,
            background: 'var(--bg-card)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--shadow-sm)',
            flexShrink: 0
          }}
        >
          ⚡
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 6px 0', color: 'var(--text-primary)' }}>
            الرفع الجماعي التلقائي وتقصي النواقص
          </h3>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
            ارفع حزمة تقارير مرة واحدة (Word أو PDF). سيقوم النظام باستخراج المستشفى وتاريخ المرور، والتحقق من التقارير المسجلة بالأرشيف؛ حيث يتم <strong>تخطي التقارير المكررة تلقائياً</strong> وإدراج <strong>التقارير الناقصة وسلبياتها مباشرة بقاعدة البيانات</strong> دون الحاجة لمراجعة يدوية لكل ملف.
          </p>
        </div>
      </div>

      {/* Dropzone & File Selector */}
      <div
        className={`upload-zone ${isDragging ? 'drag-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => !isProcessing && fileInputRef.current?.click()}
        style={{
          cursor: isProcessing ? 'not-allowed' : 'pointer',
          border: isDragging ? '2px dashed var(--primary)' : '2px dashed var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '36px 20px',
          textAlign: 'center',
          background: isDragging ? 'rgba(59, 130, 246, 0.05)' : 'var(--bg-card)',
          transition: 'all 0.2s ease'
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".docx,.pdf,.txt"
          style={{ display: 'none' }}
          disabled={isProcessing}
          onChange={(e) => {
            if (e.target.files) {
              handleFilesAdded(e.target.files)
              e.target.value = ''
            }
          }}
        />

        <div style={{ fontSize: 44, marginBottom: 12 }}>📁</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
          اسحب وأفلت مجموعة تقارير المرور هنا، أو اضغط للاختيار
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
          يدعم رفع عدة ملفات دفعة واحدة بصيغ (DOCX, PDF, TXT)
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <span className="badge badge-primary">📄 Word (.docx)</span>
          <span className="badge badge-primary">📕 PDF (.pdf)</span>
          <span className="badge badge-primary">📝 نصوص (.txt)</span>
        </div>
      </div>

      {/* Queue Header & Actions */}
      {fileList.length > 0 && (
        <div className="card" style={{ padding: '20px 24px' }}>
          {/* Top summary row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                قائمة التقارير المحددة ({fileList.length} ملف)
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                {isProcessing ? 'جاري الفحص والإضافة تلقائياً...' : 'جاهزة لبدء المعالجة والتصنيف التلقائي'}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {!isProcessing ? (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={clearAllFiles}
                    style={{ color: 'var(--danger-light)' }}
                  >
                    🗑️ تفريغ القائمة
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={startProcessing}
                    style={{ fontWeight: 700, padding: '10px 20px', boxShadow: 'var(--shadow-md)' }}
                  >
                    <span>⚡</span> بدء الفحص والإضافة التلقائية (من غير مراجعة)
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={stopProcessing}
                  style={{ fontWeight: 700 }}
                >
                  🛑 إيقاف مؤقت / إلغاء
                </button>
              )}
            </div>
          </div>

          {/* Progress Bar (Visible when processing or finished) */}
          {(isProcessing || finishedCount > 0) && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {isProcessing ? (currentStepMessage || 'جاري المعالجة...') : 'اكتملت معالجة الدفعة'}
                </span>
                <span style={{ color: 'var(--primary-light)', direction: 'ltr' }}>
                  {finishedCount} / {totalCount} ({progressPercent}%)
                </span>
              </div>
              <div style={{ height: 10, borderRadius: 5, background: 'var(--border)', overflow: 'hidden' }}>
                <div 
                  style={{ 
                    height: '100%', 
                    width: `${progressPercent}%`, 
                    background: isProcessing ? 'linear-gradient(90deg, var(--primary) 0%, var(--accent-light) 100%)' : 'var(--success)',
                    transition: 'width 0.3s ease'
                  }} 
                />
              </div>
            </div>
          )}

          {/* KPI Stat Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
            <div style={{ padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>إجمالي الملفات</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>{totalCount}</div>
            </div>

            <div style={{ padding: '12px 16px', background: 'rgba(34, 197, 94, 0.08)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(34, 197, 94, 0.25)' }}>
              <div style={{ fontSize: 12, color: 'var(--success-light)', fontWeight: 600 }}>✅ أضيف للأرشيف (ناقص)</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--success-light)', marginTop: 4 }}>{savedCount}</div>
            </div>

            <div style={{ padding: '12px 16px', background: 'rgba(234, 179, 8, 0.08)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(234, 179, 8, 0.25)' }}>
              <div style={{ fontSize: 12, color: '#ca8a04', fontWeight: 600 }}>⏭️ تخطي (موجود مسبقاً)</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#ca8a04', marginTop: 4 }}>{skippedCount}</div>
            </div>

            <div style={{ padding: '12px 16px', background: 'rgba(239, 68, 68, 0.08)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(239, 68, 68, 0.25)' }}>
              <div style={{ fontSize: 12, color: 'var(--danger-light)', fontWeight: 600 }}>❌ أخطاء / غير مقروء</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--danger-light)', marginTop: 4 }}>{errorCount}</div>
            </div>
          </div>

          {/* Filter Chips */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilter('all')}
            >
              الكل ({fileList.length})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${filter === 'saved' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilter('saved')}
            >
              ✅ المضاف بنجاح ({savedCount})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${filter === 'skipped' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilter('skipped')}
            >
              ⏭️ المتخطى ({skippedCount})
            </button>
            {errorCount > 0 && (
              <button
                type="button"
                className={`btn btn-sm ${filter === 'error' ? 'btn-danger' : 'btn-ghost'}`}
                onClick={() => setFilter('error')}
              >
                ❌ الأخطاء ({errorCount})
              </button>
            )}
          </div>

          {/* Results Table */}
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'right' }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '10px 14px', width: 40 }}>#</th>
                  <th style={{ padding: '10px 14px' }}>اسم الملف</th>
                  <th style={{ padding: '10px 14px' }}>المستشفى المستخرجة</th>
                  <th style={{ padding: '10px 14px' }}>تاريخ المرور</th>
                  <th style={{ padding: '10px 14px' }}>الحالة والنتيجة</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', width: 140 }}>الإجراء</th>
                </tr>
              </thead>
              <tbody>
                {displayedFiles.map((item, idx) => {
                  const isCurrent = isProcessing && fileList[currentIndex]?.id === item.id

                  return (
                    <tr 
                      key={item.id} 
                      style={{ 
                        borderBottom: '1px solid var(--border)',
                        background: isCurrent ? 'rgba(59, 130, 246, 0.07)' : 'transparent',
                        transition: 'background 0.2s'
                      }}
                    >
                      <td style={{ padding: '12px 14px', color: 'var(--text-muted)', fontWeight: 600 }}>
                        {idx + 1}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                          {item.name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {(item.size / 1024).toFixed(1)} KB
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px', fontWeight: 600 }}>
                        {item.hospitalName ? (
                          <span style={{ color: 'var(--text-primary)' }}>{item.hospitalName}</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>-</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        {item.inspectionDate ? (
                          <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{item.inspectionDate}</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>-</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        {item.status === 'pending' && (
                          <span className="badge" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
                            ⏳ في الانتظار
                          </span>
                        )}
                        {item.status === 'extracting' && (
                          <span className="badge badge-primary">
                            📖 قراءة الملف...
                          </span>
                        )}
                        {item.status === 'parsing' && (
                          <span className="badge badge-primary">
                            🤖 تحليل وفحص التكرار...
                          </span>
                        )}
                        {item.status === 'saving' && (
                          <span className="badge" style={{ background: 'rgba(59, 130, 246, 0.15)', color: 'var(--primary-light)' }}>
                            💾 حفظ بالأرشيف...
                          </span>
                        )}
                        {item.status === 'saved' && (
                          <div>
                            <span className="badge badge-success" style={{ fontWeight: 700 }}>
                              ✅ تم الحفظ بالناقص
                            </span>
                            <div style={{ fontSize: 11, color: 'var(--success-light)', marginTop: 4 }}>
                              {item.departmentsCount} قسم • {item.findingsCount} سلبية
                            </div>
                          </div>
                        )}
                        {item.status === 'skipped' && (
                          <div>
                            <span className="badge" style={{ background: 'rgba(234, 179, 8, 0.15)', color: '#ca8a04', fontWeight: 700 }}>
                              ⏭️ متخطى (موجود مسبقاً)
                            </span>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                              التقرير مسجل بالفعل في الأرشيف
                            </div>
                          </div>
                        )}
                        {item.status === 'error' && (
                          <div>
                            <span className="badge badge-danger" style={{ fontWeight: 700 }}>
                              ❌ فشل في المعالجة
                            </span>
                            <div style={{ fontSize: 11, color: 'var(--danger-light)', marginTop: 4, maxWidth: 260 }}>
                              {item.error || item.message}
                            </div>
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        {item.status === 'saved' && (
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                            {item.reportId && (
                              <Link
                                href={`/archive/${item.reportId}`}
                                target="_blank"
                                className="btn btn-ghost btn-sm"
                                style={{ fontSize: 12, padding: '4px 8px', color: 'var(--primary-light)' }}
                                title="عرض التقرير بالأرشيف"
                              >
                                📋 التقرير
                              </Link>
                            )}
                            {item.hospitalId && (
                              <Link
                                href={`/hospitals/${item.hospitalId}`}
                                target="_blank"
                                className="btn btn-ghost btn-sm"
                                style={{ fontSize: 12, padding: '4px 8px' }}
                                title="عرض صفحة المستشفى"
                              >
                                🏥 المستشفى
                              </Link>
                            )}
                          </div>
                        )}

                        {item.status === 'skipped' && (
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                            {item.existingReportId ? (
                              <Link
                                href={`/archive/${item.existingReportId}`}
                                target="_blank"
                                className="btn btn-ghost btn-sm"
                                style={{ fontSize: 12, padding: '4px 8px', color: 'var(--text-secondary)' }}
                                title="عرض التقرير المسجل مسبقاً"
                              >
                                📂 الأرشيف
                              </Link>
                            ) : item.hospitalId ? (
                              <Link
                                href={`/hospitals/${item.hospitalId}`}
                                target="_blank"
                                className="btn btn-ghost btn-sm"
                                style={{ fontSize: 12, padding: '4px 8px' }}
                              >
                                🏥 المستشفى
                              </Link>
                            ) : (
                              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>مكرر</span>
                            )}
                          </div>
                        )}

                        {item.status === 'pending' && !isProcessing && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => removeFile(item.id)}
                            style={{ color: 'var(--danger-light)', fontSize: 13, padding: '2px 8px' }}
                            title="حذف من القائمة"
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Final summary footer */}
          {!isProcessing && finishedCount > 0 && (
            <div 
              style={{
                marginTop: 20,
                padding: '16px 20px',
                background: 'rgba(34, 197, 94, 0.08)',
                border: '1px solid rgba(34, 197, 94, 0.25)',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 12
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                🎉 اكتملت العملية: تمت إضافة <strong>{savedCount}</strong> تقرير ناقص بنجاح، وتخطي <strong>{skippedCount}</strong> تقرير مكرر.
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <Link href="/archive" className="btn btn-primary btn-sm">
                  📂 الانتقال إلى الأرشيف
                </Link>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={clearAllFiles}
                >
                  🔄 رفع دفعة جديدة
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
