import { NextResponse } from 'next/server'
import { createServiceClient, supabase as supabaseClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

    // Clean internal typos / slashes in Arabic words
    const cleanText = text.replace(/([\u0600-\u06FF])[\/\-_]([\u0600-\u06FF])/g, '$1$2').trim()

    const prompt = `
أنت خبير في إدارة جودة الرعاية الصحية وإعداد تقارير المرور الرسمية لوزارة الصحة المصرية.
مهمتك: قراءة مسودة أو ملاحظات المرور الخام التالية، واستخراج البيانات منها وتنظيمها في تقرير مرور رسمي متكامل ومطابق لنموذج التقارير الوزارية المعتمد.

قواعد الاستخراج والتنظيم الدقيقة:
1. "hospital_name": استخرج اسم المستشفى بدقة كما ورد في النص (مثال: "مستشفى كفر الشيخ العام", "مستشفى بيلا المركزي", إلخ).
2. "governorate": المحافظة (افتراضياً: "كفر الشيخ" ما لم يذكر غير ذلك صراحة).
3. "inspection_date": استخرج تاريخ المرور المذكور وحوله إلى صيغة رسمية واضحة ومقروءة (مثال: "12/10/2026").
4. "inspector_name": استخرج أسماء القائمين بالمرور مع ألقابهم إن وجدت (مثال: "م/ امل صبحي فتحي – م/ نسمه عبد النبي محمد" أو "د/ ...").
5. "departments": استخرج الأقسام المذكورة في النص بدقة (مثل: "قسم الأنف والأذن", "قسم العظام", "العناية الباطنة المركزة ب", "المعمل", إلخ). التزم تماماً بالأقسام المذكورة.
6. لكل سلبية مذكورة تحت القسم في مصفوفة findings:
   - "defect" (بيان عدم التطابق): نص السلبية والمخالفة كما وردت.
   - "corrective_action" (الإجراء التصحيحي): صياغة الإجراء التصحيحي المهني المناسب والعملي لعلاج هذه السلبية.
   - "responsible" (المسئول عنه): الشخص أو الجهة المسؤولة عن التنفيذ المناسبة للمخالفة (مثل: "الطبيب المسؤل", "مشرفه القسم", "الفريق التمريضي", "الصيدلي المسؤل", "اداره المستشفي", "مسئول الصيانة", "الفريق الطبي").
   - "deadline" (مدة التنفيذ): مدة التنفيذ المناسبة بحسب طبيعة السلبية (غالباً: "يوم" للنماذج والسجلات والأساور، أو "اسبوع" لتوفير التجهيزات والمستلزمات).
7. إذا كانت هناك أي خانة غير مذكورة أو غير متوفرة، اتركها فارغة أو ضع قيمة افتراضية مناسبة.

نص الملاحظات:
${cleanText}

أرجع JSON فقط بالهيكل التالي بدون أي مقدمات أو شروحات:
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

    // Try Groq candidates first (Ultra fast, dedicated limits)
    const groqKey = process.env.GROQ_API_KEY
    let parsedResult = null

    if (groqKey) {
      const candidateModels = ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b']
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
              temperature: 0.1
            })
          })

          if (groqRes.ok) {
            const data = await groqRes.json()
            const content = data.choices?.[0]?.message?.content
            if (content) {
              parsedResult = JSON.parse(content)
              break
            }
          }
        } catch (e) {
          console.warn(`Groq candidate ${model} error:`, e.message)
        }
      }
    }

    // Secondary fallback: Gemini
    if (!parsedResult && process.env.GEMINI_API_KEY) {
      try {
        const { GoogleGenerativeAI } = await import('@google/generative-ai')
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
        const geminiModel = genAI.getGenerativeModel({
          model: 'gemini-3.8-flash',
          generationConfig: { responseMimeType: 'application/json' }
        })
        const geminiRes = await geminiModel.generateContent(prompt)
        const textOut = geminiRes.response.text()
        parsedResult = JSON.parse(textOut)
      } catch (geminiErr) {
        console.error('Gemini assistant fallback failed:', geminiErr.message)
      }
    }

    if (!parsedResult) {
      throw new Error('تعذر معالجة النص بالذكاء الاصطناعي حالياً. يرجى التأكد من الاتصال وإعادة المحاولة.')
    }

    return NextResponse.json({
      success: true,
      data: parsedResult
    })
  } catch (error) {
    console.error('Report Assistant API error:', error)
    return NextResponse.json({ error: error.message || 'حدث خطأ أثناء معالجة التقرير' }, { status: 500 })
  }
}
