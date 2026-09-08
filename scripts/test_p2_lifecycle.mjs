import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const { createClient } = await import('@supabase/supabase-js');
const { VectorMatchingService } = await import('../src/services/vector-matching.service.js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const matcherService = new VectorMatchingService(supabase);

async function runLifecycleTest() {
  console.log('--- بدء اختبار دورة الحياة (E2E Lifecycle Test) ---\n');
  
  const uniqueId = Date.now();
  const originalFindingText = `وجود أدوية منتهية الصلاحية في الكراش كار رقم ${uniqueId}`;
  const category = 'العناية المركزة';

  // 1. Report A creates the finding for the first time
  console.log(`[الخطوة 1]: معالجة السلبية لأول مرة (Report A)...`);
  const resultA = await matcherService.processFinding(originalFindingText, category);
  
  const pendingCanonicalId = resultA.canonicalId;
  console.log(`- القرار: ${resultA.matchLog.matching_method}`);
  console.log(`- تم إنشاء Pending Canonical ID: ${pendingCanonicalId}`);

  if (resultA.matchLog.matching_method !== 'new') {
    console.error('❌ FAIL: كان يجب أن تُعتبر السلبية جديدة تماماً.');
    return;
  }

  // 2. Report B uses almost the exact same wording, should match the Pending
  console.log(`\n[الخطوة 2]: معالجة سلبية مشابهة جداً في تقرير آخر (Report B)...`);
  const similarText = `وجود علاج منتهي الصلاحية في الكراش كار رقم ${uniqueId}`;
  const resultB = await matcherService.processFinding(similarText, category);
  
  console.log(`- القرار: ${resultB.matchLog.matching_method}`);
  console.log(`- الـ ID المرتبط: ${resultB.canonicalId}`);

  if (resultB.canonicalId !== pendingCanonicalId || resultB.matchLog.matching_method !== 'vector_pending_match') {
    console.error('❌ FAIL: كان يجب أن يرتبط بالسلبية الـ Pending الموجودة سلفاً.');
    return;
  }
  console.log(`✅ [نجاح]: تم منع التكرار بنجاح (Pending Deduplication)`);

  // 3. Human Approval (Admin marks as Active)
  console.log(`\n[الخطوة 3]: محاكاة اعتماد الإدارة للسلبية (Human Approval)...`);
  const { error: updateErr } = await supabase
    .from('canonical_findings')
    .update({ 
      status: 'active',
      reviewed_at: new Date().toISOString(),
      review_note: 'Approved by E2E test'
    })
    .eq('id', pendingCanonicalId);

  if (updateErr) {
    console.error('❌ FAIL: فشل تحديث حالة السلبية.', updateErr);
    return;
  }
  console.log(`- تم تغيير الحالة إلى Active بنجاح.`);

  // 4. Report C uses it again, should now match ACTIVE
  console.log(`\n[الخطوة 4]: معالجة السلبية في تقرير ثالث (Report C) بعد الاعتماد...`);
  const resultC = await matcherService.processFinding(originalFindingText, category);
  
  console.log(`- القرار: ${resultC.matchLog.matching_method}`);
  console.log(`- الـ ID المرتبط: ${resultC.canonicalId}`);

  if (resultC.canonicalId !== pendingCanonicalId || resultC.matchLog.matching_method !== 'exact') {
    // Note: It might be 'exact' if identical string, or 'vector_auto' if similar
    console.error('❌ FAIL: كان يجب أن يرتبط بالسلبية الأكتيف.');
    return;
  }

  console.log(`\n🎉 ✅ [PASS] تم اجتياز الاختبار الكامل بنجاح! المسار يعمل بامتياز من Pending إلى Active دون تكرار.`);
}

runLifecycleTest().catch(console.error);
