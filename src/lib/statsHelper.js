import { supabase } from '@/lib/supabase'

export async function fetchAllHospitalFindings() {
  let allFindings = []
  let from = 0
  const limit = 1000
  let hasMore = true

  while (hasMore) {
    const { data, error } = await supabase
      .from('v_report_findings')
      .select('id, hospital_id, status, review_status, recurrence_group_id')
      .range(from, from + limit - 1)

    if (error) {
      console.error('Error fetching findings:', error)
      break
    }

    if (data && data.length > 0) {
      allFindings = [...allFindings, ...data]
      from += limit
    }

    if (!data || data.length < limit) {
      hasMore = false
    }
  }

  return allFindings
}

export function computeHospitalStats(hospitals, allFindings) {
  return hospitals.map(h => {
    const hFindings = allFindings.filter(f => f.hospital_id === h.id)
    
    // Group findings to find true recurring issues (count >= 2)
    const groups = new Map()
    hFindings.forEach(f => {
      const grpKey = f.recurrence_group_id || f.id
      if (!groups.has(grpKey)) groups.set(grpKey, { count: 0 })
      if (f.review_status !== 'pending_review') {
        groups.get(grpKey).count++
      }
    })
    
    const recurringGroupIds = new Set(
      Array.from(groups.entries())
        .filter(([_, g]) => g.count >= 2)
        .map(([id]) => id)
    )

    // Open findings count
    const openFindingsList = hFindings.filter(f => ['open', 'recurring'].includes(f.status))
    const open = openFindingsList.length
    
    // Recurring findings count (number of unique recurring groups among the active open/recurring findings)
    const hospGroups = new Set()
    openFindingsList.forEach(f => {
      const grpKey = f.recurrence_group_id || f.id
      if (recurringGroupIds.has(grpKey)) {
          hospGroups.add(grpKey)
      }
    })
    const recurring = hospGroups.size

    // Resolved findings count
    const resolved = hFindings.filter(f => f.status === 'resolved_confirmed').length
    
    // Pending confirm findings count
    const pendingConfirm = hFindings.filter(f => f.status === 'resolved_by_hospital' || f.status === 'pending_review').length
    
    return { 
      ...h, 
      open, 
      recurring, 
      resolved, 
      pendingConfirm, 
      total: open // Usually 'total' implies active open issues, but previously it was open + recurring. We'll use just 'open' as the total active.
    }
  })
}
