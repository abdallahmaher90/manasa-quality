/**
 * Metadata and Classification for Healthcare Indicators (84 Indicators)
 * تصنيف ومعايير حدود المؤشرات الـ 84 المعتمدة لمستشفيات القطاع الصحي
 */

export const INDICATOR_DOMAINS = [
  {
    id: 'ipsg',
    name: 'أهداف سلامة المرضى (IPSG)',
    icon: '🛡️',
    color: '#0284c7',
    bgColor: 'rgba(2, 132, 199, 0.1)',
  },
  {
    id: 'surgery',
    name: 'الجراحة والعمليات',
    icon: '✂️',
    color: '#0d9488',
    bgColor: 'rgba(13, 148, 136, 0.1)',
  },
  {
    id: 'medication',
    name: 'سلامة الأدوية',
    icon: '💊',
    color: '#8b5cf6',
    bgColor: 'rgba(139, 92, 246, 0.1)',
  },
  {
    id: 'infection_control',
    name: 'مكافحة العدوى',
    icon: '🦠',
    color: '#10b981',
    bgColor: 'rgba(16, 185, 129, 0.1)',
  },
  {
    id: 'occupational_health',
    name: 'السلامة المهنية والأشعة',
    icon: '☢️',
    color: '#f59e0b',
    bgColor: 'rgba(245, 158, 11, 0.1)',
  },
  {
    id: 'hr_staff',
    name: 'الموارد البشرية',
    icon: '👥',
    color: '#6366f1',
    bgColor: 'rgba(99, 102, 241, 0.1)',
  },
  {
    id: 'patient_experience',
    name: 'تجربة ورضا المريض',
    icon: '🤝',
    color: '#0ea5e9',
    bgColor: 'rgba(14, 165, 233, 0.1)',
  },
  {
    id: 'medical_records',
    name: 'السجلات الطبية والمخاطر',
    icon: '📋',
    color: '#475569',
    bgColor: 'rgba(71, 85, 105, 0.1)',
  },
  {
    id: 'fms',
    name: 'المرافق والأجهزة (FMS)',
    icon: '⚙️',
    color: '#ea580c',
    bgColor: 'rgba(234, 88, 12, 0.1)',
  },
  {
    id: 'critical_care',
    name: 'العنايات والحضانات',
    icon: '🫀',
    color: '#dc2626',
    bgColor: 'rgba(220, 38, 38, 0.1)',
  },
  {
    id: 'operations',
    name: 'الكفاءة التشغيلية',
    icon: '📊',
    color: '#334155',
    bgColor: 'rgba(51, 65, 85, 0.1)',
  }
]

export const REQUIREMENTS_MAP = {
  'Has_Surgery': {
    code: 'Has_Surgery',
    label: 'أقسام الجراحة',
    description: 'خاص بالمستشفيات التي تحتوي على أقسام جراحة وغرف عمليات',
  },
  'Has_Major_Surgery': {
    code: 'Has_Major_Surgery',
    label: 'جراحات كبرى',
    description: 'خاص بالمستشفيات التي تجرى بها عمليات جراحية كبرى',
  },
  'Has_Icu': {
    code: 'Has_Icu',
    label: 'عناية كبار',
    description: 'خاص بالمستشفيات التي بها وحدة رعاية مركزة للكبار',
  },
  'Has_Picu': {
    code: 'Has_Picu',
    label: 'عناية أطفال',
    description: 'خاص بالمستشفيات التي بها وحدة رعاية مركزة للأطفال (PICU)',
  },
  'Has_Nicu': {
    code: 'Has_Nicu',
    label: 'حضانات مبتسرين',
    description: 'خاص بالمستشفيات التي بها حضانات أطفال مبتسرين',
  },
  'Has_Vap': {
    code: 'Has_Vap',
    label: 'تنفس صناعي',
    description: 'خاص بالأقسام التي تتوفر بها أجهزة تنفس صناعي',
  },
  'Has_Rad': {
    code: 'Has_Rad',
    label: 'خدمات الأشعة',
    description: 'خاص بالمستشفيات التي تتوفر بها خدمات الأشعة',
  },
  'Has_In_Patient': {
    code: 'Has_In_Patient',
    label: 'أقسام الداخلي',
    description: 'خاص بالمستشفيات ذات أقسام التنويم الداخلي',
  },
  'Has_Evening_Clinics': {
    code: 'Has_Evening_Clinics',
    label: 'عيادات مسائية',
    description: 'خاص بالمستشفيات التي تشغل عيادات مسائية',
  }
}

/**
 * Assign an indicator index to its clinical/administrative domain
 */
export function getDomainForIndicator(index) {
  if (index >= 1 && index <= 17) return INDICATOR_DOMAINS[0]
  if ((index >= 18 && index <= 20) || index === 49 || index === 80 || index === 81) return INDICATOR_DOMAINS[1]
  if (index >= 21 && index <= 25) return INDICATOR_DOMAINS[2]
  if (index >= 26 && index <= 33) return INDICATOR_DOMAINS[3]
  if (index >= 34 && index <= 38) return INDICATOR_DOMAINS[4]
  if (index === 39 || index === 40) return INDICATOR_DOMAINS[5]
  if (index >= 41 && index <= 46) return INDICATOR_DOMAINS[6]
  if ((index >= 47 && index <= 48) || (index >= 50 && index <= 52)) return INDICATOR_DOMAINS[7]
  if (index >= 53 && index <= 64) return INDICATOR_DOMAINS[8]
  if ((index >= 66 && index <= 70) || index === 71 || index === 74 || (index >= 82 && index <= 84)) return INDICATOR_DOMAINS[9]
  if (index === 65 || index === 72 || index === 73 || (index >= 75 && index <= 79)) return INDICATOR_DOMAINS[10]
  return INDICATOR_DOMAINS[0]
}

