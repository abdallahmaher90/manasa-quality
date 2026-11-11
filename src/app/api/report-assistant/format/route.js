import { NextResponse } from 'next/server'
import { createServiceClient, supabase as supabaseClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Helper to clean Arabic noise and slashes within words
function cleanArabicText(text) {
  if (!text) return ''
  return text.replace(/([\u0600-\u06FF])[\/\-_]([\u0600-\u06FF])/g, '$1$2').trim()
}

// Split large documents into manageable sections for comprehensive extraction
function splitTextIntoSections(text, maxChars = 3500) {
  const clean = cleanArabicText(text)
  const lines = clean.split('\n')
  const sections = []
  let current = ''

  for (const line of lines) {
    if ((current.length + line.length) > maxChars && current.length > 800) {
      sections.push(current.trim())
      current = line
    } else {
      current += '\n' + line
    }
  }
  if (current.trim()) {
    sections.push(current.trim())
  }
  return sections
}

// Call AI provider (Gemini primary with high token quota, Groq fallback)
async function callAiJson(prompt) {
  const geminiKey = process.env.GEMINI_API_KEY
  const groqKey = process.env.GROQ_API_KEY

  // 1. Try Gemini (gemini-3.8-flash has massive 1M TPM quota, ideal for large Extractions)
  if (geminiKey) {
    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai')
      const genAI = new GoogleGenerativeAI(geminiKey)
      const model = genAI.getGenerativeModel({
        model: 'gemini-3.8-flash',
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 8192,
          temperature: 0.1
        }
      })
      const res = await model.generateContent(prompt)
      const content = res.response.text()
      if (content) {
        return JSON.parse(content)
      }
    } catch (geminiErr) {
      console.warn('Gemini format call failed, attempting Groq fallback:', geminiErr.message)
    }
  }

  // 2. Groq fallback (openai/gpt-oss-120b with hidden reasoning)
  if (groqKey) {
    const candidateModels = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'allam-2-7b']
    for (const model of candidateModels) {
      try {
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: 'You are an Egyptian healthcare quality inspection expert. Output valid JSON only.' },
              { role: 'user', content: prompt }
            ],
            response_format: { type: 'json_object' },
            reasoning_format: 'hidden',
            reasoning_effort: 'low',
            temperature: 0.1,
            max_tokens: 4096
          })
        })

        if (groqRes.ok) {
          const data = await groqRes.json()
          const content = data.choices?.[0]?.message?.content
          if (content) {
            return JSON.parse(content)
          }
        } else {
          const errText = await groqRes.text()
          console.warn(`Groq candidate ${model} error (${groqRes.status}):`, errText)
        }
      } catch (groqErr) {
        console.warn(`Groq candidate ${model} exception:`, groqErr.message)
      }
    }
  }

  throw new Error('تعذر معالجة النص بالذكاء الاصطناعي حالياً. يرجى إعادة المحاولة.')
}

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token)
    if (authError || !user) {
      return NextResponse.json({ error: 'غير مصرح لك' }, { status: 401 })
    }

    const supabaseAdmin = createServiceClient()
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const isDirectorate = ['directorate_admin', 'directorate_member'].includes(profile?.role)
    if (!isDirectorate) {
      return NextResponse.json({ error: 'هذه الخدمة متاحة حصرياً لأعضاء فريق المديرية وفني الإحصاء.' }, { status: 403 })
    }

    const { text } = await request.json()
    if (!text || text.trim().length < 20) {
      return NextResponse.json({ error: 'يرجى إدخال نص أو مسودة التقرير' }, { status: 400 })
    }

    const cleanText = cleanArabicText(text)

    // Mode 1: Small report (<= 3,800 characters) -> Single fast pass
    if (cleanText.length <= 3800) {
      const prompt = `
أنت خبير في إدارة جودة الرعاية الصحية وإعداد تقارير المرور الرسمية لوزارة الصحة المصرية.
مهمتك: قراءة مسودة التقرير التالية، واستخراج كافة البيانات والسلبيات وتنظيمها في تقرير مرور رسمي متكامل.

قواعد الاستخراج والتنظيم:
1. "hospital_name": استخرج اسم المستشفى بدقة كما ورد في النص.
2. "governorate": المحافظة (افتراضياً: "كفر الشيخ").
3. "inspection_date": استخرج تاريخ المرور المذكور.
4. "inspector_name": استخرج أسماء القائمين بالمرور مع ألقابهم إن وجدت.
5. "departments": استخرج كافة الأقسام المذكورة في النص بدقة دون تفويت أي قسم.
6. لكل سلبية مذكورة تحت القسم في مصفوفة findings:
   - "defect" (بيان عدم التطابق): نص السلبية والمخالفة كاملاً.
   - "corrective_action" (الإجراء التصحيحي): صياغة الإجراء التصحيحي العملي المناسب لعلاج هذه السلبية.
   - "responsible" (المسئول عنه): الشخص أو الجهة المسؤولة عن التنفيذ المناسبة للمخالفة.
   - "deadline" (مدة التنفيذ): مدة التنفيذ المناسبة بحسب طبيعة السلبية (غالباً: "يوم" أو "اسبوع").

نص الملاحظات:
${cleanText}

أرجع JSON فقط بالهيكل التالي:
{
  "hospital_name": "اسم المنشأة",
  "governorate": "كفر الشيخ",
  "inspection_date": "تاريخ المرور",
  "inspector_name": "القائم بالمرور",
  "departments": [
    {
      "name": "اسم القسم",
      "findings": [
        {
          "defect": "بيان عدم التطابق",
          "corrective_action": "الإجراء التصحيحي المقترح",
          "responsible": "المسئول عنه",
          "deadline": "مدة التنفيذ"
        }
      ]
    }
  ]
}
`
      const parsedResult = await callAiJson(prompt)
      return NextResponse.json({ success: true, data: parsedResult })
    }

    // Mode 2: Large report (> 3,800 characters, supports unlimited findings) -> Sectional Extraction
    console.log(`[Report Assistant] Large document detected (${cleanText.length} chars). Running Sectional Extraction...`)

    // Step 1: Extract header metadata from first ~2000 chars
    const headerSample = cleanText.slice(0, 2000)
    const metaPrompt = `
استخرج بيانات ترويسة تقرير المرور فقط من النص التالي:
${headerSample}

أرجع JSON فقط:
{
  "hospital_name": "اسم المستشفى أو المنشأة بدقة كما ورد بالنص",
  "governorate": "المحافظة (افتراضياً: كفر الشيخ)",
  "inspection_date": "تاريخ المرور",
  "inspector_name": "أسماء القائمين بالمرور مع ألقابهم"
}
`
    let meta = { hospital_name: '', governorate: 'كفر الشيخ', inspection_date: '', inspector_name: '' }
    try {
      meta = await callAiJson(metaPrompt)
    } catch (e) {
      console.warn('[Report Assistant] Metadata extraction fallback:', e.message)
    }

    // Step 2: Split text into sections
    const sections = splitTextIntoSections(cleanText, 3500)
    console.log(`[Report Assistant] Split into ${sections.length} sections for parallel extraction`)

    const allDepartments = []

    // Process in batches of 2 to balance concurrency and rate limits
    for (let i = 0; i < sections.length; i += 2) {
      const batch = sections.slice(i, i + 2)
      const batchPromises = batch.map(async (sec) => {
        const secPrompt = `
أنت خبير جودة رعاية صحية في المستشفيات المصرية.
اقرأ جزء التقرير التالي واستخرج **جميع السلبيات بلا استثناء** وصنفها بدقة حسب الأقسام المذكورة:
إذا استمرت السلبيات من قسم سابق أو دل عليها السياق (مثل أدوية -> الصيدلية، صور وأشعة -> الأشعة، تعيين وتقييم -> ملفات العاملين) فصنفها تحت القسم المناسب.
لكل سلبية:
- "defect": بيان عدم التطابق كاملاً كما ورد.
- "corrective_action": الإجراء التصحيحي العملي المناسب المقترح.
- "responsible": المسئول عنه المناسب (مثل: مسئول القسم، الفريق الطبي، الصيدلي المسئول، مسئول الصيانة).
- "deadline": مدة التنفيذ المناسبة (مثل: "يوم" أو "اسبوع").

نص الجزء:
${sec}

أرجع JSON فقط:
{
  "departments": [
    {
      "name": "اسم القسم",
      "findings": [
        {
          "defect": "بيان عدم التطابق",
          "corrective_action": "الإجراء التصحيحي المقترح",
          "responsible": "المسئول عنه",
          "deadline": "مدة التنفيذ"
        }
      ]
    }
  ]
}
`
        const res = await callAiJson(secPrompt)
        return res?.departments || []
      })

      const batchResults = await Promise.all(batchPromises)
      for (const depts of batchResults) {
        allDepartments.push(...depts)
      }
    }

    // Step 3: Merge departments across sections
    const mergedDepartments = []
    for (const d of allDepartments) {
      if (!d.name || !d.findings || d.findings.length === 0) continue

      const cleanDeptName = d.name.trim().replace(/^قسم\s+/, '').trim()
      let existing = mergedDepartments.find(ed => {
        const edClean = ed.name.trim().replace(/^قسم\s+/, '').trim()
        return edClean === cleanDeptName || edClean.includes(cleanDeptName) || cleanDeptName.includes(edClean)
      })

      if (existing) {
        existing.findings.push(...d.findings)
      } else {
        mergedDepartments.push({
          name: d.name.trim(),
          findings: [...d.findings]
        })
      }
    }

    const finalReport = {
      hospital_name: meta.hospital_name || 'غير محدد',
      governorate: meta.governorate || 'كفر الشيخ',
      inspection_date: meta.inspection_date || '',
      inspector_name: meta.inspector_name || '',
      departments: mergedDepartments
    }

    const totalFindings = mergedDepartments.reduce((acc, d) => acc + (d.findings?.length || 0), 0)
    console.log(`[Report Assistant] Successfully parsed large report: ${mergedDepartments.length} departments, ${totalFindings} findings extracted.`)

    return NextResponse.json({
      success: true,
      data: finalReport
    })
  } catch (error) {
    console.error('Report Assistant API error:', error)
    return NextResponse.json({ error: error.message || 'حدث خطأ أثناء معالجة التقرير' }, { status: 500 })
  }
}
