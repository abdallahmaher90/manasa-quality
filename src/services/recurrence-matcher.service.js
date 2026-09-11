import { getEmbedding, extractSemanticIssueSignature, adjudicateFindingMatch } from '../lib/ai-parser.js'

export const RECURRENCE_MATCHING_POLICY_VERSION = 'SEMANTIC_RECURRENCE_POLICY_V3'

/**
 * Standard Arabic Text Normalization
 */
export function normalizeRecurrenceKey(text) {
  if (!text) return ''
  return text
    .replace(/^\[.*?\]\s*/, '')
    .replace(/^[0-9]+[\.\-\)\s]*/, '')
    .replace(/[\u064B-\u065F\u0640]/g, '')
    .replace(/[أإآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/(^|\s)و(?=ال)/g, '$1')
    .replace(/[^\w\s\u0600-\u06FF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const STOP_WORDS = new Set([
  'في', 'ف', 'من', 'على', 'علي', 'إلى', 'الي', 'عن', 'مع', 'هذا', 'هذه', 'تم', 'يتم',
  'لا', 'غير', 'عدم', 'يوجد', 'وجود', 'بها', 'به', 'داخل', 'قسم', 'القسم', 'بالقسم',
  'بعض', 'كل', 'ذلك', 'أو', 'او', 'و', 'هو', 'هي', 'ما', 'عند', 'قبل', 'بعد'
])

export function getCoreTokens(text) {
  const norm = normalizeRecurrenceKey(text)
  return norm.split(' ').filter(w => w.length > 2 && !STOP_WORDS.has(w))
}

export class RecurrenceMatcherService {
  constructor(supabase, options = {}) {
    this.supabase = supabase
    this.policyVersion = RECURRENCE_MATCHING_POLICY_VERSION
    this.useVector = options.useVector !== undefined ? options.useVector : false
  }

  async initializeGroupCache() {
    if (!this._allGroups) {
      const { data } = await this.supabase.from('recurrence_groups').select('id, title, normalized_key, entity, defect, domain, review_status').limit(2000)
      this._allGroups = data || []
    }
  }

  async matchFinding(originalText, domain = 'عام') {
    // 0. Prefetch all groups once if not cached
    await this.initializeGroupCache()

    const normalizedKey = normalizeRecurrenceKey(originalText)
    if (!normalizedKey) {
      return this._buildResult('DISTINCT', null, null, 1.0, 0, 'نص فارغ', originalText, 'عام', 'سلبية فارغة', domain, 'single')
    }

    // 1. EXTRACT ISSUE SIGNATURE
    let signature = await extractSemanticIssueSignature(originalText)
    if (!signature) {
      signature = this._heuristicExtract(originalText)
    }

    // 2. RETRIEVAL FUNNEL (8-Step)
    const candidateMap = new Map()

    // Step 1: Exact Normalized Retrieval
    const exactMatch = this._allGroups.filter(g => g.normalized_key === normalizedKey)
    if (exactMatch.length > 0) {
      candidateMap.set(exactMatch[0].id, exactMatch[0])
    }

    const coreToks = getCoreTokens(originalText)
    if (coreToks.length >= 1) {
      // Step 2 & 3: Lexical & Distinctive Token Retrieval
      const specificToks = coreToks.filter(t => !['نموذج', 'سجل', 'قائمه', 'ملف', 'تقرير', 'مكان'].includes(t))
      const searchToks = specificToks.length > 0 ? specificToks.slice(0, 3) : coreToks.slice(0, 2)
      
      for (const tok of searchToks) {
        const textCandidates = this._allGroups.filter(g => g.normalized_key && g.normalized_key.includes(tok)).slice(0, 20)
        for (const c of textCandidates) candidateMap.set(c.id, c)
      }

      // Step 4: Semantic Embedding Retrieval (Optional based on flag)
      if (this.useVector) {
        const vec = await getEmbedding(originalText)
        if (vec) {
          const { data: vecCandidates } = await this.supabase.rpc('match_recurrence_groups', {
            query_embedding: vec,
            match_threshold: 0.70,
            match_count: 5
          })
          if (vecCandidates) {
             for (const c of vecCandidates) candidateMap.set(c.id, c)
          }
        }
      }
    }

    // Step 5: Heuristic Scoring for Candidate Ranking
    let rankedCandidates = Array.from(candidateMap.values()).map(c => {
       const jaccard = this._calculateJaccard(originalText, c.title)
       return { ...c, heuristicScore: Math.max(jaccard, c.similarity || 0) }
    }).sort((a, b) => b.heuristicScore - a.heuristicScore)

    // 3. DECISION GATE - Dynamic Top-K Expansion (3 -> 5 -> 8)
    if (rankedCandidates.length > 0) {
      let bestCandidate = null
      let bestValidation = { decision: 'DISTINCT', score: 0 }
      
      const evaluateTopK = async (k) => {
         const candidatesToEvaluate = rankedCandidates.slice(0, k)
         for (const candidate of candidatesToEvaluate) {
            // Skip if already evaluated (this would be optimized in real logic, but fine for dry run)
            if (candidate.evaluated) continue
            
            candidate.evaluated = true
            const validation = await this.evaluateSemanticEquivalence(signature, candidate, originalText, candidate.title)
            
            if (validation.score > bestValidation.score) {
               bestValidation = validation
               bestCandidate = candidate
            }
         }
      }

      // Try Top 3
      await evaluateTopK(3)
      
      // If we didn't get a HIGH_CONFIDENCE (SAME_ISSUE), expand to Top 5
      if (bestValidation.decision !== 'SAME_ISSUE' && rankedCandidates.length > 3) {
         await evaluateTopK(5)
      }
      
      // If still uncertain/distinct and there are candidates with ok heuristic, expand to Top 8
      if (bestValidation.decision !== 'SAME_ISSUE' && rankedCandidates.length > 5) {
         await evaluateTopK(8)
      }

      if (bestValidation.decision === 'SAME_ISSUE' || bestValidation.decision === 'HIGH_CONFIDENCE') {
        return this._buildResult('HIGH_CONFIDENCE', bestCandidate.id, bestCandidate.id, bestValidation.score, bestValidation.jaccard, bestValidation.reasonLog, bestCandidate.title, signature.entity, signature.defect, domain, 'pending_review', signature, bestCandidate.semantic_signature)
      }

      if (bestValidation.decision === 'UNCERTAIN') {
        return this._buildResult('UNCERTAIN', null, bestCandidate.id, bestValidation.score, bestValidation.jaccard, bestValidation.reasonLog, bestCandidate.title, signature.entity, signature.defect, domain, 'pending_review', signature, bestCandidate.semantic_signature)
      }
    }

    return this._buildResult('DISTINCT', null, null, 1.0, 0, 'Decision Gate: DISTINCT (No valid candidates)', normalizedKey, signature.entity, signature.defect, domain, 'single', signature)
  }

  _calculateJaccard(textA, textB) {
    const setA = new Set(getCoreTokens(textA))
    const setB = new Set(getCoreTokens(textB))
    if (setA.size === 0 && setB.size === 0) return 1.0
    let intersection = 0
    for (const token of setA) {
      if (setB.has(token)) intersection++
    }
    const union = new Set([...setA, ...setB]).size
    return union === 0 ? 0 : intersection / union
  }

  async evaluateSemanticEquivalence(newSig, candidate, textA, textB) {
    const na = normalizeRecurrenceKey(textA)
    const nb = normalizeRecurrenceKey(textB)

    const candSig = candidate.semantic_signature || this._heuristicExtract(candidate.title)
    
    // Safety check for null
    if (!newSig || !candSig) {
      return {
        decision: 'UNCERTAIN',
        reasonLog: 'Semantic extraction failed for one or both findings. AI_UNAVAILABLE',
        decisionLog: 'Extraction Failed'
      }
    }

    // Call the external AI Adjudication Gate
    const aiResult = await adjudicateFindingMatch(newSig, candSig)
    
    let score = 0.5
    if (aiResult.decision === 'SAME_ISSUE') score = 0.95
    if (aiResult.decision === 'DIFFERENT_ISSUE') score = 0.1

    return {
      decision: aiResult.decision,
      score,
      reasonLog: aiResult.reason,
      jaccard: candidate.similarity || 0.5
    }
  }

  // Very robust local extractor mocking LLM structure
  _heuristicExtract(text) {
    const norm = normalizeRecurrenceKey(text)
    let polarity = 'other'
    let defectStr = 'مخالفة تشغيلية'
    let reqStr = 'الالتزام بالمعايير'
    
    if (norm.includes('لا يوجد') || norm.includes('غير متوفر') || norm.includes('بدون') || norm.includes('لم يتم توفير') || norm.includes('عدم وجود') || norm.includes('غير موجود') || norm.includes('غير موجوده') || norm.includes('عدم توفر') || norm.includes('غير متوفره')) {
      polarity = 'missing'
      defectStr = 'غير متوفر'
    } else if (norm.includes('غير مكتمل') || norm.includes('نقص') || norm.includes('غير مستوف') || norm.includes('غير مرتب') || norm.includes('عدم ترتيب')) {
      polarity = 'incomplete'
      defectStr = 'غير مكتمل'
    } else if (norm.includes('غير معتمد') || norm.includes('اعتماد') || norm.includes('اعتمادات')) {
      polarity = 'unapproved'
      defectStr = 'غير معتمد'
    } else if (norm.includes('تالف') || norm.includes('معطل') || norm.includes('خربان') || norm.includes('لا يعمل') || norm.includes('مكسور') || norm.includes('صيانه')) {
      polarity = 'damaged'
      defectStr = 'تالف أو معطل'
    } else if (norm.includes('منتهي') || norm.includes('صلاحي')) {
      polarity = 'expired'
      defectStr = 'منتهي الصلاحية'
    } else if (norm.includes('نظيف') || norm.includes('غير نظيف') || norm.includes('غير محدث') || norm.includes('محدث') || norm.includes('متاخر') || norm.includes('تحديث') || norm.includes('غير مميز')) {
      polarity = 'incorrect'
      defectStr = 'غير صحيح أو غير محدث'
    } else if (norm.includes('لا يرتدي') || norm.includes('عدم لبس') || norm.includes('عدم التزام') || norm.includes('غير مطاب') || norm.includes('لم تفعل') || norm.includes('لم تكتب') || norm.includes('تسرب')) {
      polarity = 'other'
      defectStr = 'مخالفة'
    }

    // Extract Entity by stripping defect words
    let entityTokens = getCoreTokens(text).filter(w => !['متوفر', 'مكتمل', 'تالف', 'معطل', 'نظيف', 'محدث', 'لا', 'يوجد', 'غير', 'بدون', 'خربان', 'وجود', 'عدم', 'نقص', 'توفير', 'لبس', 'يرتدي', 'مستوف', 'مرتب', 'ترتيب', 'صيانه', 'تفعل', 'تكتب', 'مطاب', 'مميز', 'تسرب'].includes(w))
    let entity = entityTokens.join(' ') || 'سلبية عامة'
    if (entity.includes('اوامر شفويه')) entity = 'نموذج الأوامر الشفوية'
    if (entity.includes('كراش كار') || entity.includes('عربه انعاش')) entity = 'عربة الإنعاش (كراش كار)'
    if (entity.includes('تسجيل دخول') || entity.includes('سجل دخول')) entity = 'سجل الدخول'
    if (entity.includes('مونيتور') || entity.includes('شاشه مراقبه')) entity = 'جهاز المونيتور'
    if (entity.includes('موظف') && entity.includes('بطاق')) entity = 'البطاقة التعريفية للموظف'
    if (entity.includes('ملف مريض') || entity.includes('ملفات مرضى')) entity = 'ملف المريض'
    if (entity.includes('جهاز صدمات')) entity = 'جهاز الصدمات الكهربائية'
    if (entity.includes('مستلزمات عزل')) entity = 'مستلزمات العزل'
    if (entity.includes('دواليب تخزين') || entity.includes('تخزين')) entity = 'دواليب التخزين'
    if (entity.includes('خطه اخلاء')) entity = 'خطة الإخلاء'
    if (entity.includes('سجل عهده')) entity = 'سجل العهدة'

    return {
      entity: entity,
      defect: defectStr,
      polarity: polarity,
      requirement: reqStr,
      scope: norm.includes('نموذج') ? 'form' : (norm.includes('سجل') ? 'record' : 'item'),
      context: 'عام',
      measurement: null,
      temporal: null
    }
  }

  _buildResult(decision, recurrenceGroupId, candidateGroupId, confidence, similarity, reasonLog, title, entity, defect, domain, reviewStatus, signature = null, sigB = null) {
    return {
      decision,
      recurrenceGroupId,
      candidateGroupId,
      confidence,
      similarity,
      reason: reasonLog,
      title,
      entity,
      defect,
      domain,
      reviewStatus,
      matchingPolicyVersion: this.policyVersion,
      signature,
      sigA: signature,
      sigB
    }
  }
}
