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

let genAI = null
let newGenAI = null

function getGenAI() {
  if (!genAI) genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  return genAI
}

function getNewGenAI() {
  if (!newGenAI) newGenAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  return newGenAI
}

// Production-safe stable model (Availability, Low Latency, JSON support)
const MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-latest']

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
    const response = await getNewGenAI().models.embedContent({
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

const fastFailFetch = async (url, options) => {
  const res = await fetch(url, options)
  if (res.status === 429 || res.status === 503) {
    throw new Error(`FAST_FAIL_${res.status}`)
  }
  return res
}

// Circuit Breaker State
let consecutiveFailures = 0
const MAX_FAILURES = 5
let circuitBreakerOpenUntil = 0

async function generateWithFallback(prompt, generationConfig = null) {
  if (Date.now() < circuitBreakerOpenUntil) {
    throw new Error('CIRCUIT_BREAKER_OPEN')
  }

  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const modelName of MODELS) {
      try {
        const modelOptions = { model: modelName }
        if (generationConfig) modelOptions.generationConfig = generationConfig
        
        const model = getGenAI().getGenerativeModel(
          modelOptions,
          { customFetch: fastFailFetch }
        )
        const response = await model.generateContent(prompt)
        
        // Success -> Reset circuit breaker
        consecutiveFailures = 0
        return response
      } catch (e) {
        lastError = e
        if (e.message?.includes('429') || e.status === 429 || e.message?.includes('quota') || e.message?.includes('FAST_FAIL_429')) {
          consecutiveFailures++
          if (consecutiveFailures >= MAX_FAILURES) {
             circuitBreakerOpenUntil = Date.now() + 60000 // 1 minute penalty
             throw new Error('CIRCUIT_BREAKER_OPEN')
          }
          // Quota exceeded, retry with backoff
          await new Promise(r => setTimeout(r, 2000 * attempt + Math.random() * 1000))
          continue
        }
        if (e.message?.includes('503') || e.message?.includes('FAST_FAIL_503')) {
          consecutiveFailures++
          if (consecutiveFailures >= MAX_FAILURES) {
             circuitBreakerOpenUntil = Date.now() + 30000 // 30 sec penalty
             throw new Error('CIRCUIT_BREAKER_OPEN')
          }
          // Service Unavailable, retry with backoff
          await new Promise(r => setTimeout(r, 2000 * attempt + Math.random() * 1000))
          continue
        }
        continue
      }
    }
    // General failure wait before next attempt
    if (lastError && (lastError.message?.includes('503') || lastError.message?.includes('429'))) {
      await new Promise(r => setTimeout(r, 2000 * attempt + Math.random() * 1000))
    } else {
      break
    }
  }
  
  consecutiveFailures++
  if (consecutiveFailures >= MAX_FAILURES) {
     circuitBreakerOpenUntil = Date.now() + 60000
  }
  throw lastError
}

/**
 * Bulk extract semantic signatures for multiple findings in one request.
 * Takes an array of texts.
 * Returns an array of signatures in the same order.
 */
export async function extractSemanticSignaturesBulk(texts) {
  if (!texts || texts.length === 0) return []
  
  const prompt = `
أنت خبير في تقييم جودة الرعاية الصحية وإدارة المخاطر.
استخرج البصمة الدلالية (Semantic Signature) لكل سلبية من السلبيات التالية بشكل مستقل.

النصوص المرفقة مرقمة. قم بإرجاع JSON Array يحتوي على كائنات، كل كائن يجب أن يتضمن الحقول التالية:
- index: رقم النص الأصلي (من 0 إلى ${texts.length - 1})
- entity: الكيان أو القسم أو المادة المذكورة.
- defect: نوع الخلل أو المشكلة.
- requirement: المتطلب الأصلي الذي تم الإخلال به (إن وجد).
- polarity: قطبية المشكلة (missing, incomplete, incorrect, damaged, expired, unapproved, undocumented, unavailable, other).
- scope: نطاق المشكلة.
- context: السياق.
- important_qualifiers: أي صفات هامة (مثل: عالي الخطورة، طبي، etc).

النصوص:
${texts.map((t, i) => `[${i}] ${t}`).join('\n')}

أرجع النتيجة بصيغة JSON Array فقط، بدون أي نصوص أخرى.
`
  try {
    const response = await generateWithFallback(prompt, { responseMimeType: 'application/json' })
    const responseText = response.response.text()
    const parsedArray = JSON.parse(responseText)
    
    // Map back to original order and add versioning
    const results = texts.map((_, i) => {
      const match = parsedArray.find(item => item.index === i) || {}
      return {
        signature_version: "SEMANTIC_SIGNATURE_V1",
        model_version: "gemini-3.8-flash",
        prompt_version: "v2_bulk",
        entity: match.entity || "غير محدد",
        defect: match.defect || "غير محدد",
        requirement: match.requirement || "غير محدد",
        polarity: match.polarity || "other",
        scope: match.scope || "غير محدد",
        context: match.context || "غير محدد",
        important_qualifiers: match.important_qualifiers || []
      }
    })
    return results
  } catch (e) {
    console.error('AI Bulk Extraction failed:', e.message)
    return texts.map(() => null)
  }
}

