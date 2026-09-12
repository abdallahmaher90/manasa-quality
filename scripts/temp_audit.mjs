import fs from 'fs'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: 'd:/manasa/.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function audit() {
  console.log("Fetching findings...");
  let allFindings = [];
  let from = 0;
  while (true) {
    const { data: rfs, error } = await supabase.from('report_findings').select('id, recurrence_group_id, original_text, hospital_id, created_at, review_status, match_reason, status').range(from, from + 999);
    if (error) {
      console.error(error);
      return;
    }
    allFindings = allFindings.concat(rfs);
    if (rfs.length < 1000) break;
    from += 1000;
  }
  
  console.log("Fetching groups...");
  let allGroups = [];
  from = 0;
  while (true) {
    const { data: groups, error } = await supabase.from('recurrence_groups').select('id, title, review_status').range(from, from + 999);
    if (error) {
      console.error(error);
      return;
    }
    allGroups = allGroups.concat(groups);
    if (groups.length < 1000) break;
    from += 1000;
  }

  const rfs = allFindings;
  const groups = allGroups;

  const rfCount = rfs.length;
  const rgCount = groups.length;
  
  let groupMap = new Map();
  for (const rf of rfs) {
    if (rf.recurrence_group_id) {
      if (!groupMap.has(rf.recurrence_group_id)) groupMap.set(rf.recurrence_group_id, []);
      groupMap.get(rf.recurrence_group_id).push(rf);
    }
  }

  let singleOccGroupCount = 0;
  let multiOccGroupCount = 0;
  let intraHospitalRecurrence = 0;
  let interHospitalRecurrence = 0;

  for (const [gid, items] of groupMap.entries()) {
    if (items.length === 1) {
      singleOccGroupCount++;
    } else if (items.length > 1) {
      multiOccGroupCount++;
      const uniqueHospitals = new Set(items.map(i => i.hospital_id));
      if (uniqueHospitals.size < items.length) {
        // At least one hospital has multiple occurrences (Intra-hospital)
        intraHospitalRecurrence++;
      }
      if (uniqueHospitals.size > 1) {
        // Shared between hospitals (Inter-hospital)
        interHospitalRecurrence++;
      }
    }
  }

  let pendingReviewCount = rfs.filter(r => r.review_status === 'pending_review').length;
  let confirmedCount = rfs.filter(r => r.review_status === 'confirmed').length;
  let singleStatusCount = rfs.filter(r => r.review_status === 'single' || r.review_status === 'confirmed_separate' || !r.recurrence_group_id || groupMap.get(r.recurrence_group_id)?.length === 1).length;

  console.log('=== DATA AUDIT ===');
  console.log('إجمالي report_findings:', rfCount);
  console.log('إجمالي recurrence_groups:', rgCount);
  console.log('عدد recurrence groups التي تحتوي occurrence واحد فقط:', singleOccGroupCount);
  console.log('عدد recurrence groups التي تحتوي أكثر من occurrence:', multiOccGroupCount);
  console.log('عدد المجموعات التي تتكرر داخل نفس hospital:', intraHospitalRecurrence);
  console.log('عدد المجموعات التي تظهر في أكثر من hospital:', interHospitalRecurrence);
  console.log('عدد findings pending_review:', pendingReviewCount);
  console.log('عدد findings confirmed:', confirmedCount);
  
  // Create output files for false positive/negative analysis
  const falsePositiveCandidates = []; // groups with many distinct texts
  
  for (const [gid, items] of groupMap.entries()) {
    if (items.length > 1) {
      falsePositiveCandidates.push({
        id: gid,
        title: groups.find(g => g.id === gid)?.title,
        items: items.map(i => ({ id: i.id, text: i.original_text, hosp: i.hospital_id }))
      });
    }
  }
  
  fs.writeFileSync('C:/Users/Dr Abdallah/.gemini/antigravity-ide/brain/be48360a-d082-48ef-a62c-f7305ced7778/scratch/multi_groups.json', JSON.stringify(falsePositiveCandidates, null, 2));

  // Dump findings for false negative audit (same hospital, different group, similar text)
  fs.writeFileSync('C:/Users/Dr Abdallah/.gemini/antigravity-ide/brain/be48360a-d082-48ef-a62c-f7305ced7778/scratch/all_findings.json', JSON.stringify(rfs.map(r => ({id: r.id, group: r.recurrence_group_id, text: r.original_text, hosp: r.hospital_id})), null, 2));
}

audit();
