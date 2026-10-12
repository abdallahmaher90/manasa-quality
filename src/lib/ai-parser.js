import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { GoogleGenAI } from '@google/genai'
import { getCategory } from './utils.js'
import { z } from 'zod'
import { sanitizeInspectionDate } from './utils.js'
import { createServiceClient } from './supabase.js'

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
const MODELS = ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-flash-latest']

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

let embeddingDisabledUntil = 0

// Generate Embeddings using the new SDK
export async function getEmbedding(text) {
  if (!text) return null
  if (Date.now() < embeddingDisabledUntil) return null
  
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
    if (error.message?.includes('429') || error.message?.includes('quota') || error.message?.includes('API_KEY')) {
      embeddingDisabledUntil = Date.now() + 300000 // 5 minutes penalty
    }
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

let cachedGroqApiKey = null
let cachedGroqModel = null

async function getGroqCredentials() {
  if (process.env.GROQ_API_KEY) {
    return {
      apiKey: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b'
    }
  }

  if (cachedGroqApiKey) {
    return {
      apiKey: cachedGroqApiKey,
      model: cachedGroqModel || 'openai/gpt-oss-120b'
    }
  }

  try {
    const supabase = createServiceClient()
    const { data } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', ['GROQ_API_KEY', 'GROQ_MODEL'])

    if (data && data.length > 0) {
      const keyRow = data.find(r => r.key === 'GROQ_API_KEY')
      const modelRow = data.find(r => r.key === 'GROQ_MODEL')
      if (keyRow?.value) {
        cachedGroqApiKey = keyRow.value
        cachedGroqModel = modelRow?.value || 'openai/gpt-oss-120b'
        return { apiKey: cachedGroqApiKey, model: cachedGroqModel }
      }
    }
  } catch (e) {
    console.warn('Failed to load Groq credentials from Supabase:', e.message)
  }

  return { apiKey: null, model: null }
}

async function callGroq(prompt, generationConfig = null) {
  const { apiKey, model: configuredModel } = await getGroqCredentials()
  if (!apiKey) return null

  const candidateModels = [
    configuredModel || 'openai/gpt-oss-120b',
    'openai/gpt-oss-20b'
  ]

  const isJson = generationConfig?.responseMimeType === 'application/json' || Boolean(generationConfig?.responseSchema)

  let lastError = null
  for (const model of candidateModels) {
    try {
      const body = {
        model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert in Egyptian healthcare quality inspection. Strictly adhere to the exact department names as written in the report. Never invent, split, or categorize findings into conceptual quality standards. Output the complete, full JSON directly and immediately.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 4500
      }

      if (isJson) {
        body.response_format = { type: 'json_object' }
        body.reasoning_format = 'hidden'
        body.reasoning_effort = 'low'
      }

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      })

      if (!res.ok) {
        const errText = await res.text()
        console.warn(`Groq model ${model} returned HTTP ${res.status}:`, errText)
        lastError = new Error(`GROQ_ERROR_${res.status}: ${errText}`)
        continue
      }

      const data = await res.json()
      const choice = data.choices?.[0]
      if (choice) {
        console.log(`[Groq Info]: model=${model}, finish_reason=${choice.finish_reason}, prompt_tokens=${data.usage?.prompt_tokens}, completion_tokens=${data.usage?.completion_tokens}, reasoning_tokens=${data.usage?.completion_tokens_details?.reasoning_tokens}`)
      }
      const content = choice?.message?.content || ''
      if (content) {
        return {
          response: {
            text: () => content
          }
        }
      }
    } catch (err) {
      lastError = err
      console.warn(`Groq attempt with model ${model} failed:`, err.message)
    }
  }

  if (lastError) throw lastError
  return null
}