export async function adjudicateFindingMatch(sigA, sigB) {
  if (!sigA || !sigB) {
    return { decision: 'UNCERTAIN', reason: 'Missing semantic signature for one or both findings. AI_UNAVAILABLE.' }
  }

  const prompt = `
أنت خبير في إدارة الجودة الطبية وتقييم المخاطر.
مهمتك هي مراجعة بصمتين دلاليتين (Semantic Signatures) لسلبيتين طبيتين/إداريتين وتقرير ما إذا كانتا تعبران عن **نفس المشكلة التشغيلية تماماً** حتى لو اختلفت الصياغة، أم أنهما مشكلتان مختلفتان.

القواعد الصارمة:
1. SAME_ISSUE: إذا كان الكيان (Entity) والخلل (Defect) متطابقين جوهرياً، والفرق فقط في الصياغة أو تفاصيل غير مؤثرة.
2. DIFFERENT_ISSUE: إذا اختلف الكيان، أو اختلف الخلل جوهرياً، أو كان هناك تناقض (Contradiction) مثل (غير موجود) ضد (غير مكتمل).
3. UNCERTAIN: إذا لم تكن متأكداً أو كانت المعلومات ناقصة.

البصمة A:
${JSON.stringify(sigA, null, 2)}

البصمة B:
${JSON.stringify(sigB, null, 2)}

قم بإرجاع JSON فقط يحتوي على:
{
  "decision": "SAME_ISSUE" | "DIFFERENT_ISSUE" | "UNCERTAIN",
  "reason": "شرح مفصل لسبب القرار بناءً على القواعد"
}
`

  try {
    const response = await generateWithFallback(prompt, { responseMimeType: 'application/json' })
    const responseText = response.response.text()
    const parsed = JSON.parse(responseText)
    return {
      decision: parsed.decision || 'UNCERTAIN',
      reason: parsed.reason || 'No reason provided'
    }
  } catch (e) {
    console.error('AI Adjudication failed:', e.message)
    // Never return DISTINCT on failure
    return { decision: 'UNCERTAIN', reason: 'AI_UNAVAILABLE: ' + e.message }
  }
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



export async function extractSemanticIssueSignature(text) {
  const prompt = `
أنت نظام ذكاء اصطناعي متخصص في سلامة المرضى والجودة الصحية.
مهمتك استخراج البصمة الدلالية (Semantic Signature) للمشكلة المذكورة في النص التالي.

النص: "${text}"

قم باستخراج العناصر التالية كـ JSON فقط بدون أي نص إضافي:
- entity: الكيان الأساسي الذي فيه المشكلة (مثل: جهاز الصدمات، كراش كار، سجل التسليم، أدوية عالية الخطورة).
- defect: المشكلة أو العيب الجوهري (مثل: معطل، غير موجود، غير معتمد، غير نظيف، غير مرقم).
- polarity: استقطاب المشكلة. اختر واحدًا فقط من:
  - "missing" (غير موجود / مفقود / عجز / غير متوفر)
  - "incomplete" (غير مكتمل / ناقص / غير مفعل بالكامل / يحتاج تحديث)
  - "damaged" (معطل / مكسور / لا يعمل / منتهي الصلاحية)
  - "unapproved" (غير معتمد / غير موثق / غير موقع)
  - "other" (شيء آخر)
- requirement: المعيار أو المتطلب الذي تم الإخلال به (مثل: توفر الأجهزة، اكتمال السجلات، سياسة الأدوية).
- scope: نطاق المشكلة. اختر واحدًا فقط من: "item" (شيء محدد)، "process" (عملية/سياسة)، "personnel" (طاقم/أفراد).
- context: أي سياق إضافي مهم (مثل: اسم قسم محدد إذا كان جوهرياً، أو اتركه فارغاً).

يجب أن يكون الناتج JSON فقط بهذا الهيكل:
{
  "entity": "...",
  "defect": "...",
  "polarity": "...",
  "requirement": "...",
  "scope": "...",
  "context": "..."
}
`

  try {
    const result = await generateWithFallback(prompt, {
      responseMimeType: "application/json"
    })
    const responseText = result.response.text()
    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned)
    // Add Signature Versioning details
    parsed.signature_version = 'SEMANTIC_SIGNATURE_V1'
    parsed.model_version = MODELS[0] // tracks which model produced it
    return parsed
  } catch (e) {
    console.error('Extraction failed:', e.message)
    return null
  }
}
