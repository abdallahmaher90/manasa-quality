/**
 * Metadata and Classification for Healthcare Indicators (84 Indicators)
 * تصنيف ومعايير حدود المؤشرات الـ 84 المعتمدة لمستشفيات القطاع الصحي
 */

export const INDICATOR_DOMAINS = [
  {
    id: 'ipsg',
    name: 'أهداف سلامة المرضى الدولية (IPSG)',
    icon: '🛡️',
    color: '#0284c7',
    bgColor: 'rgba(2, 132, 199, 0.1)',
    description: 'معايير الأمان السريري، التعريف الصحيح، الأوامر الشفهية، السقوط، قرح الفراش، والجلطات الوريدية'
  },
  {
    id: 'surgery',
    name: 'الجراحة والتخدير والعمليات',
    icon: '✂️',
    color: '#0d9488',
    bgColor: 'rgba(13, 148, 136, 0.1)',
    description: 'سلامة الجراحة، قائمة التحقق، الوقت المستقطع، العمليات الكبرى، ونسب الإحالة الجراحية'
  },
  {
    id: 'medication',
    name: 'إدارة وسلامة الأدوية',
    icon: '💊',
    color: '#8b5cf6',
    bgColor: 'rgba(139, 92, 246, 0.1)',
    description: 'أخطاء الوصفات، أدوية الخطورة العالية، الأدوية المتشابهة (LASA)، والآثار الدوائية العكسية'
  },
  {
    id: 'infection_control',
    name: 'مكافحة العدوى والوقاية',
    icon: '🦠',
    color: '#10b981',
    bgColor: 'rgba(16, 185, 129, 0.1)',
    description: 'نظافة الأيدي، عدوى القساطر البولية (CAUTI)، القساطر المركزية (CLABSI)، والتنفس الصناعي (VAP)'
  },
  {
    id: 'occupational_health',
    name: 'السلامة المهنية والأشعة وصحة العاملين',
    icon: '☢️',
    color: '#f59e0b',
    bgColor: 'rgba(245, 158, 11, 0.1)',
    description: 'قياس الجرعات الإشعاعية، الكشف الدوري للعاملين، وحوادث الوخز والتعامل الآمن معها'
  },
  {
    id: 'hr_staff',
    name: 'الموارد البشرية وشؤون العاملين',
    icon: '👥',
    color: '#6366f1',
    bgColor: 'rgba(99, 102, 241, 0.1)',
    description: 'معدلات رضا الكوادر الطبية والإدارية واستكمال الملفات الوظيفية'
  },
  {
    id: 'patient_experience',
    name: 'تجربة المريض ورضا المنتفعين والتثقيف',
    icon: '🤝',
    color: '#0ea5e9',
    bgColor: 'rgba(14, 165, 233, 0.1)',
    description: 'قياس رضا المرضى وذويهم، إدارة والرد على الشكاوى، حماية حقوق المريض، والتثقيف الصحي'
  },
  {
    id: 'medical_records',
    name: 'السجلات الطبية والحوكمة وإدارة المخاطر',
    icon: '📋',
    color: '#475569',
    bgColor: 'rgba(71, 85, 105, 0.1)',
    description: 'اكتمال الملفات الطبية المفتوحة والمغلقة، الالتزام بالبروتوكولات، ومعدلات الإبلاغ عن الحوادث العارضة'
  },
  {
    id: 'fms',
    name: 'السلامة وإدارة المرافق والأجهزة (FMS)',
    icon: '⚙️',
    color: '#ea580c',
    bgColor: 'rgba(234, 88, 12, 0.1)',
    description: 'أنظمة ومعدات الإطفاء، كواشف الدخان، الانسكابات، وصيانة وتراخيص الأجهزة الطبية وغير الطبية'
  },
  {
    id: 'critical_care',
    name: 'الرعاية المركزة والحضانات والعزل',
    icon: '🫀',
    color: '#dc2626',
    bgColor: 'rgba(220, 38, 38, 0.1)',
    description: 'معدلات الوفيات والإشغال ودوران الأسرة في العناية المركزة (كبار/أطفال)، عناية العزل، والحضانات'
  },
  {
    id: 'operations',
    name: 'الكفاءة التشغيلية والمعدلات الحيوية',
    icon: '📊',
    color: '#334155',
    bgColor: 'rgba(51, 65, 85, 0.1)',
    description: 'معدل الوفيات العام، إشغال الداخلي، دوران السرير، الانتظار بالطوارئ، والعيادات المسائية'
  }
]

