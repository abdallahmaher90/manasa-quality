# RECURRENCE_ENGINE_STABLE_BASELINE
**Date:** 2026-09-11
**Status:** STABLE / POST-MIGRATION
**Component:** Recurrence Matching Engine & Analytics

## Current State
- **Total Findings:** 1366
- **Finalized Recurrence Migrations (Phase 1 & SAFE DISTINCT):** 128
- **Orphan Groups:** 239 (Intentionally retained, no housekeeping currently applied)
- **Pending Semantic Adjudication:** 65 cases queued (`NEEDS_GEMINI_LATER`)
- **Unresolved / Uncertain:** The rest of the findings remain exactly as they were, pending future review.

## Constraints in Place
- **NO DELETION:** Orphan groups are kept to prevent cascade issues and maintain historical integrity.
- **NO AUTO-MERGING:** The V4 matcher explicitly flags ambiguous cases and does NOT merge unless strong evidence (lexical + semantic + context + NO hard negatives) is met.
- **MANUAL / SEMANTIC ADJUDICATION REQUIRED:** Ambiguous cases must be evaluated individually (via LLM or human).

*This baseline is certified post-migration. No further migrations or Gemini bulk runs are scheduled for this phase.*
