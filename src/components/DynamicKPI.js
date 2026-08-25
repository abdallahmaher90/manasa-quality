'use client'

import React, { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line
} from 'recharts'

function normalizeArabicName(name) {
  if (!name) return ''
  return name
    .replace(/(مستشفى|مستشفي|مركز|طب|أسرة|اسرة|المركزي|العام|التخصصي|الجامعي|التعليمي)/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ي/g, 'ى')
    .replace(/[^ا-يa-zA-Z0-9]/g, '')
    .trim()
}

export default function DynamicKPI({ data, hospitalName = null }) {
  const processedData = useMemo(() => {
    if (!data || data.length === 0) return { format: 'none', rows: [] }

    // Normalize keys in all rows to be lowercase and trimmed
    const normalizedData = data.map(row => {
      const newRow = {}
      for (const [key, val] of Object.entries(row)) {
        newRow[key.trim().toLowerCase()] = typeof val === 'string' ? val.trim() : val
      }
      return newRow
    })

    const firstRowKeys = Object.keys(normalizedData[0] || {})
    const isTallFormat = firstRowKeys.includes('indicator') && firstRowKeys.includes('value')

    // 1. Filter by hospital name if provided
    let filteredRows = normalizedData
    if (hospitalName) {
      const normHosp = normalizeArabicName(hospitalName)
      filteredRows = filteredRows.filter(r => {
        if (isTallFormat && r['hospital']) {
          return normalizeArabicName(r['hospital']).includes(normHosp)
        }
        return Object.values(r).some(val => 
          typeof val === 'string' && normalizeArabicName(val).includes(normHosp)
        )
      })
    }

    if (filteredRows.length === 0) return { format: 'none', rows: [] }

    if (isTallFormat) {
      // Find all critical indicators across all months
      const allCritical = filteredRows.filter(r => {
        const level = (r.alert_level || '').trim().toLowerCase()
        return level === 'critical' || level === 'حرج'
      })

      const criticalCounts = {}
      allCritical.forEach(r => {
        const key = (r.indicator || '').trim().toLowerCase()
        criticalCounts[key] = (criticalCounts[key] || 0) + 1
      })

      // Find the latest year and month for this hospital OVERALL
      let maxYear = 0
      let maxMonth = 0
      filteredRows.forEach(r => {
        const y = parseInt(r.year) || 0
        const m = parseInt(r.month) || 0
        if (y > maxYear) { maxYear = y; maxMonth = m }
        else if (y === maxYear && m > maxMonth) { maxMonth = m }
      })

      // Get the critical indicators for the LATEST month and add recurrences
      const latestCritical = allCritical
        .filter(r => parseInt(r.year) === maxYear && parseInt(r.month) === maxMonth)
        .map(item => {
          const key = (item.indicator || '').trim().toLowerCase()
          return { ...item, recurrences: (criticalCounts[key] || 1) - 1 }
        })

      // Get previous months critical indicators and aggregate them
      const previousRows = allCritical.filter(r => {
        const y = parseInt(r.year) || 0
        const m = parseInt(r.month) || 0
        return y < maxYear || (y === maxYear && m < maxMonth)
      })

      const prevCounts = {}
      previousRows.forEach(r => {
        const key = (r.indicator || '').trim().toLowerCase()
        if (!prevCounts[key]) {
          prevCounts[key] = { indicator: r.indicator, count: 0, months: [] }
        }
        prevCounts[key].count++
        const monthStr = `${r.month}/${r.year}`
        if (!prevCounts[key].months.includes(monthStr)) {
          prevCounts[key].months.push(monthStr)
        }
      })

      // Take only the repeated ones from previous months
      const repeatedPrevious = Object.values(prevCounts)
        .filter(item => item.count > 1)
        .sort((a, b) => b.count - a.count)

      return { format: 'tall', maxYear, maxMonth, latestCritical, repeatedPrevious }
    }

    // --- Legacy "Wide" Format Handling ---
    const keys = Object.keys(filteredRows[0]).filter(k => k !== '')
    const numericKeys = []
    const stringKeys = []

    keys.forEach(k => {
      const val = filteredRows.find(r => r[k] !== null && r[k] !== undefined)?.[k]
      if (typeof val === 'number') {
        numericKeys.push(k)
      } else {
        stringKeys.push(k)
      }
    })

    return { format: 'wide', rows: filteredRows, numericKeys, stringKeys }
  }, [data, hospitalName])

  if (!data || data.length === 0) {
    return <div className="empty-state">لم يتم ربط شيت جوجل بعد أو لا توجد بيانات.</div>
  }

  if (processedData.format === 'none') {
    return (
      <div className="empty-state">
        لا توجد بيانات لهذا المستشفى في الشيت المربوط.
      </div>
    )
  }

  if (processedData.format === 'tall') {
    const { maxYear, maxMonth, latestCritical, repeatedPrevious } = processedData
    
    if (latestCritical.length === 0 && repeatedPrevious.length === 0) {
      return (
        <div className="empty-state" style={{ color: 'var(--success)' }}>
          ✅ لا توجد أي مؤشرات حرجة مسجلة لهذا المستشفى. جميع المؤشرات مستقرة.
        </div>
      )
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2xl)' }}>
        
        {/* Latest Month Criticals */}
        {latestCritical.length > 0 ? (
          <div>
            <h4 style={{ color: 'var(--danger)', marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 18 }}>
              <span>🚨</span> مؤشرات حرجة - شهر {maxMonth} ({maxYear})
            </h4>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'right' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 8px' }}>المؤشر الحرج</th>
                    <th style={{ padding: '12px 8px', textAlign: 'center' }}>تكرار سابق</th>
                    <th style={{ padding: '12px 8px', textAlign: 'center' }}>القيمة الحالية</th>
                  </tr>
                </thead>
                <tbody>
                  {latestCritical.map((item, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                      <td style={{ padding: '12px 8px', fontWeight: 700, color: 'var(--text-main)' }}>
                        {item.indicator}
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                        {item.recurrences > 0 ? (
                          <span style={{ fontSize: 11, background: '#fee2e2', color: '#b91c1c', padding: '4px 8px', borderRadius: 100, fontWeight: 600 }}>
                            ⚠️ تكرر {item.recurrences} مرة
                          </span>
                        ) : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'center', fontSize: 16, fontWeight: 800, color: 'var(--danger)' }}>
                        {item.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="empty-state" style={{ color: 'var(--success)', padding: 'var(--space-md)' }}>
            ✅ لا توجد أي مؤشرات حرجة في شهر {maxMonth}.
          </div>
        )}

        {/* Previous Months (Repeated Only) */}
        {repeatedPrevious.length > 0 && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-xl)' }}>
            <h3 style={{ fontSize: 16, marginBottom: 'var(--space-md)', color: 'var(--text-secondary)' }}>
              🕒 الشهور السابقة (المؤشرات المتكررة فقط)
            </h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'right' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 8px' }}>المؤشر المتكرر</th>
                    <th style={{ padding: '12px 8px' }}>شهور الظهور</th>
                    <th style={{ padding: '12px 8px', textAlign: 'center' }}>إجمالي التكرار</th>
                  </tr>
                </thead>
                <tbody>
                  {repeatedPrevious.map((item, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                      <td style={{ padding: '12px 8px', fontWeight: 700, color: 'var(--text-main)' }}>
                        {item.indicator}
                      </td>
                      <td style={{ padding: '12px 8px', color: 'var(--text-muted)', direction: 'ltr', textAlign: 'right' }}>
                        {item.months.join(' ، ')}
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--warning-dark)', background: '#fef3c7', padding: '4px 8px', borderRadius: 100 }}>
                          {item.count} مرات
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    )
  }

  // --- Legacy Wide Format Render ---
  const { rows, numericKeys, stringKeys } = processedData
  const xAxisKey = stringKeys.find(k => k.toLowerCase().includes('تاريخ') || k.toLowerCase().includes('شهر') || k.toLowerCase().includes('date') || k.toLowerCase().includes('month')) || stringKeys[0]
  const latestRow = rows[rows.length - 1]
  const COLORS = ['var(--primary)', 'var(--accent)', 'var(--warning)', 'var(--danger)', '#8b5cf6', '#10b981']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2xl)' }}>
      {numericKeys.length > 0 && (
        <div>
          <h3 style={{ marginBottom: 'var(--space-md)', fontSize: 16 }}>مؤشرات الشهر الأخير</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'right' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 8px' }}>المؤشر</th>
                  <th style={{ padding: '12px 8px', textAlign: 'center' }}>القيمة</th>
                </tr>
              </thead>
              <tbody>
                {numericKeys.map((key, i) => (
                  <tr key={key} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 8px', fontWeight: 600 }}>{key}</td>
                    <td style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 800, color: COLORS[i % COLORS.length] }}>
                      {latestRow[key]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
