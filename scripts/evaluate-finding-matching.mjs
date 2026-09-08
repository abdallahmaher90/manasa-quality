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

// Smoke Evaluation Dataset
const evalDataset = [
  {
    findingText: "غياب توقيع الطبيب المقيم في تذكرة المريض",
    category: "القسم الداخلي",
    expectedMatch: true, // we expect this to match an existing canonical (e.g., "عدم استكمال التوقيعات الطبية")
  },
  {
    findingText: "جهاز الصدمات الكهربائية معطل بقسم الطوارئ",
    category: "الطوارئ",
    expectedMatch: false, // assuming this is completely new
  }
];

async function runEvaluation() {
  console.log('--- بدء تقييم الذكاء الاصطناعي (AI Smoke Evaluation Harness) ---\n');
  console.log('ملاحظة: المقاييس هنا أولية (Provisional) ويجب إعادة التقييم مستقبلاً بـ Dataset أكبر.\n');
  
  let truePositives = 0;
  let falsePositives = 0;
  let trueNegatives = 0;
  let falseNegatives = 0;

  for (let i = 0; i < evalDataset.length; i++) {
    const item = evalDataset[i];
    console.log(`[Pair ${i+1}]: "${item.findingText}" (Category: ${item.category})`);
    
    const matchResult = await matcherService.processFinding(item.findingText, item.category);
    
    const method = matchResult.matchLog.matching_method;
    const score = matchResult.matchLog.similarity_score;
    const isMatchedByAI = (method === 'vector_auto' || method === 'gemini_adjudicated_match' || method === 'vector_pending_match' || method === 'exact');
    const expected = item.expectedMatch;

    if (isMatchedByAI && expected) truePositives++;
    else if (isMatchedByAI && !expected) falsePositives++;
    else if (!isMatchedByAI && !expected) trueNegatives++;
    else if (!isMatchedByAI && expected) falseNegatives++;

    console.log(`- Expected Result: Match=${expected}`);
    console.log(`- Similarity Score: ${score || 'N/A'}`);
    console.log(`- Gemini Decision: ${method.includes('gemini') ? (method.includes('match') ? 'MATCH' : 'NO_MATCH') : 'N/A'}`);
    console.log(`- Final Result: ${method}`);
    console.log(`- Accurate AI Judgment: ${isMatchedByAI === expected ? '✅ نعم' : '❌ لا'}\n`);
  }

  const precision = truePositives / (truePositives + falsePositives || 1);
  const recall = truePositives / (truePositives + falseNegatives || 1);
  const fpr = falsePositives / (falsePositives + trueNegatives || 1);
  const fnr = falseNegatives / (falseNegatives + truePositives || 1);

  console.log('=== نتائج التقييم (Provisional Evaluation Metrics) ===');
  console.log(`Total Samples: ${evalDataset.length}`);
  console.log(`Precision: ${(precision * 100).toFixed(2)}%`);
  console.log(`Recall: ${(recall * 100).toFixed(2)}%`);
  console.log(`False Positive Rate (FPR): ${(fpr * 100).toFixed(2)}%`);
  console.log(`False Negative Rate (FNR): ${(fnr * 100).toFixed(2)}%`);

  if (precision >= 0.8 && recall >= 0.8) {
    console.log('\n✅ [PASS] اجتازت تجربة الـ Smoke Test المقاييس المبدئية بنجاح.');
  } else {
    console.log('\n❌ [FAIL] الأداء دون المستوى المتوقع في تجربة الـ Smoke Test.');
  }
}

runEvaluation().catch(console.error);
