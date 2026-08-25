import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

// Try models in order until one works
const MODELS = ['gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemma-4-31b-it', 'gemini-flash-latest']

// Custom fetch to instantly reject rate limits and server errors, bypassing the SDK's internal long retries
const fastFailFetch = async (url, options) => {
  const res = await fetch(url, options)
  if (res.status === 429 || res.status === 503) {
    throw new Error(`FAST_FAIL_${res.status}`)
  }
  return res
}

async function generateWithFallback(prompt) {
  let lastError = null
  for (const modelName of MODELS) {
    try {
      const model = genAI.getGenerativeModel(
        { model: modelName },
        { customFetch: fastFailFetch }
      )
      return await model.generateContent(prompt)
    } catch (e) {
      console.warn(`Model ${modelName} failed:`, e.message)
      lastError = e
      
      // Fail fast on quota errors to prevent massive hanging delays
      if (e.message?.includes('429') || e.status === 429 || e.message?.includes('quota') || e.message?.includes('FAST_FAIL_429')) {
        throw new Error('تم استنفاد حصة الاستخدام المجانية (Quota Exceeded). يرجى الانتظار دقيقة أو الترقية.')
      }
      
      continue
    }
  }
  throw lastError
}

/**
 * Extracts structured data from a patient safety inspection report
 * using Gemini AI. Handles Arabic text and various report formats.
 */
export async function parseReport(text) {

  const prompt = `
أنت نظام ذكاء اصطناعي متخصص في تحليل تقارير مرور سلامة المرضى في المستشفيات المصرية.

قم بتحليل التقرير التالي واستخرج منه البيانات بتنسيق JSON بالضبط.

**التقرير:**
${text}

**المطلوب:**
استخرج البيانات بهذا الشكل بالضبط (JSON فقط بدون أي نص إضافي):

{
  "hospital_name": "اسم المستشفى أو المنشأة",
  "governorate": "المحافظة",
  "inspector_name": "اسم القائم بالمرور",
  "inspection_date": "التاريخ بصيغة YYYY-MM-DD",
  "signatory_1_name": "اسم أول موقع (مدير سلامة المرضى أو ما شابه)",
  "signatory_1_title": "لقب أول موقع",
  "signatory_2_name": "اسم ثاني موقع (وكيل الوزارة أو ما شابه)",
  "signatory_2_title": "لقب ثاني موقع",
  "departments": [
    {
      "name": "اسم القسم",
      "findings": [
        {
          "original_text": "نص السلبية كما وردت في التقرير",
          "canonical_text": "صياغة موحدة ومعيارية واضحة للسلبية بأسلوب احترافي",
          "corrective_action": "الإجراء التصحيحي المطلوب",
          "responsible": "الجهة أو الشخص المسؤول عن التنفيذ",
          "deadline": "مدة التنفيذ المحددة (مثل: يوم، أسبوع، شهر)",
          "priority": "high أو medium أو low بناءً على خطورة السلبية على سلامة المريض"
        }
      ]
    }
  ]
}

**قواعد مهمة:**
1. اسم المستشفى (hospital_name) يجب أن يكون مطابقاً حرفياً لواحد من هذه القائمة فقط (لا تخترع اسماً ولا تستخدم اسماً غير موجود في القائمة، اقرأ التقرير واختر الأقرب من هذه القائمة):
- مستشفى حميات مطوبس
- مستشفى حميات بيلا
- مستشفى الرمد الرئيسي
- مستشفى فوه المركزي
- مستشفى الرياض المركزي
- مستشفى جلدية وجذام كفرالشيخ
- مستشفي فيصل سعود الفليج
- مستشفى مطوبس المركزى
- مستشفي الحامول المركزي
- مستشفى برج البرلس المركزى
- مستشفى كفر الشيخ العام
- مستشفى سيدى غازى
- مستشفى حميات كفر الشيخ
- مستشفى سيدي سالم المركزي
- مستشفى دسوق العام
- مستشفى صدر كفرالشيخ
- مستشفي بيلا المركزي
- مستشفى حميات دسوق

2. اسم القسم (name) يجب أن يكون القسم الرئيسي فقط (مثل: "عناية القلب"، "القسم الداخلي"، "عام").
   - **هام جداً:** إذا كان التقرير يحتوي على أقسام فرعية أو غرف داخل قسم رئيسي (مثل: "عناية القلب - الكراش كار" أو "الداخلي / الملفات")، **لا تقم بإنشائها كأقسام منفصلة أبدًا**.
   - بدلاً من ذلك، اجعل اسم القسم هو القسم الرئيسي فقط، وقم بكتابة اسم الغرفة أو الجزء الفرعي بين قوسين في بداية نص السلبية.
   - مثال: القسم "عناية القلب"، ونص السلبية: "[الكراش كار] جهاز الصدمات لا يعمل".

3. نص السلبية المعياري (canonical_text) يجب أن يكون واضحاً ومباشراً بدون حشو.
4. الإجراء التصحيحي (corrective_action) يجب أن يكون خطوة عملية يمكن تنفيذها.
5. الأولوية (priority) يجب أن تكون "high" أو "medium" أو "low" فقط.
6. إذا لم تتوفر معلومة معينة في التقرير، اتركها فارغة (null) أو ضعها كقيمة افتراضية منطقية.
7. التاريخ: حوّله لصيغة YYYY-MM-DD. مثال: 23-8-2026 يصبح 2026-08-23.

أعطني JSON فقط بدون أي نص آخر أو markdown.
`

  const result = await generateWithFallback(prompt)
  const responseText = result.response.text()

  // Clean up response - remove markdown code blocks if present
  const cleaned = responseText
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim()

  try {
    return JSON.parse(cleaned)
  } catch (e) {
    throw new Error(`فشل في تحليل التقرير: ${e.message}\nالرد: ${cleaned}`)
  }
}

