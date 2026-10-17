import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Helper to get or create a department for a hospital
async function getOrCreateDept(hospitalId, deptName, deptCache) {
  const key = `${hospitalId}:::${deptName.trim()}`;
  if (deptCache.has(key)) return deptCache.get(key);

  // Check in DB
  const { data: existing } = await supabase
    .from('departments')
    .select('id, name')
    .eq('hospital_id', hospitalId)
    .ilike('name', deptName.trim())
    .maybeSingle();

  if (existing) {
    deptCache.set(key, existing.id);
    return existing.id;
  }

  // Create new department
  const { data: created, error } = await supabase
    .from('departments')
    .insert({
      hospital_id: hospitalId,
      name: deptName.trim()
    })
    .select('id')
    .single();

  if (error) {
    console.error(`Error creating dept ${deptName} for hosp ${hospitalId}:`, error);
    throw error;
  }

  console.log(`[Created Dept] ${deptName} for hospital ${hospitalId} -> ID: ${created.id}`);
  deptCache.set(key, created.id);
  return created.id;
}

// Logic to determine target department for a finding
function determineTargetDept(hospitalName, fileName, text) {
  const t = text || '';
  const fn = fileName || '';

  // 1. مستشفى كفر الشيخ العام
  if (hospitalName.includes('كفر الشيخ العام')) {
    if (fn.includes('كفرالشيخ العام 2.6.2026')) return 'المعمل';
    if (fn.includes('كفر الشيخ العام 6-7-2026')) {
      if (t.includes('الكراش') || t.includes('السكتة') || t.includes('الإنذارات') || t.includes('السقوط') || t.includes('أدويه') || t.includes('ادويه')) {
        return 'وحدة السكتة الدماغية';
      }
    }
    if (t.includes('سجل استلام التذاكر الطبيه بالأرشيف') || t.includes('بالأرشيف')) return 'الأرشيف';
    if (t.includes('التذاكر') || t.includes('التذكره') || t.includes('الملف الطب')) return 'الملف الطبي';
    if (t.includes('وجبات المرضى')) return 'المطبخ';
    if (t.includes('النتائج الحرج') || t.includes('العينات')) return 'المعمل';
    if (t.includes('طرف المريض') || t.includes('صرف العلاج') || t.includes('الصيدلي')) return 'الصيدلية';
    if (t.includes('سجلات الكراش') || t.includes('كوميدينو المرضى')) return 'القسم الداخلي';
    if (t.includes('العمليه الجراحيه') || t.includes('الجراحة')) return 'قسم الجراحة';
    if (t.includes('لوحة المفاتيح') || t.includes('المفاتيح غير مامنه')) return 'الصيانة';
    if (t.includes('صراصير بالمطبخ')) return 'المطبخ';
    return 'عموم المستشفى';
  }

  // 2. مستشفي فيصل سعود الفليج
  if (hospitalName.includes('فيصل سعود الفليج')) {
    if (t.includes('حماية مدنيه') || t.includes('كواشف الدخان') || t.includes('الحريق')) return 'السلامة والصحة المهنية والحماية المدنية';
    if (t.includes('اسانسير') || t.includes('المولد') || t.includes('صيانة')) return 'الصيانة';
    if (t.includes('الأشعة السينية') || t.includes('الاشعة')) return 'الأشعة';
    if (t.includes('الأدوية') || t.includes('الصيدلية') || t.includes('أدوية')) return 'الصيدلية';
    if (t.includes('المخلفات الكيميائية')) return 'النفايات الخطرة';
    if (t.includes('نتائج حرجة بتذاكر') || t.includes('الملف الطب')) return 'الملف الطبي';
    if (t.includes('ترخيص لوحدات الكلي')) return 'وحدة الغسيل الكلوي';
    if (t.includes('غرفة طوارىء') || t.includes('نظام فرز')) return 'الطوارئ والاستقبال';
    if (t.includes('مقياس كلور')) return 'مكافحة العدوى';
    return 'عموم المستشفى';
  }

  // 3. مستشفى دسوق العام
  if (hospitalName.includes('دسوق العام')) {
    if (t.includes('كروت الاصناف') || t.includes('الادوية') || t.includes('الادويه') || t.includes('أدوية') || t.includes('الثلاجه')) {
      return 'الصيدلية';
    }
    return 'عموم المستشفى';
  }

  // 4. مستشفى سيدي سالم المركزي
  if (hospitalName.includes('سيدي سالم')) {
    if (t.includes('صيانه') || t.includes('صيانة') || t.includes('الاجهزه الطبيه') || t.includes('الثلاجات والتكيييفات')) return 'الصيانة';
    if (t.includes('التذاكر الطبيه') || t.includes('التذاكر') || t.includes('اختصارات ممنوعه') || t.includes('امضاءات التمريض') || t.includes('امضاءات الطبيب')) return 'الملف الطبي';
    if (t.includes('كلور ومناديل') || t.includes('غسل الايدي') || t.includes('اللحظات الخمسه')) return 'مكافحة العدوى';
    if (t.includes('الإجراء الجراحي') || t.includes('نماذج الجراحه')) return 'العمليات';
    if (t.includes('النتائج الحرجه') || t.includes('المعمل')) return 'المعمل';
    if (t.includes('الإسعاف والطوارئ') || t.includes('والطوارئ والنجده')) return 'الطوارئ والاستقبال';
    if (t.includes('الماسه الكيميائيه') || t.includes('المواد الكيميائيه الخطره')) return 'السلامة والصحة المهنية';
    return 'عموم المستشفى';
  }

  // 5. مستشفى فوه المركزي
  if (hospitalName.includes('فوه المركزي')) {
    if (t.includes('جلوكوز') || t.includes('تاريخ صلاحيتهم') || t.includes('ادوية') || t.includes('أدوية')) return 'الصيدلية';
    if (t.includes('النتائج الحرجه')) return 'المعمل';
    if (t.includes('الملف الطبى') || t.includes('السجلات') || t.includes('امضاءات الفريق الطبي')) return 'الملف الطبي';
    if (t.includes('النفايات') || t.includes('اكياس النفايات') || t.includes('طفايا') || t.includes('Race &pass')) return 'السلامة والصحة المهنية والحماية المدنية';
    if (t.includes('ملفات العاملين') || t.includes('القوة البشريه') || t.includes('الشكاوى') || t.includes('الشكاوي')) return 'إدارة المستشفى';
    return 'عموم المستشفى';
  }

  // 6. مستشفي الحامول المركزي
  if (hospitalName.includes('الحامول')) {
    if (t.includes('التعقيم') || t.includes('الاوتوكلاف') || t.includes('تعقيمها')) return 'التعقيم';
    if (t.includes('سجل الطوارئ') || t.includes('قسم الطوارئ')) return 'الطوارئ والاستقبال';
    if (t.includes('ملفات المرضي') || t.includes('اقرارات موافقه') || t.includes('بيانات النماذج') || t.includes('امضاءات الفريق الطبي') || t.includes('الانذارات الحرجه')) return 'الملف الطبي';
    return 'عموم المستشفى';
  }

  // 7. مستشفى الرمد الرئيسي
  if (hospitalName.includes('الرمد')) {
    if (t.includes('طلمبات') || t.includes('تقريرصيانة') || t.includes('مناورات بحمل') || t.includes('المولد')) return 'الصيانة';
    if (t.includes('نفايات كيميائية')) return 'غرفة النفايات';
    if (t.includes('السياسيات غير محدثة')) return 'إدارة المستشفى';
    return 'عموم المستشفى';
  }

  // 8. مستشفى حميات كفر الشيخ
  if (hospitalName.includes('حميات كفر الشيخ')) {
    if (t.includes('الأدوية') || t.includes('الادويه') || t.includes('أدوية') || t.includes('الكراش')) return 'الصيدلية';
    if (t.includes('سجل cpr')) return 'الطوارئ والاستقبال';
    if (t.includes('استدعاء التمريض') || t.includes('كوميدينو')) return 'القسم الداخلي';
    if (t.includes('توقيع الاطباء') || t.includes('التسليم والتسلم') || t.includes('نماذج الملف الطبي') || t.includes('الاختصارات')) return 'الملف الطبي';
    if (t.includes('ترخيص حماية مدنيه')) return 'السلامة والصحة المهنية';
    return 'عموم المستشفى';
  }

  // 9. مستشفى جلدية وجذام كفرالشيخ
  if (hospitalName.includes('جلدية')) {
    if (t.includes('مخزن المستشفي')) return 'المخزن';
    if (t.includes('صيانة دورية للأجهزة') || t.includes('لوحات الكهرباء') || t.includes('كسر في الارضيات')) return 'الصيانة';
    if (t.includes('النفايات الكيميائية الخطرة')) return 'غرفة النفايات';
    if (t.includes('انذار الحريق') || t.includes('المواد الكيميائية الخطرة') || t.includes('المناورات للحريق')) return 'السلامة';
    if (t.includes('ملفات العاملين') || t.includes('خطة توظيف') || t.includes('فهرس للعاملين')) return 'إدارة المستشفى';
    if (t.includes('سجل الاحاله') || t.includes('مسؤول الاحاله') || t.includes('قائمه بمستشفيات الاحاله') || t.includes('الحالات التي تتطلب احاله')) return 'الإحالة الداخلية';
    if (t.includes('الملفات غير مطابق') || t.includes('تقييم الم') || t.includes('تقييم مخاطر سقوط') || t.includes('تعريف المريض')) return 'الملف الطبي';
    return 'عموم المستشفى';
  }

  // 10. مستشفي بيلا المركزي
  if (hospitalName.includes('بيلا')) {
    if (t.includes('المخازن غير نظيفة')) return 'المخازن';
    return 'عموم المستشفى';
  }

  // 11. مستشفى صدر كفرالشيخ
  if (hospitalName.includes('صدر كفرالشيخ')) {
    if (t.includes('الهيكل التنظيمي') || t.includes('صندوق الشكاوي')) return 'إدارة المستشفى';
    if (t.includes('كروت تعريف وصيانه علي الاجهزه الطبيه')) return 'الصيانة';
    return 'عموم المستشفى';
  }

  return 'عموم المستشفى';
}

