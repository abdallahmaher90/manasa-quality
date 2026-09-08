import { getEmbedding, normalizeArabicText, adjudicateFindingMatch } from '../lib/ai-parser.js'

export class VectorMatchingService {
  constructor(supabase) {
    this.supabase = supabase
    this.autoThreshold = parseFloat(process.env.VECTOR_MATCH_AUTO_THRESHOLD || '0.85')
    this.geminiLowerBound = parseFloat(process.env.VECTOR_MATCH_GEMINI_LOWER_BOUND || '0.70')
    this.embeddingModel = process.env.EMBEDDING_MODEL || 'gemini-embedding-2'
    this.embeddingDimensions = parseInt(process.env.EMBEDDING_DIMENSIONS || '768', 10)
    this.embeddingVersion = process.env.EMBEDDING_VERSION || '1.0'
  }

  async processFinding(originalText, category) {
    const normalizedText = normalizeArabicText(originalText)
    
    // 1. Exact Match on Active (Super Fast Path)
    const { data: exactActive } = await this.supabase
      .from('canonical_findings')
      .select('id')
      .eq('canonical_text', normalizedText)
      .eq('category', category)
      .eq('status', 'active')
      .maybeSingle()

    if (exactActive) {
      return this._buildResult(exactActive.id, 'exact', null, 1.0, null)
    }

    // 2. Generate Embedding
    let embedding = null
    try {
      embedding = await getEmbedding(normalizedText)
    } catch(e) { 
      console.warn('Embedding failed', e) 
    }

    if (embedding) {
      // 3. Search Active Canonicals using pgvector
      const { data: activeCandidates } = await this.supabase.rpc('match_canonical_findings', {
        query_embedding: `[${embedding.join(',')}]`,
        match_category: category,
        allowed_statuses: ['active'],
        match_limit: 5
      })

      if (activeCandidates && activeCandidates.length > 0) {
        const bestCandidate = activeCandidates[0]
        
        if (bestCandidate.similarity >= this.autoThreshold) {
          return this._buildResult(bestCandidate.id, 'vector_auto', bestCandidate.id, bestCandidate.similarity, null)
        } 
        
        if (bestCandidate.similarity >= this.geminiLowerBound) {
          // Send to Gemini Adjudication
          const adjudication = await adjudicateFindingMatch(normalizedText, activeCandidates)
          
          if (adjudication.isMatch && adjudication.matchedId) {
            return this._buildResult(adjudication.matchedId, 'gemini_adjudicated_match', bestCandidate.id, bestCandidate.similarity, adjudication.reasoning)
          } else {
            // Gemini says no match, so we must fall through to new/pending
            // We will still log the adjudication reasoning below
            return await this._handlePending(normalizedText, category, embedding, bestCandidate.similarity, bestCandidate.id, adjudication.reasoning, 'gemini_adjudicated_new')
          }
        }
      }
    }

    // 4. No Active Match -> Handle Pending (Deduplication or Create New)
    return await this._handlePending(normalizedText, category, embedding, null, null, null, 'new')
  }

  async _handlePending(normalizedText, category, embedding, bestSimilarity, candidateId, adjudicationResultText, decisionType) {
    // 4. No Active Match -> Fallback to 'غير مصنف' (Uncategorized)
    // We no longer insert new pending canonical findings here because regular users 
    // do not have INSERT permissions on canonical_findings per the new governance rules.
    const { data: uncategorized } = await this.supabase
      .from('canonical_findings')
      .select('id')
      .eq('canonical_text', 'غير مصنف')
      .maybeSingle()
      
    let canonicalId = uncategorized?.id || null

    return this._buildResult(canonicalId, decisionType, candidateId, bestSimilarity, adjudicationResultText)
  }

  _buildResult(canonicalId, matchingMethod, candidateId, similarity, adjudicationResultText) {
    return {
      canonicalId,
      matchLog: {
        similarity_score: similarity,
        candidate_canonical_id: candidateId,
        matching_method: matchingMethod,
        adjudication_result: adjudicationResultText,
        embedding_model: this.embeddingModel,
        embedding_dimensions: this.embeddingDimensions,
        embedding_version: this.embeddingVersion,
        threshold_used: matchingMethod.includes('auto') ? this.autoThreshold : this.geminiLowerBound
      }
    }
  }

  async logMatch(matchLogData, originalText) {
    await this.supabase.from('finding_match_logs').insert({
      finding_text: originalText,
      ...matchLogData
    })
  }
}