/**
 * Clean up indicator name for display
 */
export function formatIndicatorTitle(rawName) {
  if (!rawName) return ''
  return rawName
    .replace(/\s*\(\s*نسبة مئويه\s*\)/g, '')
    .replace(/\s*\(\s*نسبة مئوية\s*\)/g, '')
    .replace(/\s*\(\s*بالأيام\s*\)/g, '')
    .replace(/\s*\(\s*أيام\s*\)/g, '')
    .replace(/\s*\(\s*عدد\s*\)/g, '')
    .trim()
}

/**
 * Get unit of measurement
 */
export function getIndicatorUnit(rawName) {
  if (!rawName) return '%'
  if (rawName.includes('أيام') || rawName.includes('بالأيام')) return 'أيام'
  if (rawName.includes('عدد')) return 'عدد'
  return '%'
}

/**
 * Transform a raw sheet row into a structured indicator rule object
 */
export function processIndicatorRuleRow(row, index) {
  const rawName = (row.Indicator || '').trim()
  const cleanTitle = formatIndicatorTitle(rawName)
  const unit = getIndicatorUnit(rawName)

  const minOk = (row.Min_OK !== '' && row.Min_OK !== null && !isNaN(Number(row.Min_OK)))
    ? Number(row.Min_OK)
    : (row.Min_OK || null)

  const maxOk = (row.Max_OK !== '' && row.Max_OK !== null && !isNaN(Number(row.Max_OK)))
    ? Number(row.Max_OK)
    : (row.Max_OK || null)

  const critThresh = (row.Critical_Threshold !== '' && row.Critical_Threshold !== null && !isNaN(Number(row.Critical_Threshold)))
    ? Number(row.Critical_Threshold)
    : (row.Critical_Threshold ? Number(row.Critical_Threshold) : null)

  const rawDir = (row.Direction || 'higher').trim().toLowerCase()
  const direction = (rawDir === 'lower') ? 'lower' : ((rawDir === 'range') ? 'range' : 'higher')

  const domain = getDomainForIndicator(index)
  const reqCode = (row.Requires || '').trim()
  const requirement = reqCode && REQUIREMENTS_MAP[reqCode] ? REQUIREMENTS_MAP[reqCode] : null

  // Clean, concise, short values
  let greenBand = ''
  let yellowBand = ''
  let redBand = ''

  if (direction === 'higher') {
    greenBand = `≥ ${minOk}${unit}`
    if (critThresh !== null && critThresh !== undefined) {
      if (critThresh < minOk) {
        yellowBand = `${critThresh}${unit} - ${minOk - 1}${unit}`
        redBand = `< ${critThresh}${unit}`
      } else {
        yellowBand = `< ${minOk}${unit}`
        redBand = `< ${critThresh}${unit}`
      }
    } else {
      yellowBand = `< ${minOk}${unit}`
      redBand = `< ${minOk}${unit}`
    }
  } else if (direction === 'lower') {
    greenBand = `≤ ${maxOk}${unit}`
    if (critThresh !== null && critThresh !== undefined) {
      if (critThresh > maxOk) {
        yellowBand = `${maxOk + 1}${unit} - ${critThresh}${unit}`
        redBand = `> ${critThresh}${unit}`
      } else {
        yellowBand = `> ${maxOk}${unit}`
        redBand = `> ${critThresh}${unit}`
      }
    } else {
      yellowBand = `> ${maxOk}${unit}`
      redBand = `> ${maxOk}${unit}`
    }
  } else {
    // Range
    greenBand = `${minOk} - ${maxOk} ${unit}`
    yellowBand = `خارج النطاق`
    if (critThresh !== null && critThresh !== undefined) {
      redBand = `> ${critThresh} ${unit}`
    } else {
      redBand = `انحراف حرج`
    }
  }

  return {
    id: index,
    index,
    rawName,
    title: cleanTitle,
    unit,
    domainId: domain.id,
    domainName: domain.name,
    domainIcon: domain.icon,
    domainColor: domain.color,
    domainBgColor: domain.bgColor,
    direction,
    directionLabel: direction === 'higher' ? 'تصاعدي' : (direction === 'lower' ? 'تنازلي' : 'نطاق'),
    directionIcon: direction === 'higher' ? '📈' : (direction === 'lower' ? '📉' : '🎯'),
    minOk,
    maxOk,
    criticalThreshold: critThresh,
    frequency: 'شهري',
    active: (row.Active?.trim().toLowerCase() === 'yes' || row.Active === true),
    requirementCode: reqCode || null,
    requirementLabel: requirement ? requirement.label : 'عام',
    requirementDescription: requirement ? requirement.description : 'يطبق على كافة المستشفيات',
    isGeneral: !requirement,
    greenBand,
    yellowBand,
    redBand
  }
}