async function run() {
  console.log('--- STARTING COMPREHENSIVE DEPARTMENT REDISTRIBUTION ---');

  const { data: hospitals } = await supabase.from('hospitals').select('id, name');
  const { data: depts } = await supabase.from('departments').select('id, hospital_id, name');
  const { data: reports } = await supabase.from('reports').select('id, file_name');

  const hospMap = Object.fromEntries(hospitals.map(h => [h.id, h.name]));
  const repMap = Object.fromEntries(reports.map(r => [r.id, r.file_name]));

  const deptCache = new Map();
  depts.forEach(d => deptCache.set(`${d.hospital_id}:::${d.name.trim()}`, d.id));

  const genericNames = ['عام', 'عموم المستشفى', 'قسم عام'];
  const genericDepts = depts.filter(d => genericNames.includes(d.name.trim()));

  let totalReportFindingsUpdated = 0;
  let totalFindingsUpdated = 0;

  for (const gDept of genericDepts) {
    const hospName = hospMap[gDept.hospital_id] || 'Unknown';
    console.log(`\nProcessing Hospital: [${hospName}] | Current Dept: [${gDept.name}]`);

    // Ensure hospital has a standard 'عموم المستشفى' dept
    const oomoomDeptId = await getOrCreateDept(gDept.hospital_id, 'عموم المستشفى', deptCache);

    // Fetch report_findings
    const { data: rfList } = await supabase
      .from('report_findings')
      .select('id, report_id, original_text, hospital_resolution_note, status')
      .eq('department_id', gDept.id);

    // Fetch legacy findings
    const { data: fList } = await supabase
      .from('findings')
      .select('id, report_id, original_text, hospital_resolution_note, status')
      .eq('department_id', gDept.id);

    console.log(`Found ${rfList?.length || 0} in report_findings, ${fList?.length || 0} in findings`);

    // Process report_findings
    for (const rf of (rfList || [])) {
      const fn = repMap[rf.report_id] || '';
      const targetName = determineTargetDept(hospName, fn, rf.original_text);
      const targetDeptId = await getOrCreateDept(gDept.hospital_id, targetName, deptCache);

      if (targetDeptId !== rf.department_id) {
        const { error: updErr } = await supabase
          .from('report_findings')
          .update({ department_id: targetDeptId })
          .eq('id', rf.id);

        if (updErr) console.error(`Error updating report_finding ${rf.id}:`, updErr);
        else totalReportFindingsUpdated++;
      }
    }

    // Process legacy findings
    for (const f of (fList || [])) {
      const fn = repMap[f.report_id] || '';
      const targetName = determineTargetDept(hospName, fn, f.original_text);
      const targetDeptId = await getOrCreateDept(gDept.hospital_id, targetName, deptCache);

      if (targetDeptId !== f.department_id) {
        const { error: updErr } = await supabase
          .from('findings')
          .update({ department_id: targetDeptId })
          .eq('id', f.id);

        if (updErr) console.error(`Error updating finding ${f.id}:`, updErr);
        else totalFindingsUpdated++;
      }
    }

    // If the old dept was named 'عام' or 'قسم عام', and is now empty or has leftover items:
    if (gDept.name.trim() === 'عام' || gDept.name.trim() === 'قسم عام') {
      // Move any residual items to 'عموم المستشفى'
      await supabase.from('report_findings').update({ department_id: oomoomDeptId }).eq('department_id', gDept.id);
      await supabase.from('findings').update({ department_id: oomoomDeptId }).eq('department_id', gDept.id);

      // Delete the obsolete 'عام' department
      const { error: delErr } = await supabase.from('departments').delete().eq('id', gDept.id);
      if (!delErr) console.log(`[Removed obsolete dept] '${gDept.name}' (ID: ${gDept.id})`);
      else console.warn(`Could not remove dept '${gDept.name}':`, delErr.message);
    }
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Total report_findings updated: ${totalReportFindingsUpdated}`);
  console.log(`Total findings updated: ${totalFindingsUpdated}`);
}

run();