async function generateWithFallback(prompt, generationConfig = null) {
  // 1. Primary engine: Groq (Ultra-fast, high rate limits, env or Supabase settings)
  const groqCreds = await getGroqCredentials()
  if (groqCreds.apiKey) {
    try {
      const groqResult = await callGroq(prompt, generationConfig)
      if (groqResult) return groqResult
    } catch (groqErr) {
      console.error('Groq call failed:', groqErr.message)
      throw new Error(`خطأ في خدمة Groq AI: ${groqErr.message}`)
    }
  }

  // 2. Secondary engine: Gemini
  if (Date.now() < circuitBreakerOpenUntil) {
    throw new Error('انتهت الكوتا اليومية للذكاء الاصطناعي (Gemini Quota 429). يرجى التأكد من تفعيل Groq.')
  } else if (circuitBreakerOpenUntil > 0) {
    circuitBreakerOpenUntil = 0
    consecutiveFailures = 0
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
          circuitBreakerOpenUntil = Date.now() + 300000 // 5 minute penalty immediately
          throw new Error('QUOTA_EXHAUSTED_429')
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
  let cleanText = text || ''

  // 1. استبعاد قسم الإيجابيات والتلافيات السابقة إذا كان موجوداً لحماية التحليل من اعتبارها سلبيات
  const positivesMatch = cleanText.match(/(?:الإيجابيات|الايجابيات|ما\s*تم\s*تلافيه|ماتم\s*تلافيه|النقاط\s*الإيجابية|النقاط\s*الايجابية)[\s\S]*?(?=(?:مدة\s*التنفيذ|بيان\s*عدم\s*التطابق|أوجه\s*القصور|اوجه\s*القصور|جدول\s*السلبيات|جدول\s*عدم\s*التطابق|السلبيات\s*:))/i)
  if (positivesMatch) {
    cleanText = cleanText.replace(positivesMatch[0], '\n\n[ملاحظة: تم استبعاد قسم الإيجابيات والتلافيات السابقة]\n\n')
  }

  const prompt = `
أنت نظام ذكاء اصطناعي متخصص في تحليل تقارير مرور سلامة المرضى في المستشفيات المصرية.

قم بتحليل التقرير التالي واستخرج منه البيانات المطلوبة بدقة عالية.

**التقرير:**
${cleanText}

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

2. **الالتزام الحرفي التام بأقسام التقرير فقط (ممنوع منعاً باتاً اختراع أو تصنيف أقسام من عندك):**
   - اسم القسم (name) يجب أن يُؤخذ نصاً وحرفياً كما هو مكتوب كعنوان قسم في التقرير فقط (مثل: "قسم الداخلي"، "قسم المعمل"، "قسم العناية المركزة"، "قسم الاستقبال"، "قسم العناية المتوسطة"، إلخ).
   - **تحذير حاسم وصارم:** إياك أن تصنّف السلبيات أو تقسمها حسب موضوع المخالفة أو معايير الجودة (ممنوع قطعي أن تخترع أقساماً من رأسك مثل: "تعريف هوية المرضى"، "مكافحة العدوى"، "إدارة المواد الكيميائية والخطرة"، "السلامة والصحة المهنية"، "الملفات الطبية"، "عام").
   - كل سلبية تتبع حصراً القسم الذي كُتبت تحته في التقرير نصاً؛ فإذا كُتبت سلبية تخص الأدوية أو النفايات أو السلامة تحت عنوان "قسم الداخلي"، فإن قسمها يبقى "قسم الداخلي" دون أي تغيير أو نقل.
   - لا تدمج أقساماً مستقلة وردت في التقرير، ولا تخترع أي قسم غير موجود حرفياً في التقرير. التزم تماماً بهيكل التقرير الأصلي.

3. **تجاهل الإيجابيات واستخراج السلبيات الحقيقية فقط (قاعدة جوهرية حاسمة):**
   - إذا احتوى التقرير على قسم للإيجابيات أو ما تم تلافيه من المرورات السابقة (مثل: "تم عمل...", "معتمد", "يعمل", "مطابق"):
     **ممنوع منعاً باتاً استخراج أي بند من الإيجابيات كـ finding!** لا تعتبر هذه النقاط سلبيات أبداً.
   - السلبيات (findings) تُستخرج حصراً من جدول "بيان عدم التطابق" أو "أوجه القصور".
   - السلبية دائماً تعبر عن عيب، نقص، تقصير، أو مخالفة (مثل: "لا يوجد...", "غير معتمد", "شطب بالملف", "غير مدرب", "بدون تاريخ إصدار", "غير مؤمنة").
   - **استخراج كافة الأقسام والسلبيات بدون استثناء:** يجب تضمين كل قسم وارد في جدول السلبيات بالتقرير (مثل: العناية المركزة، العناية المتوسطة، الداخلي، المعمل، العمليات، الاستقبال، الطوارئ، الحضانات، الصيدلية... وكافة الأقسام المذكورة). ممنوع الاكتفاء بقسم أو قسمين، بل يجب مسح كافة الجداول واستخراج كل السلبيات حتى الوصول لأسفل التقرير والتوقيعات.

4. نص السلبية المعياري (canonical_text) يجب أن يكون واضحاً ومباشراً بدون حشو.
5. الإجراء التصحيحي (corrective_action) يجب أن يكون خطوة عملية يمكن تنفيذها من واقع التقرير.
6. الأولوية (priority) يجب أن تكون "high" أو "medium" أو "low" فقط.
7. إذا لم تتوفر معلومة معينة في التقرير، اتركها فارغة (null).
8. التاريخ (inspection_date): حوّله لصيغة YYYY-MM-DD دائماً.
   - إذا كان المرور تم على مدار يومين أو أكثر، يجب اعتباره تقريراً واحداً في يوم عادي، واستخراج تاريخ اليوم الأخير من المرور.

9. يجب أن يكون الرد JSON فقط مطابقاً تماماً لهذا الهيكل وبدون أي نص خارجي:
{
  "hospital_name": "اسم المستشفى من القائمة",
  "governorate": "المحافظة",
  "inspector_name": "اسم المفتش أو null",
  "inspection_date": "YYYY-MM-DD",
  "signatory_1_name": "اسم الموقع 1 أو null",
  "signatory_1_title": "صفة الموقع 1 أو null",
  "signatory_2_name": "اسم الموقع 2 أو null",
  "signatory_2_title": "صفة الموقع 2 أو null",
  "departments": [
    {
      "name": "اسم القسم الرئيسي",
      "findings": [
        {
          "original_text": "نص السلبية الأصلي",
          "canonical_text": "نص السلبية المعياري",
          "corrective_action": "الإجراء التصحيحي أو null",
          "responsible": "المسؤول أو null",
          "deadline": "المهلة أو null",
          "priority": "high أو medium أو low"
        }
      ]
    }
  ]
}
`

  const generationConfig = {
    responseMimeType: "application/json",
    responseSchema: reportGeminiSchema,
  }

  const result = await generateWithFallback(prompt, generationConfig)
  const responseText = result.response.text()

  try {
    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const rawParsed = JSON.parse(cleaned)
    
    // Robust normalization before Zod validation
    if (rawParsed && Array.isArray(rawParsed.departments)) {
      const normalizedDepts = []
      let lastDept = null

      for (const item of rawParsed.departments) {
        if (typeof item === 'string') {
          // Model placed department name as a standalone string
          lastDept = { name: item.trim(), findings: [] }
          normalizedDepts.push(lastDept)
        } else if (item && typeof item === 'object') {
          const deptName = item.name || item.department_name || item.department || (lastDept ? lastDept.name : 'عام')
          let targetDept = normalizedDepts.find(d => d.name === deptName)
          if (!targetDept) {
            targetDept = { name: deptName, findings: [] }
            normalizedDepts.push(targetDept)
          }

          const rawFindings = Array.isArray(item.findings) ? item.findings : []
          for (const f of rawFindings) {
            if (typeof f === 'string') {
              targetDept.findings.push({
                original_text: f,
                canonical_text: f,
                corrective_action: null,
                responsible: null,
                deadline: null,
                priority: 'high'
              })
            } else if (f && typeof f === 'object') {
              const orig = f.original_text || f.text || f.finding || f.defect || ''
              targetDept.findings.push({
                original_text: orig,
                canonical_text: f.canonical_text || orig,
                corrective_action: f.corrective_action || f.action || null,
                responsible: f.responsible || null,
                deadline: f.deadline || null,
                priority: ['high', 'medium', 'low'].includes(f.priority) ? f.priority : 'high'
              })
            }
          }
          lastDept = targetDept
        }
      }
      rawParsed.departments = normalizedDepts.filter(d => d.findings.length > 0)
    }

    // Validate with Zod
    const validated = ReportZodSchema.parse(rawParsed)

    if (validated) {
      validated.inspection_date = sanitizeInspectionDate(validated.inspection_date || text)
    }
    
    return validated
  } catch (e) {
    console.error("Zod Validation or Parse Error:", e.message)
    console.error("Response text sample:", responseText?.slice(0, 800))
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
