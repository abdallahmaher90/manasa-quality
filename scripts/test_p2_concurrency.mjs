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

async function runConcurrencyTest() {
  console.log('--- بدء اختبار التزامن (Concurrency Test) ---\n');
  
  const uniqueId = Date.now();
  const findingText = `عطل مفاجئ في جهاز التعقيم المركزي رقم ${uniqueId}`;
  const category = 'التعقيم المركزي';

  // We need a dummy hospital and report to attach findings
  const { data: hospital } = await supabase.from('hospitals').select('id').limit(1).single();
  const { data: dept } = await supabase.from('departments').select('id').limit(1).single();
  
  let reportId = null;
  if (hospital) {
    const { data: rep } = await supabase.from('reports').insert({ hospital_id: hospital.id }).select('id').single();
    reportId = rep?.id;
  }

  console.log(`إرسال 5 طلبات متزامنة تحاكي إنشاء نفس السلبية...\n`);
  
  // Create 5 concurrent workers
  const promises = Array.from({ length: 5 }).map(async (_, i) => {
    try {
      const matchResult = await matcherService.processFinding(findingText, category);
      const canonicalId = matchResult.canonicalId;
      
      // Log the match
      await matcherService.logMatch(matchResult.matchLog, findingText);
      
      // Create report finding
      if (reportId && dept && canonicalId) {
        await supabase.from('report_findings').insert({
          report_id: reportId,
          hospital_id: hospital.id,
          department_id: dept.id,
          canonical_finding_id: canonicalId,
          original_text: findingText,
          status: 'open'
        });
      }
      
      return { success: true, workerId: i, canonicalId, method: matchResult.matchLog.matching_method };
    } catch (err) {
      return { success: false, workerId: i, error: err.message, code: err.code };
    }
  });

  const results = await Promise.all(promises);
  
  console.log('=== نتائج الطلبات (Request Results) ===');
  results.forEach(r => {
    if (r.success) {
      console.log(`[Worker ${r.workerId}] نجاح. Canonical ID: ${r.canonicalId} (${r.method})`);
    } else {
      console.log(`[Worker ${r.workerId}] فشل. Error: ${r.error} (Code: ${r.code})`);
    }
  });

  const canonicalIds = results.filter(r => r.success).map(r => r.canonicalId);
  const uniqueCanonicals = [...new Set(canonicalIds)];

  console.log('\n=== التأكد من قاعدة البيانات (Database Verification) ===');
  // 1. Check Canonical Rows created
  const { data: createdCanonicals } = await supabase
    .from('canonical_findings')
    .select('*')
    .eq('canonical_text', findingText);
    
  console.log(`عدد سجلات Canonical التي تم إنشاؤها فعلياً: ${createdCanonicals?.length || 0}`);
  
  // 2. Check Report Findings created
  let createdReportFindings = [];
  if (reportId) {
    const { data: rfs } = await supabase
      .from('report_findings')
      .select('*')
      .eq('original_text', findingText)
      .eq('report_id', reportId);
    createdReportFindings = rfs || [];
  }
  console.log(`عدد سجلات report_findings الناتجة: ${createdReportFindings.length}`);

  // 3. Unique Violations or orphans
  const violations = results.filter(r => !r.success && (r.error.includes('duplicate key') || r.code === '23505'));
  console.log(`عدد أخطاء Unique Violations التي صدتها القاعدة: ${violations.length}`);

  if (createdCanonicals?.length === 1 && createdReportFindings.length === 5) {
    console.log('\n✅ [PASS] اجتياز الاختبار: تم إنشاء Canonical واحدة فقط وارتبطت بها جميع التقارير الـ 5 بنجاح دون أي تكرار!');
  } else {
    console.log('\n❌ [FAIL] فشل الاختبار: تم إنشاء أكثر من سلبية أو لم يتم ربط التقارير بشكل صحيح.');
  }
}

runConcurrencyTest().catch(console.error);
