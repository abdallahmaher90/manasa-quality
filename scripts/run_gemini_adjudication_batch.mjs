import fs from 'fs'
import path from 'path'
import { GoogleGenAI } from '@google/genai'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

const QUEUE_FILE = 'gemini_review_queue_v4.json'
const CHECKPOINT_FILE = 'gemini_adjudication_checkpoint.json'
const RESULTS_JSON = 'gemini_adjudication_results_v4.json'
const RESULTS_MD = 'gemini_adjudication_results_v4.md'
const BATCH_SIZE = 65

async function run() {
  if (!fs.existsSync(QUEUE_FILE)) {
    console.error(`Queue file ${QUEUE_FILE} not found.`)
    process.exit(1)
  }

  const queueData = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'))
  const cases = queueData.cases || []

  let checkpoint = []
  if (fs.existsSync(CHECKPOINT_FILE)) {
    checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'))
  }

  const processedIds = new Set(checkpoint.map(c => c.finding_id))
  const remainingCases = cases.filter(c => !processedIds.has(c.finding_id))

  console.log(`Total cases in queue: ${cases.length}`)
  console.log(`Already processed: ${checkpoint.length}`)
  console.log(`Remaining to process: ${remainingCases.length}\n`)

  if (remainingCases.length === 0) {
    console.log('All cases processed. Generating final audit files...')
    generateAuditFiles(checkpoint)
    return
  }

  const batch = remainingCases.slice(0, BATCH_SIZE)
  console.log(`Processing batch of ${batch.length} cases...`)

  for (let i = 0; i < batch.length; i++) {
    const c = batch[i]
    console.log(`[${i+1}/${batch.length}] Analyzing: ${c.finding_id}`)
    
    try {
      const result = await analyzeCase(c)
      checkpoint.push(result)
      fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2))
      console.log(`   -> Decision: ${result.decision} (Confidence: ${result.confidence})`)
      
      if (i < batch.length - 1) {
        await new Promise(r => setTimeout(r, 4500))
      }
    } catch (err) {
      console.error(`\nError analyzing case ${c.finding_id}:`, err.message)
      if (err.status === 429) {
        const retryMatch = err.message.match(/retry in ([\d\.]+)s/)
        let waitSecs = 60
        if (retryMatch && retryMatch[1]) {
          waitSecs = Math.ceil(parseFloat(retryMatch[1]))
        }
        
        if (waitSecs <= 120) {
          console.log(`Rate limit reached. Waiting for ${waitSecs} seconds before continuing...`)
          await new Promise(r => setTimeout(r, waitSecs * 1000 + 1000))
          i-- // retry the same item
          continue
        } else {
          console.error(`Rate limit reached and wait time (${waitSecs}s) is too long. Stopping batch safely.`)
        }
      }
      break
    }
  }

  // Update files with current progress
  generateAuditFiles(checkpoint)
  
  const stats = checkpoint.reduce((acc, curr) => {
    acc[curr.decision] = (acc[curr.decision] || 0) + 1
    return acc
  }, {})

  console.log('\n--- Batch Complete ---')
  console.log(`Total Processed: ${checkpoint.length}`)
  console.log(`SAME_ISSUE: ${stats.SAME_ISSUE || 0}`)
  console.log(`DISTINCT: ${stats.DISTINCT || 0}`)
  console.log(`UNCERTAIN: ${stats.UNCERTAIN || 0}`)
  console.log(`Remaining in queue: ${cases.length - checkpoint.length}`)
  
  if (cases.length - checkpoint.length > 0) {
    console.log('\nRun the script again to process the next batch.')
  }
}