/**
 * Determines if two finding texts refer to the same issue using AI.
 * Returns the canonical (standardized) text to use.
 */
export async function normalizeFinding(newText, existingCanonicals) {
  if (!existingCanonicals || existingCanonicals.length === 0) {
    return { isNew: true, matchedCanonical: null }
  }

  const prompt = `
أنت نظام مقارنة سلبيات طبية. مهمتك تحديد إذا كانت سلبية جديدة هي نفس سلبية موجودة مسبقاً حتى لو الصياغة مختلفة.

**السلبية الجديدة:**
"${newText}"

**السلبيات الموجودة مسبقاً:**
${existingCanonicals.map((c, i) => `${i + 1}. "${c.text}" (id: ${c.id})`).join('\n')}

أجب بـ JSON فقط:
- إذا كانت نفس سلبية موجودة: {"isNew": false, "matchedId": "id_هنا"}
- إذا كانت سلبية جديدة تماماً: {"isNew": true, "matchedId": null}
`

  const result = await generateWithFallback(prompt)
  const responseText = result.response.text()
  const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

  try {
    return JSON.parse(cleaned)
  } catch (e) {
    return { isNew: true, matchedId: null }
  }
}

/**
 * Bulk normalization to avoid Gemini API Rate Limits (429).
 * Compares multiple new findings against existing ones in a single request.
 */
export async function normalizeFindingsBulk(newFindingsTextArray, existingCanonicals) {
  if (!existingCanonicals || existingCanonicals.length === 0 || !newFindingsTextArray || newFindingsTextArray.length === 0) {
    return newFindingsTextArray.map(f => ({ isNew: true, matchedId: null, originalText: f }))
  }

  const prompt = `
أنت نظام مقارنة سلبيات طبية.
مهمتك تحديد أي من "السلبيات الجديدة" تتطابق مع أي من "السلبيات الموجودة مسبقاً" حتى لو اختلفت الصياغة.

**السلبيات الجديدة:**
${newFindingsTextArray.map((text, i) => `[NewID_${i}]: "${text}"`).join('\n')}

**السلبيات الموجودة مسبقاً:**
${existingCanonicals.map((c, i) => `[ExistingID_${c.id}]: "${c.text}"`).join('\n')}

أجب بصيغة JSON Array فقط، كل عنصر يمثل نتيجة لسلبية جديدة، كالتالي:
[
  {"new_id": "NewID_0", "isNew": false, "matched_existing_id": "هنا تضع الـ id الرقمي فقط بدون كلمة ExistingID_"},
  {"new_id": "NewID_1", "isNew": true, "matched_existing_id": null}
]
بدون أي نص آخر أو markdown.
`

  try {
    const result = await generateWithFallback(prompt)
    const responseText = result.response.text()
    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned)
    
    // Map back to the expected array
    return newFindingsTextArray.map((text, index) => {
      const match = parsed.find(p => p.new_id === `NewID_${index}`)
      if (match && !match.isNew && match.matched_existing_id) {
        return { isNew: false, matchedId: match.matched_existing_id, originalText: text }
      }
      return { isNew: true, matchedId: null, originalText: text }
    })
  } catch (e) {
    console.error('Bulk normalize error:', e)
    // Fallback: assume all are new if API fails
    return newFindingsTextArray.map(f => ({ isNew: true, matchedId: null, originalText: f }))
  }
}