export const REQUIREMENTS_MAP = {
  'Has_Surgery': {
    code: 'Has_Surgery',
    label: 'أقسام الجراحة والعمليات',
    description: 'يطبق فقط على المستشفيات التي تحتوي على أقسام جراحة وغرف عمليات',
    badgeClass: 'badge-surgery'
  },
  'Has_Major_Surgery': {
    code: 'Has_Major_Surgery',
    label: 'جراحات كبرى',
    description: 'يطبق على المستشفيات التي تجرى بها عمليات جراحية كبرى ومتقدمة',
    badgeClass: 'badge-surgery'
  },
  'Has_Icu': {
    code: 'Has_Icu',
    label: 'عناية مركزة (كبار)',
    description: 'يطبق على المستشفيات التي تتوفر بها وحدات رعاية مركزة للكبار',
    badgeClass: 'badge-icu'
  },
  'Has_Picu': {
    code: 'Has_Picu',
    label: 'عناية مركزة (أطفال)',
    description: 'يطبق على المستشفيات التي تتوفر بها وحدة رعاية مركزة للأطفال (PICU)',
    badgeClass: 'badge-icu'
  },
  'Has_Nicu': {
    code: 'Has_Nicu',
    label: 'حضانات مبتسرين (NICU)',
    description: 'يطبق على المستشفيات التي تحتوي على أقسام حضانات الأطفال المبتسرين',
    badgeClass: 'badge-icu'
  },
  'Has_Vap': {
    code: 'Has_Vap',
    label: 'أجهزة تنفس صناعي',
    description: 'يطبق على الأقسام التي تتوفر بها أجهزة تنفس صناعي ميكانيكي',
    badgeClass: 'badge-equipment'
  },
  'Has_Rad': {
    code: 'Has_Rad',
    label: 'خدمات الأشعة',
    description: 'يطبق على المستشفيات التي تتوفر بها أقسام وخدمات الأشعة التشخيصية',
    badgeClass: 'badge-rad'
  },
  'Has_In_Patient': {
    code: 'Has_In_Patient',
    label: 'أقسام الحجز الداخلي',
    description: 'يطبق على المستشفيات التي تحتوي على أقسام تنويم داخلي',
    badgeClass: 'badge-general'
  },
  'Has_Evening_Clinics': {
    code: 'Has_Evening_Clinics',
    label: 'عيادات مسائية',
    description: 'يطبق على المستشفيات التي تفعل العيادات الخارجية المسائية',
    badgeClass: 'badge-general'
  }
}

/**
 * Assign an indicator index to its clinical/administrative domain
 */
export function getDomainForIndicator(index) {
  if (index >= 1 && index <= 17) return INDICATOR_DOMAINS[0] // ipsg
  if ((index >= 18 && index <= 20) || index === 49 || index === 80 || index === 81) return INDICATOR_DOMAINS[1] // surgery
  if (index >= 21 && index <= 25) return INDICATOR_DOMAINS[2] // medication
  if (index >= 26 && index <= 33) return INDICATOR_DOMAINS[3] // infection_control
  if (index >= 34 && index <= 38) return INDICATOR_DOMAINS[4] // occupational_health
  if (index === 39 || index === 40) return INDICATOR_DOMAINS[5] // hr_staff
  if (index >= 41 && index <= 46) return INDICATOR_DOMAINS[6] // patient_experience
  if ((index >= 47 && index <= 48) || (index >= 50 && index <= 52)) return INDICATOR_DOMAINS[7] // medical_records
  if (index >= 53 && index <= 64) return INDICATOR_DOMAINS[8] // fms
  if ((index >= 66 && index <= 70) || index === 71 || index === 74 || (index >= 82 && index <= 84)) return INDICATOR_DOMAINS[9] // critical_care
  if (index === 65 || index === 72 || index === 73 || (index >= 75 && index <= 79)) return INDICATOR_DOMAINS[10] // operations
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

  // Format human-readable thresholds
  let targetSummary = ''
  let greenBand = ''
  let yellowBand = ''
  let redBand = ''

  if (direction === 'higher') {
    targetSummary = `المستهدف ≥ ${minOk}${unit}`
    greenBand = `≥ ${minOk}${unit} (مطابق للمستهدف)`
    if (critThresh !== null && critThresh !== undefined) {
      if (critThresh < minOk) {
        yellowBand = `${critThresh}${unit} إلى أقل من ${minOk}${unit} (منطقة تحذير)`
        redBand = `< ${critThresh}${unit} (خطر حرج)`
      } else {
        yellowBand = `أقل من ${minOk}${unit}`
        redBand = `< ${critThresh}${unit}`
      }
    } else {
      yellowBand = `أقل من ${minOk}${unit}`
      redBand = `انحراف كبير`
    }
  } else if (direction === 'lower') {
    targetSummary = `المستهدف ≤ ${maxOk}${unit}`
    greenBand = `≤ ${maxOk}${unit} (مطابق للمستهدف)`
    if (critThresh !== null && critThresh !== undefined) {
      if (critThresh > maxOk) {
        yellowBand = `أعلى من ${maxOk}${unit} وحتى ${critThresh}${unit} (منطقة تحذير)`
        redBand = `> ${critThresh}${unit} (خطر حرج)`
      } else {
        yellowBand = `أعلى من ${maxOk}${unit}`
        redBand = `> ${critThresh}${unit}`
      }
    } else {
      yellowBand = `أعلى من ${maxOk}${unit}`
      redBand = `انحراف كبير`
    }
  } else {
    // Range
    targetSummary = `النطاق المثالي: ${minOk} - ${maxOk} ${unit}`
    greenBand = `بين ${minOk} و ${maxOk} ${unit} (مطابق)`
    yellowBand = `انحراف طفيف عن النطاق الموصى به`
    if (critThresh !== null && critThresh !== undefined) {
      redBand = `تجاوز الحد الحرج (${critThresh} ${unit}) أو انحراف شديد`
    } else {
      redBand = `انحراف حرج عن النطاق الموصى به`
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
    directionLabel: direction === 'higher' ? 'تصاعدي (الزيادة أفضل)' : (direction === 'lower' ? 'تنازلي (الانخفاض أفضل)' : 'نطاق محدد (Range)'),
    directionIcon: direction === 'higher' ? '📈' : (direction === 'lower' ? '📉' : '🎯'),
    minOk,
    maxOk,
    criticalThreshold: critThresh,
    frequency: row.Frequency?.trim() || 'شهري (Monthly)',
    active: (row.Active?.trim().toLowerCase() === 'yes' || row.Active === true),
    requirementCode: reqCode || null,
    requirementLabel: requirement ? requirement.label : 'عام لجميع المستشفيات',
    requirementDescription: requirement ? requirement.description : 'يطبق على كافة المستشفيات بدون استثناء',
    isGeneral: !requirement,
    targetSummary,
    greenBand,
    yellowBand,
    redBand
  }
}

