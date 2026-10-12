'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/Toast'
import { generateReportDocxBlob } from '@/lib/docx-generator'

const SAMPLE_TEXT = `مرور مستشفى كفر الشيخ العام 
يوم الاحد الموافق ١٢ اكتوبر ٢٠٢٦ 
قسم الأنف والاذن 
لا يوجد تطبيق معايير الوقايه من السقوط عند بعض المرضى 
الثلاجه بالقسم غير مصنفه وغير معرفه 
لا يوجد قائمه محتويات دولاب المستلزمات الطبيه 
بعض المرضى بدون اسورة تعريف 
نموذج التوافق الدوائي غير مفعل 
الوصفه الطبيه غير مكتمله 
نموذج التاريخ المرضي غير مكتمل 

قسم العظام 
بعض الكانيولات بدون تعريف أو بيانات تركيب 
بعض المرضى bed ridden بدون مراتب هوائيه 
المحاليل غير معرفه ببيانات المريض 
بعض المرضى بدون اسورة تعريف نموذج التوافق الدوائي غير مفعل 
الوصفه الدوائيه غير مكتمله 
نموذج progress notes غير مكتمل
لا يوجد التشخيص النهائي على الملف الطبي 
نموذج plan of care غير مفعل 
لا يوجد اماكن حفظ الادويه الخاصة بالمرضى 

العنايه الباطنه المركزه ب 
يوجد علاجات طرف المرضى 
مرضي العنايه بدون اسورة تعريف 
يوجد انسولين مفتوح بدون بيانات 
لا يوجد قائمه بمحتويات الثلاجه 
مخزن المستلزمات غير مصنف وغير معرف 
يوجد علبه بها ادويه ومحاليل وامبولات وأقراص بدون تعريف لكل مريض ولا فصل 
نموذج plan of care غير موجود 
نموذج التسليم والتسلم غير مكتمل 
نموذج متعدد التخصصات غير موجود 
نموذج vte غير موجود 
بعض الحالات عرضه الجلطات لم يتم إعادة تقييم للعرضه للجلطات
لا يوجد قائمه الاختصارات المسموحه والممنوعه 
لا يوجد مرور الصيدلى الإكلينيكية يومى 
الوصفه الدوائيه غير مكتمله البيانات 
القاءم بالمرور 
م.امل صبحى فتحى 
م. نسمه عبد النبي محمد`

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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <label className="form-label" style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>
              📝 الصق نص أو مسودة التقرير هنا:
            </label>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setRawText(SAMPLE_TEXT)}
              style={{ fontSize: 12, border: '1px dashed var(--border)', color: 'var(--primary)', fontWeight: 700 }}
            >
              📋 تجربة بنص تجريبي (مثال كفر الشيخ العام)
            </button>
          </div>

          <textarea
            className="form-textarea"
            placeholder="مثال:
مرور مستشفى كفر الشيخ العام
يوم الأحد الموافق 12 أكتوبر 2026
قسم الأنف والأذن
لا يوجد تطبيق معايير الوقاية من السقوط
الثلاجة بالقسم غير معرفة...

