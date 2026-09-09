import { getEmbedding } from '../lib/ai-parser.js'

export const RECURRENCE_MATCHING_POLICY_VERSION = 'RECURRENCE_MATCHING_POLICY_V1'

/**
 * Standard Arabic Text Normalization for Recurrence Matching
 * Preserves the original text 100% while extracting a clean key.
 */
export function normalizeRecurrenceKey(text) {
  if (!text) return ''
  return text
    // 1. Remove room/unit/section prefixes like [العناية المركزة] or [الكراش كار]
    .replace(/^\[.*?\]\s*/, '')
    // 2. Remove leading list numbers e.g. "1.", "1 -", "1)"
    .replace(/^[0-9]+[\.\-\)\s]*/, '')
    // 3. Remove Arabic Tashkeel & Tatweel
    .replace(/[\u064B-\u065F\u0640]/g, '')
    // 4. Normalize Alef variants
    .replace(/[أإآا]/g, 'ا')
    // 5. Normalize Taa Marbuta and Yaa/Alef Maksura
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    // 6. Replace non-alphanumeric/punctuation with single space
    .replace(/[^\w\s\u0600-\u06FF]/g, ' ')
    // 7. Squeeze multiple spaces
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Stop words for token overlap calculations
 */
const STOP_WORDS = new Set([
  'في', 'ف', 'من', 'على', 'علي', 'إلى', 'الي', 'عن', 'مع', 'هذا', 'هذه', 'تم', 'يتم',
  'لا', 'غير', 'عدم', 'يوجد', 'وجود', 'بها', 'به', 'داخل', 'قسم', 'القسم',
  'بعض', 'كل', 'ذلك', 'أو', 'او', 'و', 'هو', 'هي', 'ما', 'عند', 'قبل', 'بعد'
])

export function getCoreTokens(text) {
  const norm = normalizeRecurrenceKey(text)
  return norm.split(' ').filter(w => w.length > 2 && !STOP_WORDS.has(w))
}

/**
 * RecurrenceMatcherService
 * Unified Source of Truth for Recurrence Matching (Current Migration + Future Reports)
 */
export class RecurrenceMatcherService {
  constructor(supabase, options = {}) {
    this.supabase = supabase
    this.policyVersion = RECURRENCE_MATCHING_POLICY_VERSION
    this.highConfidenceThreshold = 0.92
    this.uncertainLowerBound = 0.80
    // Options to control embedding generation if needed
    this.useVector = options.useVector !== undefined ? options.useVector : true
  }

  /**
   * Main matching entry point
   */
  async matchFinding(originalText, domain = 'عام') {
    const normalizedKey = normalizeRecurrenceKey(originalText)
    if (!normalizedKey) {
      return this._buildResult('DISTINCT', null, null, 1.0, 0, 'نص فارغ أو غير محدد', originalText, 'عام', 'سلبية فارغة', domain, 'single')
    }

    // 1. FAST PATH: Exact Normalized Match on existing recurrence_groups
    const { data: exactMatch } = await this.supabase
      .from('recurrence_groups')
      .select('id, title, entity, defect, domain, review_status')
      .eq('normalized_key', normalizedKey)
      .maybeSingle()

    if (exactMatch) {
      return this._buildResult(
        'HIGH_CONFIDENCE',
        exactMatch.id,
        exactMatch.id,
        1.0,
        1.0,
        'تطابق لفظي وتطبيعي تام مع مجموعة تكرار قائمة (Same Entity + Same Defect)',
        exactMatch.title,
        exactMatch.entity,
        exactMatch.defect,
        exactMatch.domain,
        'confirmed'
      )
    }

    // 2. CANDIDATE RETRIEVAL (Lexical Distinctive Tokens)
    let candidates = []
    const coreToks = getCoreTokens(originalText)
    
    if (coreToks.length >= 1) {
      // Pick distinctive tokens (avoiding generic single words like 'نموذج' when more specific tokens exist)
      const specificToks = coreToks.filter(t => !['نموذج', 'سجل', 'قائمه', 'ملف', 'تقرير', 'مكان'].includes(t))
      const searchToks = specificToks.length > 0 ? specificToks.slice(0, 3) : coreToks.slice(0, 2)
      
      const candidateMap = new Map()
      for (const tok of searchToks) {
        const { data: textCandidates } = await this.supabase
          .from('recurrence_groups')
          .select('id, title, normalized_key, entity, defect, domain, review_status')
          .ilike('normalized_key', `%${tok}%`)
          .limit(20)
        
        if (textCandidates) {
          for (const c of textCandidates) {
            candidateMap.set(c.id, c)
          }
        }
      }
      candidates = Array.from(candidateMap.values())
    }

    // 3. STRICT SEMANTIC VALIDATION
    if (candidates && candidates.length > 0) {
      for (const candidate of candidates) {
        const validation = this.validateSemanticEquivalence(originalText, candidate.title, normalizedKey, candidate.normalized_key)
        
        if (validation.isIdentical) {
          return this._buildResult(
            'HIGH_CONFIDENCE',
            candidate.id,
            candidate.id,
            0.95,
            0.95,
            `تطابق دلالي عالي الثقة: ${validation.reason}`,
            candidate.title,
            candidate.entity || validation.entity,
            candidate.defect || validation.defect,
            candidate.domain || domain,
            'confirmed'
          )
        }

        if (validation.isUncertain) {
          return this._buildResult(
            'UNCERTAIN',
            null,
            candidate.id,
            0.82,
            0.82,
            `اشتباه تشابه دلالي بحاجة لمراجعة الجودة: ${validation.reason}`,
            normalizedKey,
            validation.entity || 'كيان مشتبه',
            validation.defect || 'عيب بحاجة لتدقيق',
            domain,
            'pending_review'
          )
        }
      }
    }

    // 4. DISTINCT NEW ISSUE
    const extracted = this._heuristicExtract(originalText)
    return this._buildResult(
      'DISTINCT',
      null,
      null,
      1.0,
      0,
      'سلبية جديدة تمثل مشكلة مستقلة لم يتم رصد تطابق مؤكد لها',
      normalizedKey,
      extracted.entity,
      extracted.defect,
      domain,
      'single'
    )
  }

