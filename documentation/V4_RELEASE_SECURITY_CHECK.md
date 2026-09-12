# V4 Release Security Check

**Target:** `src/app/api/analytics/recurring/route.js`
**Date:** 2026-09-12

## Security Audit Results

1. **Unauthenticated Access:** 
   - **Before:** The endpoint had no active auth check after removing `@supabase/auth-helpers-nextjs`. It was publicly accessible.
   - **After:** Strictly enforces authentication. It checks for the `Authorization: Bearer` header, and gracefully falls back to extracting the JWT from the Next.js `sb-...-auth-token` cookie if the frontend fetch does not pass headers explicitly. Unauthenticated requests now return `401 Unauthorized`.

2. **Authorization Pattern:**
   - The route now successfully implements the established project pattern (identical to `src/app/api/update-finding/route.js`). It retrieves the user's token securely and fetches the user's role and `hospital_id` from the `profiles` table via a Service Client instance.

3. **Data Scoping (Hospital Leakage Prevention):**
   - **Before:** Using `createServiceClient()` universally exposed *all* findings from *all* hospitals to any user.
   - **After:** If the user role is not `directorate_admin` or `directorate_member`, the query strictly appends `.eq('hospital_id', profile.hospital_id)`. This guarantees that standard hospital admins or team members cannot view the recurrence analytics of other hospitals.

4. **Service Role Usage:**
   - The Service Role is now safely restricted. It is used to query the view `v_report_findings`, but only *after* the programmatic authorization and scoping logic restrict the parameters to the user's allowed dataset.

## Security Verdict
✅ **PASS**

## Summary of Changes
- Replaced the vulnerable unauthenticated Service Client implementation.
- Injected `supabase.auth.getUser(token)` logic.
- Implemented robust `isDirectorate` role checks.
- Appended `.eq('hospital_id', ...)` to the data query when necessary.
- Maintained compatibility with `src/app/(app)/recurring/page.js` without altering frontend code, by implementing a secure cookie fallback parser.
