# V4 Release Scope Analysis
**Date:** 2026-09-12
**Objective:** Analyze dependency graph and determine safe git commit boundary for the V4 Recurrence Engine + Bug Fix without leaking test files.

## 1. REQUIRED FOR PRODUCTION
These files form the critical runtime path for the Future Recurrence Flow and must be committed together.

- **`src/services/recurrence-matcher.service.js`**
  - **Status:** Modified (Unstaged)
  - **Contents:** Contains the complete V4 Recurrence Matching Engine rewrite, including the `_heuristicExtract`, 8-step retrieval funnel, and the `bestCandidate.id` bug fix.
  - **Dependency Note:** Calls functions exported from `ai-parser.js`.

- **`src/lib/ai-parser.js`**
  - **Status:** Modified (Unstaged)
  - **Contents:** Introduces `extractSemanticIssueSignature` and the V4 signature-based `adjudicateFindingMatch`. 
  - **Dependency Note:** `recurrence-matcher.service.js` will throw a runtime/build error if this file is not committed alongside it.

## 2. OPTIONAL / UI
- **`src/app/(app)/recurring/page.js`**
  - **Status:** Modified (Unstaged)
  - **Contents:** Purely UI/Visual changes for the Recurring Issues Dashboard (refactoring hospital pills and labels).
  - **Impact:** Safe to commit if visual updates are desired, but does not impact the backend `save-report` API logic.

## 3. TEST/LOCAL ONLY (DO NOT COMMIT)
- **`scripts/*` (e.g., `run_future_recurrence_e2e_test.mjs`, `audit_*.mjs`)**
  - **Status:** Untracked
  - **Contents:** Admin scripts, E2E tests, and migration logic.
- **`documentation/*` & `*.json` / `*.md` in Root**
  - **Status:** Untracked
  - **Contents:** Test results, queue states, and Markdown reports.
  - **Impact:** These are local artifacts. They are automatically ignored by Vercel deployments unless explicitly tracked in Git, which they should not be.

## 4. RISK ASSESSMENT
- 🔴 **DANGER (Build Failure):** Committing `src/services/recurrence-matcher.service.js` without `src/lib/ai-parser.js` will cause a **Vercel Build Failure** due to missing module exports (`extractSemanticIssueSignature` is absent in the `HEAD` version of `ai-parser.js`).
- 🟡 **WARNING:** The V4 Engine in `recurrence-matcher.service.js` relies heavily on Gemini for disambiguation. Ensure `GEMINI_API_KEY` quota is sufficient in Production, otherwise the engine will safely fallback to `UNCERTAIN` and flag for manual review, causing a buildup in the semantic queue.

## Final Recommended Commit List:
To safely deploy the bug fix and the engine it resides in, run:
```bash
git add src/services/recurrence-matcher.service.js
git add src/lib/ai-parser.js
git add src/app/(app)/recurring/page.js
git commit -m "feat: upgrade recurrence matcher to V4 and fix group resolution bug"
```
