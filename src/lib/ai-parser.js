import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { GoogleGenAI } from '@google/genai'
import { getCategory } from './utils.js'
import { z } from 'zod'
import { sanitizeInspectionDate } from './utils.js'

export { sanitizeInspectionDate }

const ReportZodSchema = z.object({
  hospital_name: z.string(),
  governorate: z.string().nullable().optional(),
  inspector_name: z.string().nullable().optional(),
  inspection_date: z.string().nullable().optional(),
  signatory_1_name: z.string().nullable().optional(),
  signatory_1_title: z.string().nullable().optional(),
  signatory_2_name: z.string().nullable().optional(),
  signatory_2_title: z.string().nullable().optional(),
  departments: z.array(z.object({
    name: z.string(),
    findings: z.array(z.object({
      original_text: z.string(),
      canonical_text: z.string(),
      corrective_action: z.string().nullable().optional(),
      responsible: z.string().nullable().optional(),
      deadline: z.string().nullable().optional(),
      priority: z.enum(['high', 'medium', 'low']).nullable().optional()
    }))
  }))
})

const reportGeminiSchema = {
  type: SchemaType.OBJECT,
  properties: {
    hospital_name: { type: SchemaType.STRING },
    governorate: { type: SchemaType.STRING },
    inspector_name: { type: SchemaType.STRING },
    inspection_date: { type: SchemaType.STRING },
    signatory_1_name: { type: SchemaType.STRING },
    signatory_1_title: { type: SchemaType.STRING },
    signatory_2_name: { type: SchemaType.STRING },
    signatory_2_title: { type: SchemaType.STRING },
    departments: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING },
          findings: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                original_text: { type: SchemaType.STRING },
                canonical_text: { type: SchemaType.STRING },
                corrective_action: { type: SchemaType.STRING },
                responsible: { type: SchemaType.STRING },
                deadline: { type: SchemaType.STRING },
                priority: { type: SchemaType.STRING }
              },
              required: ["original_text", "canonical_text"]
            }
          }
        },
        required: ["name", "findings"]
      }
    }
  },
  required: ["hospital_name", "departments"]
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const newGenAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

// Try models in order until one works
const MODELS = ['gemini-flash-lite-latest', 'gemini-3.6-flash', 'gemini-flash-latest']

// Text Normalization for AI matching
export function normalizeArabicText(text) {
  if (!text) return ''
  return text
    .replace(/[أإآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\w\s\u0600-\u06FF]/g, ' ') // Keep Arabic, Alphanumeric
    .replace(/\s+/g, ' ')
    .trim()
}

// Generate Embeddings using the new SDK
export async function getEmbedding(text) {
  if (!text) return null
  
  const modelName = process.env.EMBEDDING_MODEL || 'gemini-embedding-2'
  const dims = parseInt(process.env.EMBEDDING_DIMENSIONS || '768', 10)
  
  const normalized = normalizeArabicText(text)
  
  try {
    const response = await newGenAI.models.embedContent({
      model: modelName,
      contents: normalized,
      config: {
        outputDimensionality: dims
      }
    })
    
    return response.embeddings[0].values
  } catch (error) {
    console.error('Embedding generation failed:', error.message)
    return null
  }
}

// Custom fetch to instantly reject rate limits and server errors, bypassing the SDK's internal long retries
const fastFailFetch = async (url, options) => {
  const res = await fetch(url, options)
  if (res.status === 429 || res.status === 503) {
    throw new Error(`FAST_FAIL_${res.status}`)
  }
  return res
}