async function analyzeCase(c) {
  const prompt = `
أنت خبير في تدقيق الجودة الطبية في مستشفيات وزارة الصحة.
نحن نقوم بعملية Semantic Adjudication لملاحظات الجودة لاكتشاف التكرار (Recurrence).
القاعدة الذهبية الصارمة: SEPARATE > MERGE.
- لا تدمج (SAME_ISSUE) إلا إذا كان النص الجديد يصف بالضبط نفس المشكلة الجوهرية الموجودة في الملاحظة المرشحة.
- اختلاف الكيان (Entity)، أو الخلل (Defect)، أو النطاق (Scope) بشكل جوهري = DISTINCT (مشكلة جديدة).
- التشابه في الكلمات أو في نفس المجال لا يكفي للدمج.
- أي شك حقيقي في التطابق = UNCERTAIN.

الملاحظة الجديدة (Original Text): "${c.original_text}"
المجموعة المرشحة للدمج معها (Candidate Group Title): "${c.candidate_title}"

قم بتحليل التطابق، ثم أرجع النتيجة بصيغة JSON صارمة كالتالي:
{
  "decision": "SAME_ISSUE" | "DISTINCT" | "UNCERTAIN",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "reason": "شرح قصير ومباشر لسبب قرارك",
  "entity_comparison": "مقارنة الكيان المستهدف",
  "defect_comparison": "مقارنة الخلل المرصود",
  "requirement_comparison": "مقارنة المعيار/المتطلب",
  "scope_comparison": "مقارنة نطاق المشكلة"
}
`

  const response = await ai.models.generateContent({
    model: 'gemini-3.6-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      temperature: 0.1
    }
  })

  let raw = response.text
  // Remove markdown JSON formatting if present
  if (raw.startsWith('```json')) raw = raw.replace(/```json/g, '').replace(/```/g, '').trim()

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    console.error("Failed to parse JSON from Gemini:", raw)
    return {
      finding_id: c.finding_id,
      original_text: c.original_text,
      candidate_group_id: c.candidate_group_id,
      candidate_title: c.candidate_title,
      decision: "UNCERTAIN",
      confidence: "LOW",
      reason: "Failed to parse Gemini response",
      entity_comparison: "-",
      defect_comparison: "-",
      requirement_comparison: "-",
      scope_comparison: "-"
    }
  }

  return {
    finding_id: c.finding_id,
    original_text: c.original_text,
    candidate_group_id: c.candidate_group_id,
    candidate_title: c.candidate_title,
    decision: ['SAME_ISSUE', 'DISTINCT', 'UNCERTAIN'].includes(parsed.decision) ? parsed.decision : 'UNCERTAIN',
    confidence: parsed.confidence || 'LOW',
    reason: parsed.reason || '',
    entity_comparison: parsed.entity_comparison || '',
    defect_comparison: parsed.defect_comparison || '',
    requirement_comparison: parsed.requirement_comparison || '',
    scope_comparison: parsed.scope_comparison || ''
  }
}

function generateAuditFiles(checkpoint) {
  fs.writeFileSync(RESULTS_JSON, JSON.stringify(checkpoint, null, 2))
  
  let md = '# Gemini Adjudication Results (V4)\n\n'
  md += 'This document contains the automated semantic decisions for edge cases.\n\n'
  
  const groups = { 'SAME_ISSUE': [], 'DISTINCT': [], 'UNCERTAIN': [] }
  checkpoint.forEach(c => {
    if (groups[c.decision]) groups[c.decision].push(c)
  })

  for (const [decision, items] of Object.entries(groups)) {
    md += `## ${decision} (${items.length})\n\n`
    items.forEach(c => {
      md += `- **Finding ID**: ${c.finding_id}\n`
      md += `  - **Original Text**: ${c.original_text}\n`
      md += `  - **Candidate Title**: ${c.candidate_title}\n`
      md += `  - **Confidence**: ${c.confidence}\n`
      md += `  - **Reason**: ${c.reason}\n`
      md += `  - **Comparisons**: Entity [${c.entity_comparison}], Defect [${c.defect_comparison}]\n\n`
    })
  }

  fs.writeFileSync(RESULTS_MD, md)
}

run()