  /**
   * Deterministic semantic equivalence validator between two findings
   */
  validateSemanticEquivalence(textA, textB, normA, normB) {
    const na = normA || normalizeRecurrenceKey(textA)
    const nb = normB || normalizeRecurrenceKey(textB)

    // Hard negatives rule checks
    // 1. Critical results
    const aCrit = na.includes('حرجه') || na.includes('نتائج حرجه')
    const bCrit = nb.includes('حرجه') || nb.includes('نتائج حرجه')
    if (aCrit && bCrit) {
      const aDelay = na.includes('ابلاغ') || na.includes('تاخر') || na.includes('تبليغ')
      const bDelay = nb.includes('ابلاغ') || nb.includes('تاخر') || nb.includes('تبليغ')
      if (aDelay !== bDelay) {
        return { isIdentical: false, isUncertain: false, reason: 'اختلاف بين تأخر إبلاغ النتائج الحرجة وتوثيق سجل النتائج الحرجة' }
      }
      const aRef = na.includes('مرجع') || na.includes('قائمه')
      const bRef = nb.includes('مرجع') || nb.includes('قائمه')
      if (aRef !== bRef) {
        return { isIdentical: false, isUncertain: false, reason: 'اختلاف بين قائمة المرجع العلمي وسجل التوثيق اليومي للنتائج الحرجة' }
      }
    }

    // Helper: strip Arabic 'ال' prefix for root-term matching
    const stripAl = (s) => s.split(' ').map(w => w.startsWith('ال') && w.length > 3 ? w.slice(2) : w).join(' ')
    const sa = stripAl(na)
    const sb = stripAl(nb)

    // 2. Forms (الأوامر الشفوية vs التوافق الدوائي vs أباتشي)
    const forms = [
      { key: 'اوامر شفويه', label: 'نموذج الأوامر الشفوية' },
      { key: 'اوامر شفهيه', label: 'نموذج الأوامر الشفوية' },
      { key: 'توافق دوائي', label: 'نموذج التوافق الدوائي' },
      { key: 'تقييد', label: 'نموذج التقييد' },
      { key: 'اباتشي', label: 'نموذج أباتشي' },
      { key: 'سقوط', label: 'نموذج السقوط' },
      { key: 'قرح', label: 'نموذج قرح الفراش' },
      { key: 'الم', label: 'نموذج قياس الألم' }
    ]
    for (const f of forms) {
      const hasA = sa.includes(f.key)
      const hasB = sb.includes(f.key)
      if (hasA !== hasB && (hasA || hasB)) {
        return { isIdentical: false, isUncertain: false, reason: `اختلاف في نوع النموذج الطبي الموثق (${f.label})` }
      }
    }

    // 3. Crash Cart (قفل vs محتويات وخريطة vs ترمومتر)
    const aCC = sa.includes('كراش')
    const bCC = sb.includes('كراش')
    if (aCC && bCC) {
      const aLock = sa.includes('قفل') || sa.includes('مكسور') || sa.includes('تامين')
      const bLock = sb.includes('قفل') || sb.includes('مكسور') || sb.includes('تامين')
      if (aLock !== bLock) {
        return { isIdentical: false, isUncertain: false, reason: 'اختلاف بين قفل وتأمين الكراش كار ومحتويات/أدوية الكراش كار' }
      }
      const aThermo = sa.includes('ترمومتر') || sa.includes('حراره') || sa.includes('رطوبه')
      const bThermo = sb.includes('ترمومتر') || sb.includes('حراره') || sb.includes('رطوبه')
      if (aThermo !== bThermo) {
        return { isIdentical: false, isUncertain: false, reason: 'اختلاف بين قياس حرارة ورطوبة الكراش كار وتجهيز العربة' }
      }
    }

    // Token overlap comparison
    const tokA = getCoreTokens(textA)
    const tokB = getCoreTokens(textB)
    const setB = new Set(tokB)
    const shared = tokA.filter(w => setB.has(w))
    const union = new Set([...tokA, ...tokB])
    const jaccard = union.size === 0 ? 0 : shared.length / union.size

    // High confidence match: Same Entity and Defect
    if (jaccard >= 0.70) {
      return { isIdentical: true, isUncertain: false, reason: 'تطابق قوي في الكلمات الجوهرية والكيان والعيب', entity: shared.slice(0, 2).join(' '), defect: 'مطابق' }
    }

    // Ambubag match in crash cart
    if (sa.includes('امبوباج') && sb.includes('امبوباج') && sa.includes('كراش') && sb.includes('كراش')) {
      return { isIdentical: true, isUncertain: false, reason: 'تطابق أمبوباج الأطفال بعربة الطوارئ', entity: 'أمبوباج أطفال بعربة الطوارئ', defect: 'غير متوفر' }
    }

    // Chemical spill kit
    if (sa.includes('انسكاب') && sb.includes('انسكاب') && sa.includes('كيميائ') && sb.includes('كيميائ')) {
      return { isIdentical: true, isUncertain: false, reason: 'تطابق حقيبة/طقم الانسكاب الكيميائي', entity: 'حقيبة انسكاب كيميائي', defect: 'غير متوفر' }
    }

    // Sewage drains open
    if ((sa.includes('مطبق') || sa.includes('بلاعه') || sa.includes('صرف صحي')) && (sb.includes('مطبق') || sb.includes('بلاعه') || sb.includes('صرف صحي')) && (sa.includes('مفتوح') || sa.includes('مكشوف') || sa.includes('بدون غطاء') || sa.includes('رائح')) && (sb.includes('مفتوح') || sb.includes('مكشوف') || sb.includes('بدون غطاء') || sb.includes('رائح'))) {
      return { isIdentical: true, isUncertain: false, reason: 'تطابق فتحات ومطابق الصرف الصحي المكشوفة', entity: 'مطابق وغرف الصرف الصحي', defect: 'مكشوفة وبدون غطاء تنبعث منها روائح' }
    }

    // Oxygen cylinders unsecured
    if ((sa.includes('اسطوان') || sa.includes('انبوبه')) && (sb.includes('اسطوان') || sb.includes('انبوبه')) && sa.includes('اكسجين') && sb.includes('اكسجين') && (sa.includes('غير مثبت') || sa.includes('غير مؤمن') || sa.includes('مسند') || sa.includes('جنزير')) && (sb.includes('غير مثبت') || sb.includes('غير مؤمن') || sb.includes('مسند') || sb.includes('جنزير'))) {
      return { isIdentical: true, isUncertain: false, reason: 'تطابق أسطوانات الأكسجين غير المؤمنة ضد السقوط', entity: 'أسطوانات الأكسجين', defect: 'غير مثبتة بمسند أو جنزير' }
    }

    // Verbal orders
    if ((sa.includes('اوامر شفويه') || sa.includes('اوامر شفهيه')) && (sb.includes('اوامر شفويه') || sb.includes('اوامر شفهيه'))) {
      if ((sa.includes('نموذج') || sa.includes('لا يوجد') || sa.includes('متوفر')) && (sb.includes('نموذج') || sb.includes('لا يوجد') || sb.includes('متوفر'))) {
        return { isIdentical: true, isUncertain: false, reason: 'تطابق عدم توفر نموذج الأوامر الشفوية المعتمد', entity: 'نموذج الأوامر الشفوية', defect: 'غير متوفر' }
      }
    }

    if (jaccard >= 0.45) {
      return { isIdentical: false, isUncertain: true, reason: 'تقارب نسبي في الكلمات الجوهرية دون تطابق حاسم في العيب' }
    }

    return { isIdentical: false, isUncertain: false, reason: 'اختلاف في الكيان أو العيب التشغيلي' }
  }

  _heuristicExtract(text) {
    const norm = normalizeRecurrenceKey(text)
    return {
      entity: norm.split(' ').slice(0, 3).join(' ') || 'سلبية عامة',
      defect: norm.includes('لا يوجد') || norm.includes('غير متوفر') ? 'غير متوفر' : (norm.includes('غير مكتمل') ? 'غير مكتمل' : 'مخالفة تشغيلية')
    }
  }

  _buildResult(decision, recurrenceGroupId, candidateGroupId, confidence, similarity, reason, title, entity, defect, domain, reviewStatus) {
    return {
      decision,
      recurrenceGroupId,
      candidateGroupId,
      confidence,
      similarity,
      reason,
      title,
      entity,
      defect,
      domain,
      reviewStatus,
      matchingPolicyVersion: this.policyVersion
    }
  }
}
