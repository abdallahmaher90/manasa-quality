import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';

const envFile = fs.readFileSync('.env.local', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  const match = line.trim().match(/^([^=]+)=(.*)$/);
  if (match) env[match[1]] = match[2];
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

const getCategory = (name) => {
  if (!name) return 'عام وسلامة المرضى';
  const n = name.toLowerCase();
  if (n.includes('صيدل')) return 'الصيدلة';
  if (n.includes('كلى') || n.includes('كلي') || n.includes('كلو')) return 'الكلى';
  if (n.includes('عناي') || n.includes('رعاي')) return 'العناية المركزة';
  if (n.includes('معمل') || n.includes('معامل') || n.includes('دم')) return 'المعامل';
  if (n.includes('اشع') || n.includes('أشع') || n.includes('إشع')) return 'الأشعة';
  if (n.includes('استقبال') || n.includes('طوار')) return 'الاستقبال والطوارئ';
  if (n.includes('عمليات') || n.includes('افاق') || n.includes('إفاق')) return 'العمليات';
  if (n.includes('حضان') || n.includes('مبتسر')) return 'الحضانات';
  if (n.includes('سلامة') || n.includes('حريق') || n.includes('دفاع مدني') || n.includes('مهني')) return 'السلامة والصحة المهنية';
  if (n.includes('عدوى') || n.includes('عدوي')) return 'مكافحة العدوى';
  if (n.includes('أجهز') || n.includes('اجهز') || n.includes('صيان') || n.includes('مرافق') || n.includes('هندس') || n.includes('غاز') || n.includes('اكسجين') || n.includes('أكسجين') || n.includes('ديزل') || n.includes('طلمب')) return 'الإدارة الهندسية والصيانة';
  if (n.includes('ملف') || n.includes('ارشيف') || n.includes('أرشيف') || n.includes('توثيق')) return 'التوثيق الطبي والملفات';
  if (n.includes('موارد بشري') || n.includes('عاملين') || n.includes('إدار') || n.includes('ادار')) return 'الشؤون الإدارية والموارد البشرية';
  if (n.includes('داخلي') || n.includes('داخلى') || n.includes('اقام') || n.includes('إقام') || n.includes('باطن') || n.includes('جراح') || n.includes('اطفال') || n.includes('أطفال') || n.includes('عظام') || n.includes('حريم')) return 'القسم الداخلي';
  if (n.includes('عياد') || n.includes('خارجي')) return 'العيادات الخارجية';
  if (n.includes('اسنان') || n.includes('أسنان')) return 'الأسنان';
  if (n.includes('مخزن') || n.includes('مخازن') || n.includes('مستلزم')) return 'المخازن';
  if (n.includes('تذاكر') || n.includes('دخول') || n.includes('تسجيل')) return 'التذاكر والدخول';
  if (n.includes('مطبخ') || n.includes('تغذي')) return 'التغذية والمطبخ';
  if (n.includes('مغسل') || n.includes('مفروش')) return 'المغسلة';
  if (n.includes('نفاي') || n.includes('محرق')) return 'النفايات الطبية';
  if (n.includes('تعقيم')) return 'التعقيم';
  if (n.includes('طبيع')) return 'العلاج الطبيعي';
  return 'عام وسلامة المرضى';
};

const PROGRESS_FILE = 'scripts/normalization_progress.json';

function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    } catch (e) {
      return {};
    }
  }
  return {};
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf8');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log('--- بدء عملية توحيد وتطبيع السلبيات المعيارية عبر الذكاء الاصطناعي ---');

  // 1. Fetch all findings
  let allFindings = [];
  let page = 0;
  while (true) {
    const { data, error } = await supabase
      .from('findings')
      .select('id, original_text, canonical_text, departments(name)')
      .range(page * 1000, (page + 1) * 1000 - 1);

    if (error) {
      console.error('Error fetching findings:', error);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    allFindings = allFindings.concat(data);
    page++;
    if (data.length < 1000) break;
  }

  console.log(`إجمالي السلبيات في قاعدة البيانات: ${allFindings.length}`);

  const progress = loadProgress();
  const processedIds = new Set(Object.keys(progress));
  console.log(`سجلات معالجة مسبقاً: ${processedIds.size}`);

  // 2. Group findings by category
  const categories = {};
  allFindings.forEach((f) => {
    const cat = getCategory(f.departments?.name);
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(f);
  });

  const model = genAI.getGenerativeModel({ model: 'gemini-flash-lite-latest' });

  // Known canonical library per category to ensure consistency
  const canonicalLibrary = {};
  Object.values(progress).forEach((item) => {
    if (!canonicalLibrary[item.category]) canonicalLibrary[item.category] = new Set();
    if (item.canonical_text) canonicalLibrary[item.category].add(item.canonical_text);
  });

  let totalProcessed = processedIds.size;

  for (const [catName, findings] of Object.entries(categories)) {
    const pendingFindings = findings.filter((f) => !processedIds.has(f.id));
    if (pendingFindings.length === 0) {
      console.log(`القسم [${catName}] مكتمل بالكامل (${findings.length} سلبية).`);
      continue;
    }

    console.log(`\n=== معالجة قسم: [${catName}] (${pendingFindings.length} سلبية متبقية من أصل ${findings.length}) ===`);

    if (!canonicalLibrary[catName]) canonicalLibrary[catName] = new Set();

    const BATCH_SIZE = 35;
    for (let i = 0; i < pendingFindings.length; i += BATCH_SIZE) {
      const batch = pendingFindings.slice(i, i + BATCH_SIZE);
      const knownList = Array.from(canonicalLibrary[catName]).slice(0, 30);

      const prompt = `أنت خبير معتمد في جودة الرعاية الصحية وإدارة المخاطر وسلامة المرضى واعتماد المستشفيات (GAHAR).
أمامك قائمة بالسلبيات المرصودة في قسم/تصنيف: "${catName}".

المطلوب:
1. توحيد صياغة السلبيات تحت نصوص معيارية قياسية موحدة (canonical_text) واضحة واحترافية بدون حشو.
2. إذا كانت السلبية تتطابق أو تتشابه في الخلل الجذري مع إحدى الصياغات المعتمدة أدناه، استخدم نفس الصياغة المعتمدة حرفياً:
قائمة الصياغات المعتمدة مسبقاً لهذا القسم:
${knownList.length > 0 ? knownList.map((t) => `- "${t}"`).join('\n') : '(لا توجد صياغات مسبقة، قم بإنشاء صياغات معيارية موحدة)'}

3. السلبيات داخل هذه الدفعة التي تعبر عن نفس المشكلة (مثل عربة الطوارئ، التوقيعات، كروت التعريف ID، النتائج الحرجة، درجات الحرارة، أدوية الخطورة العالية LASA، إلخ) يجب أن تأخذ نفس النص المعياري تماماً.

السلبيات المطلوب تصنيفها وتوحيدها:
${batch.map((b) => `[ID_${b.id}]: ${b.original_text}`).join('\n')}

أجب بصيغة JSON Array فقط:
[
  { "id": "uuid بدون بادئة ID_", "canonical_text": "الصياغة المعيارية الموحدة" }
]
بدون أي markdown أو شرح إضافي.`;

      let success = false;
      let retries = 0;

      while (!success && retries < 4) {
        try {
          const res = await model.generateContent(prompt);
          const rawText = res.response.text();
          const cleanedJson = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          const items = JSON.parse(cleanedJson);

          // Update Supabase in parallel
          const updatePromises = items.map(async (item) => {
            const cleanId = item.id.replace('ID_', '').trim();
            const canon = item.canonical_text.trim();

            canonicalLibrary[catName].add(canon);
            progress[cleanId] = {
              canonical_text: canon,
              category: catName,
            };

            return supabase
              .from('findings')
              .update({ canonical_text: canon })
              .eq('id', cleanId);
          });

          await Promise.all(updatePromises);
          saveProgress(progress);
          totalProcessed += batch.length;
          console.log(`✓ [${catName}] تم تحديث ${batch.length} سلبية. الإجمالي: ${totalProcessed}/${allFindings.length}`);
          success = true;

          await sleep(600);
        } catch (err) {
          retries++;
          console.error(`خطأ في الدفعة (محاولة ${retries}/4):`, err.message);
          if (err.message.includes('429') || err.message.includes('quota') || err.message.includes('ResourceExhausted')) {
            console.log('انتظار 10 ثوانٍ بسبب الحصة...');
            await sleep(10000);
          } else {
            await sleep(2000);
          }
        }
      }

      if (!success) {
        console.error(`فشل معالجة دفعة في [${catName}] بعد عدة محاولات.`);
      }
    }
  }

  console.log('\n=========================================');
  console.log('🎉 اكتملت عملية توحيد السلبيات المعيارية بنجاح تام!');
  console.log(`إجمالي السلبيات المعالجة: ${Object.keys(progress).length}`);
  console.log('=========================================');
}

main().catch(console.error);
