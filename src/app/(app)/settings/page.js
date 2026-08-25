'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function SettingsPage() {
  const [sheetUrl, setSheetUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetchSettings()
  }, [])

  async function fetchSettings() {
    const { data } = await supabase.from('settings').select('value').eq('key', 'google_sheet_url').single()
    if (data) setSheetUrl(data.value)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      const { error } = await supabase.from('settings').upsert({
        key: 'google_sheet_url',
        value: sheetUrl
      }, { onConflict: 'key' })
      
      if (error) throw error
      setMessage('✅ تم حفظ الإعدادات بنجاح')
    } catch (err) {
      setMessage('❌ خطأ أثناء الحفظ: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', paddingTop: 'var(--space-2xl)' }}>
      <h1 className="mb-lg" style={{ fontSize: 24, fontWeight: 800 }}>إعدادات النظام</h1>
      
      <div className="card">
        <h2 className="card-title mb-md">🔗 ربط مؤشرات الأداء (Google Sheets)</h2>
        <p className="mb-md" style={{ color: 'var(--text-muted)' }}>
          ضع هنا رابط ملف جوجل شيت الخاص بالمستشفيات (Google Sheet URL).
          <br/>
          <strong>كيفية الحصول على الرابط:</strong> اضغط على زر <strong>Share (مشاركة)</strong> في أعلى يمين الملف، وتأكد أن الصلاحية هي <strong>Anyone with the link (أي شخص لديه الرابط)</strong>، ثم انسخ الرابط وضعه هنا.
        </p>

        <form onSubmit={handleSave}>
          <div className="form-group">
            <label className="form-label">رابط جوجل شيت (Google Sheet URL)</label>
            <input 
              type="url"
              className="form-input"
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs.../edit?usp=sharing"
              dir="ltr"
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'جاري الحفظ...' : 'حفظ الرابط'}
          </button>
        </form>

        {message && (
          <div style={{ marginTop: 'var(--space-md)', padding: 'var(--space-sm)', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
            {message}
          </div>
        )}
      </div>
    </div>
  )
}
