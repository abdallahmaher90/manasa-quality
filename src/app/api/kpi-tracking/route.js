import { createServiceClient, supabase as supabaseClient } from '@/lib/supabase'
import { fetchGoogleSheetData, invalidateGoogleSheetCache } from '@/lib/google-sheets'
import { findMatchingSheetHospital } from '@/lib/hospital-matcher'

export const dynamic = 'force-dynamic'

const ARABIC_MONTH_NAMES = {
  1: 'يناير',
  2: 'فبراير',
  3: 'مارس',
  4: 'أبريل',
  5: 'مايو',
  6: 'يونيو',
  7: 'يوليو',
  8: 'أغسطس',
  9: 'سبتمبر',
  10: 'أكتوبر',
  11: 'نوفمبر',
  12: 'ديسمبر'
}

async function checkDirectorateAuth(request) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader) return { error: 'Unauthorized', status: 401 }

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token)

  if (authError || !user) {
    return { error: 'غير مصرح لك للقيام بهذه العملية', status: 401 }
  }

  const supabase = createServiceClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, role, hospital_id')
    .eq('id', user.id)
    .single()

  const isDirectorateAdmin = profile?.role === 'directorate_admin'
  if (!isDirectorateAdmin) {
    return { error: 'هذا القسم مخصص لمدير المديرية فقط', status: 403 }
  }

  return { user, profile }
}

