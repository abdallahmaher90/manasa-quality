import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// Simple normalization and tokenization for lexical search
function normalizeText(text) {
    if (!text) return '';
    return text.toLowerCase()
        .replace(/[أإآا]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/(^|\s)و(?=ال)/g, '$1')
        .replace(/[^\w\s\u0600-\u06FF]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenize(text) {
    const stopWords = new Set(['في', 'من', 'على', 'لا', 'يوجد', 'عدم', 'غير', 'مع', 'الى', 'عن', 'ان', 'او', 'لم']);
    return new Set(normalizeText(text).split(' ').filter(w => w.length > 2 && !stopWords.has(w)));
}

function lexicalOverlap(tokens1, tokens2) {
    if (tokens1.size === 0 || tokens2.size === 0) return 0;
    let overlap = 0;
    tokens1.forEach(t => {
        if (tokens2.has(t)) overlap++;
    });
    return overlap / Math.min(tokens1.size, tokens2.size); // Dice-like coefficient based on smaller set
}

async function runRetrievalGapAudit() {
    console.log("Starting RETRIEVAL GAP AUDIT...");

    const localResults = JSON.parse(fs.readFileSync('historical_local_preparation_results.json', 'utf8'));
    
    // We already know from our earlier runs that:
    // Zero candidates: 7 items (embedding_available !== false && top_candidates.length === 0)
    // Missing embeddings: 30 items (embedding_available === false)

    const uncertain = localResults.filter(f => f.local_decision === 'LOCAL_UNCERTAIN');
    
    const zeroCandidatesFindings = uncertain.filter(u => u.embedding_available !== false && (!u.top_candidates || u.top_candidates.length === 0));
    const missingEmbeddingFindings = uncertain.filter(u => u.embedding_available === false);

    const allFindingIds = [...zeroCandidatesFindings, ...missingEmbeddingFindings].map(f => f.finding_id);
    const { data: dbFindings } = await supabase.from('report_findings').select('id, department_id, hospital_id').in('id', allFindingIds);
    const dbFindingsMap = new Map(dbFindings.map(f => [f.id, f]));

    const { data: allGroups } = await supabase.from('recurrence_groups').select('id, title');
    
    // Pre-tokenize all groups for fast lexical search
    const groupTokens = allGroups.map(g => ({
        id: g.id,
        title: g.title,
        tokens: tokenize(g.title)
    }));

    function findBestLexicalMatch(textTokens) {
        let bestMatch = null;
        let highestScore = 0;
        for (const g of groupTokens) {
            const score = lexicalOverlap(textTokens, g.tokens);
            if (score > highestScore && score > 0.5) { // minimum 50% overlap of smaller set
                highestScore = score;
                bestMatch = g;
            }
        }
        return { bestMatch, score: highestScore };
    }

    const summary = {
        zero_candidates: zeroCandidatesFindings.length,
        missing_embeddings: missingEmbeddingFindings.length,
        recoverable_without_embedding: 0,
        true_retrieval_blocked: 0,
        vocabulary_gaps: 0,
        potential_genuine_new_issues: 0,
        top_missing_terms: {}
    };

    const zeroCandidatesAudit = [];
    const missingEmbeddingsAudit = [];

    // Analyze Zero Candidates
    for (const f of zeroCandidatesFindings) {
        const tokens = tokenize(f.original_text);
        const { bestMatch, score } = findBestLexicalMatch(tokens);
        
        let cause = 'OTHER';
        if (tokens.size < 3) cause = 'TOO_SHORT_AMBIGUOUS';
        else if (bestMatch && score > 0.6) cause = 'NORMALIZATION_GAP'; // Found lexically but missed by semantic V4
        else if (tokens.size >= 4 && !bestMatch) cause = 'GENUINELY_NEW_ISSUE';
        else cause = 'VOCABULARY_GAP';

        if (cause === 'VOCABULARY_GAP') summary.vocabulary_gaps++;
        if (cause === 'GENUINELY_NEW_ISSUE') summary.potential_genuine_new_issues++;
        
        // Track missing terms
        if (!bestMatch) {
            tokens.forEach(t => {
                summary.top_missing_terms[t] = (summary.top_missing_terms[t] || 0) + 1;
            });
        }

        const dbRec = dbFindingsMap.get(f.finding_id);
        zeroCandidatesAudit.push({
            finding_id: f.finding_id,
            original_text: f.original_text,
            hospital_id: f.hospital_id,
            department_id: dbRec ? dbRec.department_id : null,
            current_recurrence_group_id: f.current_recurrence_group_id,
            normalized_text: normalizeText(f.original_text),
            concepts_extracted: f.entity_matches || [], // From V4 json
            entity: f.entity_matches,
            defect: f.defect_matches,
            requirement: f.context_match,
            lexical_tokens: Array.from(tokens),
            embedding_available: f.embedding_available !== false,
            cause,
            lexical_candidate_found: !!bestMatch,
            best_lexical_candidate: bestMatch ? bestMatch.title : null,
            best_lexical_score: score
        });
    }

    // Analyze Missing Embeddings
    for (const f of missingEmbeddingFindings) {
        const tokens = tokenize(f.original_text);
        const { bestMatch, score } = findBestLexicalMatch(tokens);

        let impact = 'RETRIEVAL_BLOCKED';
        if (bestMatch && score > 0.8) {
            impact = 'LOW_IMPACT';
            summary.recoverable_without_embedding++;
        } else if (bestMatch && score > 0.5) {
            impact = 'MEDIUM_IMPACT';
            summary.recoverable_without_embedding++;
        } else {
            impact = 'HIGH_IMPACT'; // Blocked entirely because no lexical match either
            summary.true_retrieval_blocked++;
        }

        const dbRec = dbFindingsMap.get(f.finding_id);
        missingEmbeddingsAudit.push({
            finding_id: f.finding_id,
            original_text: f.original_text,
            hospital_id: f.hospital_id,
            department_id: dbRec ? dbRec.department_id : null,
            concepts: f.entity_matches || [],
            recoverable_without_embedding: !!bestMatch,
            best_lexical_candidate: bestMatch ? bestMatch.title : null,
            lexical_score: score,
            impact
        });
    }

    // Sort terms
    const sortedTerms = Object.entries(summary.top_missing_terms)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20);

    const fullOutput = {
        summary: {
            ...summary,
            top_missing_terms: Object.fromEntries(sortedTerms)
        },
        zero_candidates: zeroCandidatesAudit,
        missing_embeddings: missingEmbeddingsAudit
    };

    fs.writeFileSync('retrieval_gap_audit.json', JSON.stringify(fullOutput, null, 2));

    // Markdown Report
    let mdContent = `# Retrieval Gap Audit\n\n`;
    mdContent += `## Summary\n`;
    mdContent += `- **Zero Candidates:** ${summary.zero_candidates}\n`;
    mdContent += `- **Missing Embeddings:** ${summary.missing_embeddings}\n`;
    mdContent += `- **Recoverable without Embedding (Lexical):** ${summary.recoverable_without_embedding}\n`;
    mdContent += `- **True Retrieval Blocked:** ${summary.true_retrieval_blocked}\n`;
    mdContent += `- **Vocabulary Gaps:** ${summary.vocabulary_gaps}\n`;
    mdContent += `- **Potential Genuine New Issues:** ${summary.potential_genuine_new_issues}\n\n`;

    mdContent += `### Top Missing Terms/Concepts\n`;
    for (const [term, count] of sortedTerms) {
        mdContent += `- \`${term}\`: ${count} occurrences\n`;
    }
    mdContent += `\n---\n\n`;

    mdContent += `## Zero Candidates Analysis (Total: ${summary.zero_candidates})\n\n`;
    for (const z of zeroCandidatesAudit) {
        mdContent += `### Finding: \`${z.original_text}\`\n`;
        mdContent += `- **Finding ID:** ${z.finding_id}\n`;
        mdContent += `- **Cause:** **${z.cause}**\n`;
        mdContent += `- **Lexical Tokens:** ${z.lexical_tokens.join(', ')}\n`;
        if (z.lexical_candidate_found) {
            mdContent += `- **Lexical Near-Match Found in DB:** \`${z.best_lexical_candidate}\` (Score: ${z.best_lexical_score.toFixed(2)})\n`;
            mdContent += `  *Note: The V4 semantic engine missed this, indicating a NORMALIZATION_GAP or embedding gap.*\n`;
        } else {
            mdContent += `- **Lexical Candidate:** None found.\n`;
        }
        mdContent += `\n`;
    }

    mdContent += `## Missing Embeddings Analysis (Total: ${summary.missing_embeddings})\n\n`;
    for (const m of missingEmbeddingsAudit) {
        mdContent += `### Finding: \`${m.original_text}\`\n`;
        mdContent += `- **Finding ID:** ${m.finding_id}\n`;
        mdContent += `- **Impact:** **${m.impact}**\n`;
        if (m.recoverable_without_embedding) {
            mdContent += `- **Recoverable Lexically:** Yes -> \`${m.best_lexical_candidate}\` (Score: ${m.lexical_score.toFixed(2)})\n`;
        } else {
             mdContent += `- **Recoverable Lexically:** No.\n`;
        }
        mdContent += `\n`;
    }

    fs.writeFileSync('retrieval_gap_audit.md', mdContent);
    console.log("Audit complete. Output: retrieval_gap_audit.json, retrieval_gap_audit.md");
}

runRetrievalGapAudit().catch(console.error);
