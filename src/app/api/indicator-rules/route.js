import { createServiceClient } from '@/lib/supabase'
import { fetchGoogleSheetData, invalidateGoogleSheetCache } from '@/lib/google-sheets'
import { INDICATOR_DOMAINS, processIndicatorRuleRow } from '@/lib/indicator-rules-metadata'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const forceRefresh = searchParams.get('refresh') === 'true'

    const supabase = createServiceClient()

    // 1. Fetch Google Sheet URL from settings
    const { data: settingData } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'google_sheet_url')
      .single()

    const sheetUrl = settingData?.value || 'https://docs.google.com/spreadsheets/d/116vztMuBYo2Hc8hCYjkOVDGjx-gol-_LYZGIYhVapK4/edit?usp=sharing'

    if (forceRefresh) {
      invalidateGoogleSheetCache(sheetUrl, 'Indicator_Rules')
    }

    // 2. Fetch raw sheet data for 'Indicator_Rules'
    const rawRows = await fetchGoogleSheetData(sheetUrl, forceRefresh, 'Indicator_Rules')

    if (!rawRows || rawRows.length === 0) {
      return Response.json({
        success: false,
        error: 'تعذر جلب بيانات حدود المؤشرات من شيت جوجل، يرجى التأكد من الرابط والصلاحيات.'
      }, { status: 502 })
    }

    // 3. Process and enrich indicators
    const rules = rawRows.map((row, idx) => processIndicatorRuleRow(row, idx + 1))

    // 4. Calculate domain counts and summary statistics
    const domainCounts = {}
    INDICATOR_DOMAINS.forEach(d => {
      domainCounts[d.id] = {
        ...d,
        count: 0
      }
    })

    let higherCount = 0
    let lowerCount = 0
    let rangeCount = 0
    let departmentSpecificCount = 0
    let generalCount = 0

    rules.forEach(r => {
      if (domainCounts[r.domainId]) {
        domainCounts[r.domainId].count++
      }
      if (r.direction === 'higher') higherCount++
      else if (r.direction === 'lower') lowerCount++
      else if (r.direction === 'range') rangeCount++

      if (r.isGeneral) generalCount++
      else departmentSpecificCount++
    })

    return Response.json({
      success: true,
      updatedAt: new Date().toISOString(),
      stats: {
        total: rules.length,
        higherCount,
        lowerCount,
        rangeCount,
        generalCount,
        departmentSpecificCount,
        domainsCount: INDICATOR_DOMAINS.length
      },
      domains: Object.values(domainCounts),
      rules
    })
  } catch (error) {
    console.error('Error in /api/indicator-rules:', error)
    return Response.json({
      success: false,
      error: error.message || 'حدث خطأ داخلي أثناء جلب حدود وقواعد المؤشرات'
    }, { status: 500 })
  }
}