القائم بالمرور:
م. أمل صبحي
م. نسمة عبد النبي"
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

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'right', direction: 'rtl', border: '1px solid var(--border)' }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border)', fontWeight: 800, textAlign: 'center' }}>
                  <th style={{ padding: '10px 6px', width: '5%', border: '1px solid var(--border)' }}>م</th>
                  <th style={{ padding: '10px 8px', width: '33%', border: '1px solid var(--border)', textAlign: 'right' }}>بيان عدم التطابق (السلبيات)</th>
                  <th style={{ padding: '10px 8px', width: '32%', border: '1px solid var(--border)', textAlign: 'right' }}>الاجراء التصحيحي المقترح</th>
                  <th style={{ padding: '10px 8px', width: '18%', border: '1px solid var(--border)' }}>المسئول عنة</th>
                  <th style={{ padding: '10px 8px', width: '12%', border: '1px solid var(--border)' }}>مدة التنفيذ</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let serial = 1
                  return reportData.departments?.map((dept, dIdx) => (
                    <tbody key={dIdx}>
                      {/* Department Row */}
                      <tr style={{ background: '#e2e8f0', border: '1px solid #cbd5e1' }}>
                        <td colSpan={5} style={{ padding: '8px 12px', fontWeight: 800, fontSize: 14, color: '#1e293b' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span>🏨</span>
                              <input
                                type="text"
                                value={dept.name}
                                onChange={(e) => {
                                  const updated = { ...reportData }
                                  updated.departments[dIdx].name = e.target.value
                                  setReportData(updated)
                                }}
                                style={{ background: 'transparent', border: 'none', fontWeight: 800, fontSize: 14, color: '#0f172a', outline: 'none', minWidth: 200 }}
                              />
                              <span style={{ fontSize: 11, background: '#cbd5e1', padding: '2px 8px', borderRadius: 100 }}>
                                {dept.findings?.length || 0} سلبية
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => addFinding(dIdx)}
                              style={{ background: '#ffffff', border: '1px solid #94a3b8', borderRadius: 4, padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 700 }}
                            >
                              ➕ سلبية في هذا القسم
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Findings Rows */}
                      {dept.findings?.map((f, fIdx) => (
                        <tr key={fIdx} style={{ borderBottom: '1px solid var(--border)' }}>
                          {/* م */}
                          <td style={{ padding: '8px 6px', textAlign: 'center', fontWeight: 700, color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                            {serial++}
                          </td>

                          {/* بيان عدم التطابق */}
                          <td style={{ padding: '8px 10px', border: '1px solid var(--border)' }}>
                            <textarea
                              rows={2}
                              value={f.defect}
                              onChange={(e) => updateFinding(dIdx, fIdx, 'defect', e.target.value)}
                              style={{ width: '100%', fontSize: 13, border: '1px solid transparent', background: 'transparent', resize: 'vertical', fontFamily: 'inherit', outline: 'none' }}
                              placeholder="بيان عدم التطابق..."
                            />
                          </td>

                          {/* الاجراء التصحيحي */}
                          <td style={{ padding: '8px 10px', border: '1px solid var(--border)', background: '#f8fafc' }}>
                            <textarea
                              rows={2}
                              value={f.corrective_action}
                              onChange={(e) => updateFinding(dIdx, fIdx, 'corrective_action', e.target.value)}
                              style={{ width: '100%', fontSize: 13, border: '1px solid transparent', background: 'transparent', resize: 'vertical', fontFamily: 'inherit', outline: 'none', color: '#047857', fontWeight: 600 }}
                              placeholder="الإجراء التصحيحي..."
                            />
                          </td>

                          {/* المسئول عنه */}
                          <td style={{ padding: '8px 6px', textAlign: 'center', border: '1px solid var(--border)' }}>
                            <input
                              type="text"
                              value={f.responsible}
                              onChange={(e) => updateFinding(dIdx, fIdx, 'responsible', e.target.value)}
                              style={{ width: '100%', fontSize: 12.5, textAlign: 'center', border: '1px solid #cbd5e1', borderRadius: 4, padding: '4px', background: '#ffffff', fontWeight: 600 }}
                            />
                          </td>

                          {/* مدة التنفيذ وحذف */}
                          <td style={{ padding: '8px 6px', textAlign: 'center', border: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                              <input
                                type="text"
                                value={f.deadline}
                                onChange={(e) => updateFinding(dIdx, fIdx, 'deadline', e.target.value)}
                                style={{ width: 60, fontSize: 12, textAlign: 'center', border: '1px solid #cbd5e1', borderRadius: 4, padding: '4px', background: '#ffffff', fontWeight: 700 }}
                              />
                              <button
                                type="button"
                                onClick={() => deleteFinding(dIdx, fIdx)}
                                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--danger-light)', fontSize: 14 }}
                                title="حذف السلبية"
                              >
                                ✕
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
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