export async function GET(request) {
  try {
    const auth = await checkDirectorateAuth(request)
    if (auth.error) {
      return Response.json({ error: auth.error }, { status: auth.status })
    }

    const { searchParams } = new URL(request.url)
    const forceRefresh = searchParams.get('refresh') === 'true'
    const includeCurrentMonth = searchParams.get('includeCurrent') === 'true'
    const requestedYear = parseInt(searchParams.get('year'), 10) || null

    const supabase = createServiceClient()

    // 1. Fetch DB Hospitals
    const { data: dbHospitals, error: hospErr } = await supabase
      .from('hospitals')
      .select('id, name, governorate, director_name, director_phone, quality_head_name, quality_head_phone')
      .order('name')

    if (hospErr) {
      throw new Error('فشل في جلب قائمة المستشفيات من قاعدة البيانات: ' + hospErr.message)
    }

    // 2. Fetch Google Sheet URL from settings
    const { data: settingData, error: setErr } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'google_sheet_url')
      .single()

    if (setErr || !settingData?.value) {
      return Response.json({
        success: false,
        error: 'لم يتم ضبط رابط شيت جوجل في إعدادات النظام بعد.'
      }, { status: 404 })
    }

    const sheetUrl = settingData.value
    if (forceRefresh) {
      invalidateGoogleSheetCache(sheetUrl)
    }

    // 3. Fetch Google Sheet Data
    const allSheetRows = await fetchGoogleSheetData(sheetUrl, forceRefresh)
    if (!allSheetRows || allSheetRows.length === 0) {
      return Response.json({
        success: false,
        error: 'تعذر استرجاع أي بيانات من شيت جوجل، يرجى مراجعة الرابط والتأكد من الصلاحيات.'
      }, { status: 502 })
    }

    // 4. Discover sheet hospitals and years
    const sheetHospitals = [...new Set(allSheetRows.map(r => r.Hospital || r.hospital).filter(Boolean))]
    
    // Find latest year in data or default to current calendar year
    const detectedYears = new Set()
    allSheetRows.forEach(r => {
      const y = parseInt(r.Year || r.year, 10)
      if (y) detectedYears.add(y)
    })
    const sortedYears = Array.from(detectedYears).sort((a, b) => b - a)
    const targetYear = requestedYear || sortedYears[0] || new Date().getFullYear()

    // 5. Determine current date and evaluated months
    const now = new Date()
    const currentCalendarMonth = now.getMonth() + 1 // 1-12
    const currentCalendarYear = now.getFullYear()

    // Month 4 was pilot ("بدأنا تطبيق شهر 4 ولكن احسب من اول شهر 5")
    const START_EVAL_MONTH = 5

    // If target year is current calendar year, the standard due months are from START_EVAL_MONTH up to currentMonth - 1
    // (or up to currentMonth if includeCurrentMonth is true)
    let maxMonthToEvaluate = currentCalendarMonth - 1
    if (targetYear < currentCalendarYear) {
      // Historical year: all 12 months (or months 5-12)
      maxMonthToEvaluate = 12
    } else if (includeCurrentMonth) {
      maxMonthToEvaluate = currentCalendarMonth
    }

    // Ensure we at least have START_EVAL_MONTH if month < 5
    if (maxMonthToEvaluate < START_EVAL_MONTH) {
      maxMonthToEvaluate = START_EVAL_MONTH
    }

    const evaluatedMonths = []
    for (let m = START_EVAL_MONTH; m <= maxMonthToEvaluate; m++) {
      evaluatedMonths.push(m)
    }

    // 6. Map Sheet Data: count indicators per hospital per month for the target year
    // key: `${normSheetHosp}_${month}`
    const submissionCounts = new Map()
    const monthsWithAnyData = new Set()

    allSheetRows.forEach(r => {
      const hosp = (r.Hospital || r.hospital || '').trim()
      const y = parseInt(r.Year || r.year, 10)
      const m = parseInt(r.Month || r.month, 10)
      if (!hosp || y !== targetYear || !m) return

      monthsWithAnyData.add(m)
      const key = `${hosp}_${m}`
      submissionCounts.set(key, (submissionCounts.get(key) || 0) + 1)
    })

    // 7. Match each DB Hospital with Sheet Hospital
    const matchedHospitalRecords = dbHospitals.map(dbH => {
      const matchedSheetName = findMatchingSheetHospital(dbH.name, sheetHospitals)
      return {
        ...dbH,
        matchedSheetName
      }
    })

    // 8. Build Hospital Matrix and Monthly Summaries
    const monthsSummary = {}
    evaluatedMonths.forEach(m => {
      monthsSummary[m] = {
        month: m,
        monthName: ARABIC_MONTH_NAMES[m] || `شهر ${m}`,
        isCurrentMonth: (targetYear === currentCalendarYear && m === currentCalendarMonth),
        registeredCount: 0,
        partialCount: 0,
        missingCount: 0,
        registeredHospitals: [],
        partialHospitals: [],
        missingHospitals: [],
        complianceRate: 0
      }
    })

    const hospitalsMatrix = matchedHospitalRecords.map(hosp => {
      const monthsStatus = {}
      let registeredMonthsCount = 0
      let partialMonthsCount = 0
      let missingMonthsCount = 0
      const missingMonths = []

      evaluatedMonths.forEach(m => {
        const count = hosp.matchedSheetName 
          ? (submissionCounts.get(`${hosp.matchedSheetName}_${m}`) || 0) 
          : 0

        let status = 'missing'
        if (count >= 80) {
          status = 'registered'
          registeredMonthsCount++
          monthsSummary[m].registeredCount++
          monthsSummary[m].registeredHospitals.push({
            id: hosp.id,
            name: hosp.name,
            count
          })
        } else if (count > 0) {
          status = 'partial'
          partialMonthsCount++
          monthsSummary[m].partialCount++
          monthsSummary[m].partialHospitals.push({
            id: hosp.id,
            name: hosp.name,
            count
          })
        } else {
          status = 'missing'
          missingMonthsCount++
          missingMonths.push(m)
          monthsSummary[m].missingCount++
          monthsSummary[m].missingHospitals.push({
            id: hosp.id,
            name: hosp.name,
            director_name: hosp.director_name,
            director_phone: hosp.director_phone,
            quality_head_name: hosp.quality_head_name,
            quality_head_phone: hosp.quality_head_phone
          })
        }

        monthsStatus[m] = {
          month: m,
          status,
          count
        }
      })

      const totalDue = evaluatedMonths.length
      const complianceRate = totalDue > 0 ? Math.round((registeredMonthsCount / totalDue) * 100) : 0
      
      let statusCategory = 'perfect'
      if (missingMonthsCount === 0) {
        statusCategory = 'perfect'
      } else if (missingMonthsCount <= 1) {
        statusCategory = 'warning'
      } else {
        statusCategory = 'critical'
      }

      return {
        id: hosp.id,
        name: hosp.name,
        governorate: hosp.governorate || 'كفر الشيخ',
        director_name: hosp.director_name,
        director_phone: hosp.director_phone,
        quality_head_name: hosp.quality_head_name,
        quality_head_phone: hosp.quality_head_phone,
        matchedSheetName: hosp.matchedSheetName,
        isMatched: Boolean(hosp.matchedSheetName),
        monthsStatus,
        totalDue,
        registeredMonthsCount,
        partialMonthsCount,
        missingMonthsCount,
        missingMonths,
        complianceRate,
        statusCategory
      }
    })

    // Calculate completion rates per month
    const totalHospCount = dbHospitals.length
    evaluatedMonths.forEach(m => {
      const summary = monthsSummary[m]
      summary.complianceRate = totalHospCount > 0 
        ? Math.round((summary.registeredCount / totalHospCount) * 100) 
        : 0
    })

    // Directorate Overall KPIs
    const totalPossibleSubmissions = totalHospCount * evaluatedMonths.length
    const totalActualRegistered = hospitalsMatrix.reduce((sum, h) => sum + h.registeredMonthsCount, 0)
    const overallComplianceRate = totalPossibleSubmissions > 0 
      ? Math.round((totalActualRegistered / totalPossibleSubmissions) * 100) 
      : 0

    const perfectHospitalsCount = hospitalsMatrix.filter(h => h.statusCategory === 'perfect').length
    const warningHospitalsCount = hospitalsMatrix.filter(h => h.statusCategory === 'warning').length
    const criticalHospitalsCount = hospitalsMatrix.filter(h => h.statusCategory === 'critical').length

    return Response.json({
      success: true,
      meta: {
        targetYear,
        availableYears: sortedYears,
        startMonth: START_EVAL_MONTH,
        currentCalendarMonth,
        currentCalendarYear,
        evaluatedMonths,
        maxMonthToEvaluate,
        includeCurrentMonth,
        monthNames: ARABIC_MONTH_NAMES,
        lastFetchedAt: new Date().toISOString()
      },
      stats: {
        totalHospitals: totalHospCount,
        overallComplianceRate,
        perfectHospitalsCount,
        warningHospitalsCount,
        criticalHospitalsCount,
        totalEvaluatedMonths: evaluatedMonths.length
      },
      monthsSummary: Object.values(monthsSummary),
      hospitalsMatrix: hospitalsMatrix.sort((a, b) => {
        // Sort lowest compliance first or highest missed first to highlight issues
        if (a.missingMonthsCount !== b.missingMonthsCount) {
          return b.missingMonthsCount - a.missingMonthsCount
        }
        return a.name.localeCompare(b.name, 'ar')
      })
    })

  } catch (error) {
    console.error('KPI Tracking API Error:', error)
    return Response.json({
      success: false,
      error: error.message || 'حدث خطأ أثناء حساب مؤشرات الأداء'
    }, { status: 500 })
  }
}
