import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'

// Fast fail fetch for model retries
const fastFailFetch = async (url, options) => {
  const res = await fetch(url, options)
  if (res.status === 429 || res.status === 503) {
    throw new Error(`FAST_FAIL_${res.status}`)
  }
  return res
}

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY // Use service role for backend access
    const geminiKey = process.env.GEMINI_API_KEY
    
    if (!supabaseUrl || !supabaseKey || !geminiKey) {
      return NextResponse.json({ error: 'Missing environment variables' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)
    const genAI = new GoogleGenerativeAI(geminiKey)

    // Fetch unresolved findings
    const { data: findings, error } = await supabase
      .from('findings')
      .select('id, original_text, hospitals(name), departments(name)')
      .in('status', ['open', 'recurring'])
      // Limiting to 500 to keep the response time somewhat reasonable for a web request,
      // and usually the most recent 500 cover the active recurring issues.
      .order('created_at', { ascending: false })
      .limit(500)

    if (error) throw error
    if (!findings || findings.length === 0) {
      return NextResponse.json({ clusters: [] })
    }

    // Prepare prompt
    const findingsList = findings.map((f, i) => {
      const hospitalName = f.hospitals ? f.hospitals.name : 'Unknown'
      const deptName = f.departments ? f.departments.name : 'Unknown'
      return `[${i+1}] المستشفى: ${hospitalName} | القسم: ${deptName} | السلبية: ${f.original_text}`
    }).join('\n')

    const prompt = `أنت نظام ذكاء اصطناعي متخصص في تحليل تقارير جودة المستشفيات.
قم بتحليل السلبيات التالية وتجميع السلبيات التي تشير إلى نفس المشكلة الجذرية (حتى لو اختلفت الصياغة) في مجموعات.

المطلوب:
أعطني النتيجة بصيغة JSON Array فقط، بدون أي نص إضافي وبدون علامات markdown للـ JSON.
كل عنصر في الـ Array يمثل "مجموعة" ويجب أن يحتوي على:
{
  "title": "اسم المشكلة الأساسية بوضوح واختصار",
  "total_count": عدد مرات ظهور هذه المشكلة بأشكال مختلفة,
  "examples": ["صياغة 1", "صياغة 2", "صياغة 3"],
  "hospitals": ["اسم المستشفى 1", "اسم المستشفى 2"]
}

ركز فقط على السلبيات التي تكررت في أكثر من مستشفى واحد أو بأكثر من صياغة مختلفة.
إذا لم تجد سلبيات متكررة، أرجع مصفوفة فارغة [].

السلبيات:
${findingsList}`

    const MODELS = ['gemini-flash-latest', 'gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-1.5-flash']
    let responseText = ''
    let lastError = null

    for (const modelName of MODELS) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName }, { customFetch: fastFailFetch })
        const result = await model.generateContent(prompt)
        responseText = result.response.text()
        break
      } catch (e) {
        lastError = e
        console.warn(`Model ${modelName} failed:`, e.message)
        continue
      }
    }

    if (!responseText) throw lastError

    // Clean JSON
    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    
    let parsed
    try {
      parsed = JSON.parse(cleaned)
    } catch (e) {
      console.error('Failed to parse AI response:', cleaned)
      throw new Error('AI returned invalid JSON')
    }

    // Filter to only include those in multiple hospitals, just to be sure
    const crossHospitalClusters = parsed.filter(c => c.hospitals && c.hospitals.length > 1)
    
    // Sort by count
    crossHospitalClusters.sort((a, b) => b.total_count - a.total_count)

    return NextResponse.json({ clusters: crossHospitalClusters })

  } catch (err) {
    console.error('AI Clustering error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