async function generateWithFallback(prompt, generationConfig = null) {
  let lastError = null
  for (const modelName of MODELS) {
    try {
      const modelOptions = { model: modelName }
      if (generationConfig) modelOptions.generationConfig = generationConfig
      
      const model = genAI.getGenerativeModel(
        modelOptions,
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

قم بتحليل التقرير التالي واستخرج منه البيانات المطلوبة بدقة عالية.

**التقرير:**
${text}

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
6. إذا لم تتوفر معلومة معينة في التقرير، اتركها فارغة (null).
7. التاريخ (inspection_date): حوّله لصيغة YYYY-MM-DD دائماً.
   - إذا كان المرور تم على مدار يومين أو أكثر، يجب اعتباره تقريراً واحداً في يوم عادي، واستخراج تاريخ اليوم الأخير من المرور.
`

  const generationConfig = {
    responseMimeType: "application/json",
    responseSchema: reportGeminiSchema,
  }

  const result = await generateWithFallback(prompt, generationConfig)
  const responseText = result.response.text()

  try {
    const rawParsed = JSON.parse(responseText)
    
    // Validate with Zod
    const validated = ReportZodSchema.parse(rawParsed)

    if (validated) {
      validated.inspection_date = sanitizeInspectionDate(validated.inspection_date || text)
    }
    
    return validated
  } catch (e) {
    console.error("Zod Validation or Parse Error:", e)
    throw new Error(`فشل في تحليل التقرير (خطأ في هيكل البيانات): ${e.message}`)
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

/**
 * Matches new findings against platform-wide canonical texts for a department category.
 * If a finding matches an existing canonical issue, it returns that canonical_text.
 * If brand new, it generates a clean, standardized canonical_text.
 */
export async function matchAndCanonicalizeFindingsBulk(newFindings, existingPlatformCanonicals = [], categoryName = '') {
  if (!newFindings || newFindings.length === 0) return []

  // If no existing canonicals, return clean canonical_text or original_text
  const validCanonicals = (existingPlatformCanonicals || []).filter(Boolean).slice(0, 40)

  const prompt = `أنت خبير معتمد في جودة الرعاية الصحية وإدارة المخاطر وسلامة المرضى واعتماد المستشفيات (GAHAR).
أمامك قائمة بسلبيات جديدة مستخرجة من تقرير مرور مستشفى لقسم "${categoryName || 'القسم'}"، وقائمة بالسلبيات المعيارية المعتمدة مسبقاً على المنصة.

المطلوب:
لكل سلبية جديدة:
1. تحقق ما إذا كانت تعبر عن نفس الخلل الجذري لإحدى "السلبيات المعيارية المعتمدة مسبقاً" (حتى لو اختلفت طريقة صياغة القائم بالمرور أو التفاصيل البسيطة، مثل عربة الطوارئ Crash Cart، التوقيعات، كروت التعريف ID، أدوية الخطورة العالية LASA، سجل النتائج الحرجة، توثيق نماذج الملف الطبي، إلخ).
2. إذا تطابقت مع سلبية معتمدة مسبقاً: استخدم نفس النص المعياري المعتمد حرفياً.
3. إذا كانت سلبية جديدة تماماً: صغ نصاً معيارياً موحداً (canonical_text) واضحاً ورصيناً يعبر عن السلبية بدون حشو.

السلبيات الجديدة:
${newFindings.map((f, i) => `[New_${i}]: "${f.canonical_text || f.original_text}"`).join('\n')}

السلبيات المعيارية المعتمدة مسبقاً على المنصة لهذا القسم:
${validCanonicals.length > 0 ? validCanonicals.map(t => `- "${t}"`).join('\n') : '(لا توجد صياغات مسبقة، قم بإنشاء صياغات معيارية موحدة)'}

أجب بصيغة JSON Array فقط:
[
  { "index": 0, "canonical_text": "الصياغة المعيارية الموحدة" }
]
بدون أي markdown أو شرح إضافي.`

  try {
    const result = await generateWithFallback(prompt)
    const responseText = result.response.text()
    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned)

    return newFindings.map((f, index) => {
      const match = parsed.find(p => p.index === index)
      const canon = match?.canonical_text?.trim()
      return {
        ...f,
        canonical_text: canon || f.canonical_text || f.original_text
      }
    })
  } catch (e) {
    console.error('matchAndCanonicalizeFindingsBulk error:', e)
    // Fallback: Use original text as canonical text if everything fails
    return newFindings.map(f => ({
      ...f,
      canonical_text: f.canonical_text || f.original_text
    }))
  }
}

/**
 * Adjudicates if a new finding matches one of the top candidate canonical findings.
 */
export async function adjudicateFindingMatch(newFindingText, candidates) {
  if (!candidates || candidates.length === 0) return { isMatch: false, matchedId: null, reasoning: 'No candidates provided' }
  
  const prompt = `
أنت نظام خبير في مراجعة الجودة ومطابقة السلبيات الطبية.
مهمتك هي تحديد ما إذا كانت "السلبية الجديدة" تعبر عن نفس المشكلة الجذرية لإحدى "السلبيات المعيارية المرشحة".

السلبية الجديدة: "${newFindingText}"

السلبيات المرشحة:
${candidates.map((c, i) => `[ID: ${c.id}] النص: "${c.canonical_text}" (نسبة التشابه: ${c.similarity})`).join('\n')}

أجب بـ JSON فقط:
- إذا كانت نفس المشكلة بالضبط (حتى باختلاف صياغة بسيط): 
  {"isMatch": true, "matchedId": "ID_HERE", "reasoning": "سبب المطابقة"}
- إذا كانت مشكلة مختلفة أو تفاصيلها مختلفة جوهرياً: 
  {"isMatch": false, "matchedId": null, "reasoning": "سبب الاختلاف"}
`

  try {
    const result = await generateWithFallback(prompt)
    const responseText = result.response.text()
    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned)
    return {
      isMatch: parsed.isMatch === true,
      matchedId: parsed.matchedId,
      reasoning: parsed.reasoning || ''
    }
  } catch (e) {
    console.error('Adjudication failed:', e)
    return { isMatch: false, matchedId: null, reasoning: 'Adjudication API failed' }
  }
}
