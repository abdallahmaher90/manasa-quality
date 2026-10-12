'use client'

import { useState, Fragment } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/Toast'
import { generateReportDocxBlob } from '@/lib/docx-generator'


export default function ReportAssistantPage() {
  const { showToast } = useToast()
  const [rawText, setRawText] = useState('')
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [reportData, setReportData] = useState(null)

  const handleFormatReport = async () => {
    if (!rawText || rawText.trim().length < 15) {
      showToast('يرجى لصق نص أو مسودة التقرير أولاً', 'error')
      return
    }

    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/report-assistant/format', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': session ? `Bearer ${session.access_token}` : ''
        },
        body: JSON.stringify({ text: rawText })
      })

      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'فشل في تنسيق التقرير')
      }

      setReportData(json.data)
      showToast('تم تنسيق التقرير وتوليد الإجراءات التصحيحية بنجاح!', 'success')
    } catch (err) {
      console.error('Error formatting report:', err)
      showToast(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleDownloadDocx = async () => {
    if (!reportData) return
    setDownloading(true)
    try {
      const blob = await generateReportDocxBlob(reportData)
      const fileName = `${reportData.hospital_name || 'تقرير_مرور'}_${(reportData.inspection_date || '').replace(/[\/\\:]/g, '-') || 'جديد'}.docx`
      
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      showToast('تم تنزيل ملف Word (DOCX) بنجاح!', 'success')
    } catch (err) {
      console.error('Download error:', err)
      showToast('فشل في تنزيل ملف Word: ' + err.message, 'error')
    } finally {
      setDownloading(false)
    }
  }

  const handleCopyToClipboard = async () => {
    if (!reportData) return
    try {
      // Build HTML string for direct Word pasting
      let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">`
      html += `<head><meta charset="utf-8"></head><body dir="rtl" style="font-family: Arial, sans-serif;">`
      html += `<p style="font-weight: bold; font-size: 14pt;">محافظة :- ${reportData.governorate}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;اسم المنشأة :- ${reportData.hospital_name}</p>`
      html += `<p style="font-weight: bold; font-size: 14pt;">القائم بالمرور : ${reportData.inspector_name}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;التاريخ : ${reportData.inspection_date}</p>`
      html += `<table border="1" style="width: 100%; border-collapse: collapse; text-align: right; direction: rtl;">`
      html += `<tr style="background-color: #f1f5f9; font-weight: bold; text-align: center;">`
      html += `<th style="padding: 8px;">مدة التنفيذ</th><th style="padding: 8px;">المسئول عنة</th><th style="padding: 8px;">الاجراء التصحيحي</th><th style="padding: 8px;">بيان عدم التطابق</th><th style="padding: 8px;">م</th>`
      html += `</tr>`

      let serial = 1
      reportData.departments?.forEach(d => {
        html += `<tr style="background-color: #e2e8f0; font-weight: bold;"><td colspan="5" style="padding: 8px; text-align: right;">${d.name}</td></tr>`
        d.findings?.forEach(f => {
          html += `<tr>`
          html += `<td style="padding: 6px; text-align: center;">${f.deadline || 'يوم'}</td>`
          html += `<td style="padding: 6px; text-align: center;">${f.responsible || 'الفريق الطبي'}</td>`
          html += `<td style="padding: 6px;">${f.corrective_action || '-'}</td>`
          html += `<td style="padding: 6px;">${f.defect || '-'}</td>`
          html += `<td style="padding: 6px; text-align: center;">${serial++}</td>`
          html += `</tr>`
        })
      })

      html += `</table>`
      html += `<p style="margin-top: 30px; font-weight: bold;">مدير ادارة سلامة المرضى&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;وكيل الوزارة</p>`
      html += `<p style="font-weight: bold;">د\\ هدير محمد شلبي&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;د\\ محمد ابوالسعد</p>`
      html += `</body></html>`

      const blobHtml = new Blob([html], { type: 'text/html' })
      const blobText = new Blob([rawText], { type: 'text/plain' })
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': blobHtml,
          'text/plain': blobText
        })
      ])
      showToast('تم نسخ الجدول! يمكنك لصقه مباشرة في برنامج Word', 'success')
    } catch (e) {
      showToast('تم نسخ النص، يرجى التنزيل كملف Word للحصول على التنسيق الكامل', 'info')
    }
  }

  // Mutators for live editing
  const updateMeta = (field, val) => {
    setReportData(prev => ({ ...prev, [field]: val }))
  }

  const updateFinding = (dIdx, fIdx, field, val) => {
    const updated = { ...reportData }
    updated.departments[dIdx].findings[fIdx][field] = val
    setReportData(updated)
  }

  const deleteFinding = (dIdx, fIdx) => {
    const updated = { ...reportData }
    updated.departments[dIdx].findings.splice(fIdx, 1)
    if (updated.departments[dIdx].findings.length === 0) {
      updated.departments.splice(dIdx, 1)
    }
    setReportData(updated)
    showToast('تم حذف البند', 'info')
  }

  const addFinding = (dIdx) => {
    const updated = { ...reportData }
    updated.departments[dIdx].findings.push({
      defect: 'سلبية جديدة',
      corrective_action: 'إجراء تصحيحي',
      responsible: 'الفريق الطبي',
      deadline: 'يوم'
    })
    setReportData(updated)
  }

  const addDepartment = () => {
    const name = window.prompt('أدخل اسم القسم الجديد:')
    if (!name || !name.trim()) return
    const updated = { ...reportData }
    updated.departments.push({
      name: name.trim(),
      findings: [
        {
          defect: '',
          corrective_action: '',
          responsible: 'الفريق الطبي',
          deadline: 'يوم'
        }
      ]
    })
    setReportData(updated)
  }

  const totalFindingsCount = reportData?.departments?.reduce((acc, d) => acc + (d.findings?.length || 0), 0) || 0

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            📊 مساعد كتابة وتنسيق التقارير <span style={{ fontSize: 13, background: 'var(--primary-glow)', color: 'var(--primary)', padding: '2px 10px', borderRadius: 100, fontWeight: 700 }}>خاص بفني الإحصاء والمديرية</span>
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '6px 0 0 0' }}>
            الصق نصوص وملاحظات المرور الخام كما وردت من المراقبين؛ وسيقوم النظام فوراً بتنظيمها وصياغة الإجراءات التصحيحية والمسؤول والمهلة وتجهيز ملف Word مطابق للنموذج الوزاري المعتمد.
          </p>
        </div>
      </div>

      {/* Info Alert */}
      <div className="alert alert-info" style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 16px', borderRadius: 'var(--radius-sm)' }}>
        <span style={{ fontSize: 18 }}>💡</span>
        <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          <strong>تنبيه تشغيلي:</strong> هذا القسم مخصص لتسهيل كتابة وتنسيق ملفات Word وتحميلها مباشرة. لا يتم حفظ التقرير في قاعدة البيانات ولا يتم احتسابه في سلبيات المستشفيات، مما يتيح لك صياغة أي عدد من التقارير وتنزيلها بكل حرية.
        </div>
      </div>

      {/* Step 1: Input Box */}
      {!reportData && (
        <div className="card" style={{ padding: 24 }}>
          <div style={{ marginBottom: 12 }}>
            <label className="form-label" style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>
              📝 الصق نص أو مسودة التقرير هنا:
            </label>
          </div>

          <textarea
            className="form-textarea"
            placeholder="الصق نص أو مسودة التقرير هنا..."
            rows={14}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            style={{
              width: '100%',
              fontSize: 14,
              lineHeight: 1.7,
              direction: 'rtl',
              background: '#ffffff',
              border: '1.5px solid #cbd5e1',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 16px',
              fontFamily: 'inherit',
              color: '#0f172a'
            }}
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            {rawText && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setRawText('')}
                disabled={loading}
              >
                مسح النص
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleFormatReport}
              disabled={loading || !rawText.trim()}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 24px', fontSize: 15, fontWeight: 800 }}
            >
              {loading ? (
                <>
                  <div className="loading-spinner" style={{ width: 16, height: 16 }} />
                  <span>جاري قراءة الملاحظات وصياغة الجدول...</span>
                </>
              ) : (
                <>
                  <span>✨</span>
                  <span>توليد وتنسيق جدول التقرير بالذكاء الاصطناعي</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Formatted Report & Editable Table Preview */}
      {reportData && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {/* Action Toolbar */}
          <div className="card" style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, background: 'var(--bg-secondary)', border: '1.5px solid var(--primary-glow)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span className="badge badge-success" style={{ fontSize: 13, padding: '6px 12px' }}>
                ✅ تم تنسيق {totalFindingsCount} سلبية في {reportData.departments?.length || 0} أقسام
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleDownloadDocx}
                disabled={downloading}
                className="btn btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 14, padding: '8px 18px', background: '#16a34a', borderColor: '#16a34a' }}
              >
                <span>📥</span>
                <span>{downloading ? 'جاري إنشاء الملف...' : 'تحميل ملف Word (DOCX)'}</span>
              </button>

              <button
                type="button"
                onClick={handleCopyToClipboard}
                className="btn btn-secondary"
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13 }}
                title="نسخ الجدول بتنسيقه ولصقه مباشرة في Word"
              >
                <span>📋</span>
                <span>نسخ لـ Word</span>
              </button>

              <button
                type="button"
                onClick={() => setReportData(null)}
                className="btn btn-outline"
                style={{ fontSize: 13 }}
              >
                ✏️ إدخال تقرير جديد
              </button>
            </div>
          </div>

          {/* Report Metadata Header (Editable) */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-muted)', marginBottom: 12 }}>
              🏢 ترويسة التقرير الرسمية (يمكنك التعديل مباشرة قبل التنزيل):
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>اسم المنشأة / المستشفى</label>
                <input
                  type="text"
                  className="input"
                  value={reportData.hospital_name || ''}
                  onChange={(e) => updateMeta('hospital_name', e.target.value)}
                  style={{ width: '100%', fontWeight: 700, fontSize: 14 }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>المحافظة</label>
                <input
                  type="text"
                  className="input"
                  value={reportData.governorate || ''}
                  onChange={(e) => updateMeta('governorate', e.target.value)}
                  style={{ width: '100%', fontWeight: 700, fontSize: 14 }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>القائم بالمرور</label>
                <input
                  type="text"
                  className="input"
                  value={reportData.inspector_name || ''}
                  onChange={(e) => updateMeta('inspector_name', e.target.value)}
                  style={{ width: '100%', fontWeight: 700, fontSize: 14 }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>تاريخ المرور</label>
                <input
                  type="text"
                  className="input"
                  value={reportData.inspection_date || ''}
                  onChange={(e) => updateMeta('inspection_date', e.target.value)}
                  style={{ width: '100%', fontWeight: 700, fontSize: 14 }}
                />
              </div>
            </div>
          </div>

          {/* Table Preview & Live Editor */}
          <div className="card" style={{ padding: 20, overflowX: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>
                📋 جدول التقرير (معاينة حية ومطابقة لملف Word):
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={addDepartment}
                style={{ fontSize: 12, border: '1.5px dashed var(--primary)', color: 'var(--primary)', fontWeight: 700 }}
              >
                ➕ إضافة قسم جديد
              </button>
            </div>

            <table style={{ width: '100%', minWidth: '920px', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 13.5, textAlign: 'right', direction: 'rtl', border: '1px solid #cbd5e1', background: '#ffffff' }}>
              <thead>
                <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #94a3b8', fontWeight: 800, textAlign: 'center', color: '#1e293b' }}>
                  <th style={{ padding: '12px 6px', width: '45px', border: '1px solid #cbd5e1' }}>م</th>
                  <th style={{ padding: '12px 10px', width: '36%', border: '1px solid #cbd5e1', textAlign: 'right' }}>بيان عدم التطابق (السلبيات)</th>
                  <th style={{ padding: '12px 10px', width: '35%', border: '1px solid #cbd5e1', textAlign: 'right' }}>الاجراء التصحيحي المقترح</th>
                  <th style={{ padding: '12px 8px', width: '15%', border: '1px solid #cbd5e1' }}>المسئول عنة</th>
                  <th style={{ padding: '12px 8px', width: '14%', border: '1px solid #cbd5e1' }}>مدة التنفيذ</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let serial = 1
                  return reportData.departments?.map((dept, dIdx) => (
                    <Fragment key={dIdx}>
                      {/* Department Row */}
                      <tr style={{ background: '#e2e8f0', borderTop: '2px solid #94a3b8', borderBottom: '2px solid #94a3b8' }}>
                        <td colSpan={5} style={{ padding: '10px 14px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                              <span style={{ fontSize: 18 }}>🏨</span>
                              <input
                                type="text"
                                value={dept.name}
                                onChange={(e) => {
                                  const updated = { ...reportData }
                                  updated.departments[dIdx].name = e.target.value
                                  setReportData(updated)
                                }}
                                placeholder="اسم القسم..."
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  borderBottom: '1.5px dashed #64748b',
                                  fontWeight: 800,
                                  fontSize: 15,
                                  color: '#0f172a',
                                  outline: 'none',
                                  padding: '2px 6px',
                                  minWidth: 220
                                }}
                              />
                              <span style={{ fontSize: 12, background: '#cbd5e1', color: '#334155', padding: '3px 10px', borderRadius: 100, fontWeight: 700, whiteSpace: 'nowrap' }}>
                                {dept.findings?.length || 0} سلبية
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => addFinding(dIdx)}
                              style={{
                                background: '#ffffff',
                                border: '1.5px solid #0284c7',
                                color: '#0284c7',
                                borderRadius: 6,
                                padding: '5px 12px',
                                fontSize: 12.5,
                                cursor: 'pointer',
                                fontWeight: 700,
                                whiteSpace: 'nowrap',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4
                              }}
                            >
                              <span>➕</span>
                              <span>سلبية في هذا القسم</span>
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Findings Rows */}
                      {dept.findings?.map((f, fIdx) => (
                        <tr key={fIdx} style={{ borderBottom: '1px solid #e2e8f0', background: fIdx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                          {/* م */}
                          <td style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 800, color: '#64748b', border: '1px solid #e2e8f0', verticalAlign: 'top', paddingTop: 14 }}>
                            {serial++}
                          </td>

                          {/* بيان عدم التطابق */}
                          <td style={{ padding: '8px', border: '1px solid #e2e8f0', verticalAlign: 'top' }}>
                            <textarea
                              rows={3}
                              value={f.defect}
                              onChange={(e) => updateFinding(dIdx, fIdx, 'defect', e.target.value)}
                              style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                fontSize: 13,
                                lineHeight: '1.5',
                                border: '1px solid #cbd5e1',
                                borderRadius: 6,
                                padding: '6px 8px',
                                background: '#ffffff',
                                resize: 'vertical',
                                fontFamily: 'inherit',
                                outline: 'none',
                                color: '#1e293b'
                              }}
                              placeholder="بيان عدم التطابق (السلبيات)..."
                            />
                          </td>

                          {/* الاجراء التصحيحي */}
                          <td style={{ padding: '8px', border: '1px solid #e2e8f0', verticalAlign: 'top' }}>
                            <textarea
                              rows={3}
                              value={f.corrective_action}
                              onChange={(e) => updateFinding(dIdx, fIdx, 'corrective_action', e.target.value)}
                              style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                fontSize: 13,
                                lineHeight: '1.5',
                                border: '1px solid #a7f3d0',
                                borderRadius: 6,
                                padding: '6px 8px',
                                background: '#f0fdf4',
                                resize: 'vertical',
                                fontFamily: 'inherit',
                                outline: 'none',
                                color: '#065f46',
                                fontWeight: 600
                              }}
                              placeholder="الإجراء التصحيحي المقترح..."
                            />
                          </td>

                          {/* المسئول عنه */}
                          <td style={{ padding: '8px 6px', textAlign: 'center', border: '1px solid #e2e8f0', verticalAlign: 'top', paddingTop: 12 }}>
                            <input
                              type="text"
                              value={f.responsible}
                              onChange={(e) => updateFinding(dIdx, fIdx, 'responsible', e.target.value)}
                              style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                fontSize: 12.5,
                                textAlign: 'center',
                                border: '1px solid #cbd5e1',
                                borderRadius: 6,
                                padding: '6px 4px',
                                background: '#ffffff',
                                fontWeight: 600,
                                color: '#1e293b'
                              }}
                              placeholder="المسؤول..."
                            />
                          </td>

                          {/* مدة التنفيذ وحذف */}
                          <td style={{ padding: '8px 6px', textAlign: 'center', border: '1px solid #e2e8f0', verticalAlign: 'top', paddingTop: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                              <input
                                type="text"
                                value={f.deadline}
                                onChange={(e) => updateFinding(dIdx, fIdx, 'deadline', e.target.value)}
                                style={{
                                  width: '100%',
                                  maxWidth: 75,
                                  boxSizing: 'border-box',
                                  fontSize: 12,
                                  textAlign: 'center',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: 6,
                                  padding: '6px 4px',
                                  background: '#ffffff',
                                  fontWeight: 700,
                                  color: '#0f172a'
                                }}
                                placeholder="المدة..."
                              />
                              <button
                                type="button"
                                onClick={() => deleteFinding(dIdx, fIdx)}
                                style={{
                                  border: 'none',
                                  background: '#fee2e2',
                                  color: '#b91c1c',
                                  borderRadius: 4,
                                  padding: '4px 6px',
                                  cursor: 'pointer',
                                  fontSize: 12,
                                  fontWeight: 800,
                                  lineHeight: 1
                                }}
                                title="حذف هذه السلبية"
                              >
                                ✕
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))
                })()}
              </tbody>
            </table>

            {/* Footer Signatures Preview */}
            <div style={{ marginTop: 24, padding: '16px 20px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 800 }}>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>مدير إدارة سلامة المرضى</div>
                <div style={{ fontSize: 15, color: 'var(--text-primary)', marginTop: 4 }}>د/ هدير محمد شلبي</div>
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>وكيل الوزارة</div>
                <div style={{ fontSize: 15, color: 'var(--text-primary)', marginTop: 4 }}>د/ محمد ابوالسعد</div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
              <button
                type="button"
                onClick={handleDownloadDocx}
                disabled={downloading}
                className="btn btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 15, padding: '10px 24px', background: '#16a34a', borderColor: '#16a34a' }}
              >
                <span>📥</span>
                <span>{downloading ? 'جاري تجهيز الملف...' : 'تحميل ملف Word (DOCX)'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
