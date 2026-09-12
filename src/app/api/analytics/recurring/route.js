import { NextResponse } from 'next/server'
import { createServiceClient, supabase as supabaseClient } from '@/lib/supabase'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    let token = request.headers.get('authorization')?.replace('Bearer ', '')

    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token)
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabaseAdmin = createServiceClient()
    const { data: profile } = await supabaseAdmin.from('profiles').select('role, hospital_id').eq('id', user.id).single()
    const isDirectorate = profile?.role === 'directorate_admin' || profile?.role === 'directorate_member'

    // Fetch all findings with scoping
    let allFindings = []
    let page = 0
    const pageSize = 1000

    while (true) {
      let query = supabaseAdmin
        .from('v_report_findings')
        .select(`
          id,
          canonical_text,
          original_text,
          status,
          repeat_count,
          last_seen_date,
          first_seen_date,
          resolved_date,
          resolved_by,
          resolution_note,
          hospital_resolution_note,
          recurrence_group_id,
          recurrence_group_title,
          recurrence_entity,
          recurrence_defect,
          review_status,
          departments (id, name),
          hospitals (id, name, governorate)
        `)
        .neq('review_status', 'pending_review') // ignore pending review
      
      // Early Exit if Hospital Admin has no hospital assigned
      if (!isDirectorate && !profile?.hospital_id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const { data, error } = await query.range(page * pageSize, (page + 1) * pageSize - 1)

      if (error) throw error
      if (!data || data.length === 0) break
      allFindings = allFindings.concat(data)
      page++
      if (data.length < pageSize) break
    }

    // Grouping logic:
    // We group purely by recurrence_group_id (or finding id if no group).
    const groupMap = new Map()

    for (const f of allFindings) {
      if (!f.hospitals) continue
      
      const groupId = f.recurrence_group_id || f.id
      const groupTitle = f.recurrence_group_title || f.original_text || 'سلبية غير مصنفة'
      
      if (!groupMap.has(groupId)) {
        groupMap.set(groupId, {
          groupId,
          title: groupTitle,
          entity: f.recurrence_entity,
          defect: f.recurrence_defect,
          canonicalClassification: f.canonical_text,
          hospitalsMap: new Map() // hospitalId -> { info, findings: [] }
        })
      }
      
      const hMap = groupMap.get(groupId).hospitalsMap
      if (!hMap.has(f.hospitals.id)) {
        hMap.set(f.hospitals.id, {
          id: f.hospitals.id,
          name: f.hospitals.name,
          governorate: f.hospitals.governorate,
          findings: []
        })
      }
      
      hMap.get(f.hospitals.id).findings.push(f)
    }

    const recurringInSameHospital = [] // Issues where AT LEAST ONE hospital has >= 2 occurrences
    const commonAcrossHospitals = [] // Issues that appeared in >= 2 DIFFERENT hospitals

    for (const [groupId, info] of groupMap.entries()) {
      const hospitalEntries = Array.from(info.hospitalsMap.values())
      
      // Process each hospital's status
      const processedHospitals = hospitalEntries.map(h => {
        const hasActive = h.findings.some(f => ['open', 'recurring'].includes(f.status))
        const hasPending = h.findings.some(f => f.status === 'resolved_by_hospital')
        const allResolved = h.findings.length > 0 && h.findings.every(f => f.status === 'resolved_confirmed')

        let issueStatus = 'active'
        if (allResolved) issueStatus = 'resolved'
        else if (hasPending && !hasActive) issueStatus = 'pending'

        const repeatCount = h.findings.length
        const latestDate = h.findings.map(f => f.last_seen_date || f.first_seen_date).filter(Boolean).sort().reverse()[0]
        const resolvedDate = h.findings.map(f => f.resolved_date).filter(Boolean).sort().reverse()[0]
        
        // Extract departments this issue appeared in
        const depts = [...new Set(h.findings.map(f => f.departments?.name).filter(Boolean))]

        return {
          ...h,
          issueStatus,
          repeatCount,
          latestDate,
          resolvedDate,
          departments: depts
        }
      })
      
      processedHospitals.sort((a, b) => {
        const w = { active: 0, pending: 1, resolved: 2 }
        return w[a.issueStatus] - w[b.issueStatus]
      })

      const totalHospitals = processedHospitals.length
      const totalOccurrences = processedHospitals.reduce((acc, h) => acc + h.repeatCount, 0)
      const activeCount = processedHospitals.filter(h => h.issueStatus === 'active').length
      const pendingCount = processedHospitals.filter(h => h.issueStatus === 'pending').length
      const resolvedCount = processedHospitals.filter(h => h.issueStatus === 'resolved').length
      
      const item = {
        groupId,
        title: info.title,
        entity: info.entity,
        defect: info.defect,
        canonicalClassification: info.canonicalClassification,
        totalHospitals,
        totalOccurrences,
        activeCount,
        pendingCount,
        resolvedCount,
        isFullyResolved: activeCount === 0 && pendingCount === 0,
        hospitalsList: processedHospitals,
        allDepartments: [...new Set(processedHospitals.flatMap(h => h.departments))]
      }

      // Categorize into the two buckets
      const hasIntraHospitalRecurrence = processedHospitals.some(h => h.repeatCount >= 2)
      if (hasIntraHospitalRecurrence) {
        // Only include the hospitals that ACTUALLY recurred for the "Recurring" tab
        const recurringHospitalsOnly = processedHospitals.filter(h => h.repeatCount >= 2)
        recurringInSameHospital.push({
          ...item,
          hospitalsList: recurringHospitalsOnly,
          totalHospitals: recurringHospitalsOnly.length,
          totalOccurrences: recurringHospitalsOnly.reduce((acc, h) => acc + h.repeatCount, 0),
          activeCount: recurringHospitalsOnly.filter(h => h.issueStatus === 'active').length,
          pendingCount: recurringHospitalsOnly.filter(h => h.issueStatus === 'pending').length,
          resolvedCount: recurringHospitalsOnly.filter(h => h.issueStatus === 'resolved').length,
        })
      }

      if (totalHospitals >= 2) {
        commonAcrossHospitals.push(item)
      }
    }

    // Post-Grouping Hospital Scoping Enforcement
    let finalRecurring = recurringInSameHospital
    let finalCommon = commonAcrossHospitals

    if (!isDirectorate && profile?.hospital_id) {
      const isMyHospital = (h) => h.id === profile.hospital_id

      finalRecurring = recurringInSameHospital.filter(group => {
        const myHospital = group.hospitalsList.find(isMyHospital)
        return myHospital && myHospital.repeatCount >= 2
      })

      finalCommon = commonAcrossHospitals.filter(group => {
        return group.hospitalsList.some(isMyHospital)
      })

      const maskHospitals = (group) => {
        return {
          ...group,
          hospitalsList: group.hospitalsList.filter(isMyHospital),
          allDepartments: [...new Set(group.hospitalsList.filter(isMyHospital).flatMap(h => h.departments))]
        }
      }

      finalRecurring = finalRecurring.map(maskHospitals)
      finalCommon = finalCommon.map(maskHospitals)
    }

    // Sort by active issues first, then total occurrences
    const sorter = (a, b) => {
      if (b.activeCount !== a.activeCount) return b.activeCount - a.activeCount
      return b.totalOccurrences - a.totalOccurrences
    }

    finalRecurring.sort(sorter)
    finalCommon.sort(sorter)

    return NextResponse.json({
      success: true,
      data: {
        recurringInSameHospital: finalRecurring,
        commonAcrossHospitals: finalCommon
      }
    })

  } catch (error) {
    console.error('API Error /analytics/recurring:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
