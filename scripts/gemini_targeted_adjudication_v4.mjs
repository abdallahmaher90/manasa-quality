import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI, Type } from '@google/genai'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

const MODEL_NAME = 'gemini-3.5-flash'
const MAX_RETRIES = 3
const MIN_DELAY_MS = 6000 // 6 seconds for 10 RPM

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function callGeminiWithRetry(prompt, retries = 0, consecutiveErrors = 0) {
    const startTime = Date.now()
    try {
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: prompt,
            config: {
                temperature: 0.1,
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        decision: { type: Type.STRING, enum: ['SAME_ISSUE', 'DISTINCT', 'UNCERTAIN'] },
                        confidence: { type: Type.STRING, enum: ['HIGH', 'MEDIUM', 'LOW'] },
                        reason: { type: Type.STRING },
                        entity_comparison: { type: Type.STRING },
                        defect_comparison: { type: Type.STRING },
                        requirement_comparison: { type: Type.STRING },
                        context_comparison: { type: Type.STRING }
                    },
                    required: ['decision', 'confidence', 'reason', 'entity_comparison', 'defect_comparison', 'requirement_comparison', 'context_comparison']
                }
            }
        })
        const latency = Date.now() - startTime
        return { data: JSON.parse(response.text), error: null, latency, retries, status: 200 }
    } catch (error) {
        const latency = Date.now() - startTime
        const status = error.status || 500
        console.error(`Error calling Gemini (Status: ${status}): ${error.message}`)
        
        if (retries < MAX_RETRIES) {
            let backoff = Math.pow(2, retries) * 1000 + Math.random() * 1000
            
            // Respect Retry-After if present (rough heuristic)
            if (status === 429 && error.message.includes('Quota')) {
                backoff = Math.max(backoff, 60000) // Fallback to 60s if quota exceeded
            }
            
            console.log(`Retrying in ${Math.round(backoff/1000)}s...`)
            await delay(backoff)
            return callGeminiWithRetry(prompt, retries + 1, consecutiveErrors + 1)
        }
        
        return { data: null, error: error.message, latency, retries, status }
    }
}

async function runTargetedPilot() {
    console.log(`MODEL = ${MODEL_NAME}`)
    console.log(`MODE = TARGETED_PILOT`)
    console.log(`COUNT = 5\n`)

    const queueData = JSON.parse(fs.readFileSync('final_uncertain_queue.json', 'utf8'))
    const highPriorityQueue = queueData.queue.filter(q => q.queue_label === 'NEEDS_GEMINI_LATER' && q.priority === 'HIGH')

    // Select 5 diverse cases
    const selectedCases = []
    const usedGroups = new Set()

    for (const item of highPriorityQueue) {
        if (!usedGroups.has(item.top_candidate_group)) {
            selectedCases.push(item)
            usedGroups.add(item.top_candidate_group)
            if (selectedCases.length === 5) break
        }
    }

    // Fallback if we couldn't find 5 diverse cases
    if (selectedCases.length < 5) {
        for (const item of highPriorityQueue) {
            if (!selectedCases.find(s => s.finding_id === item.finding_id)) {
                selectedCases.push(item)
                if (selectedCases.length === 5) break
            }
        }
    }

    console.log(`Selected ${selectedCases.length} diverse cases for pilot.`)

    const results = []
    const report = {
        total: selectedCases.length,
        SAME_ISSUE: 0,
        DISTINCT: 0,
        UNCERTAIN: 0,
        successful_calls: 0,
        failed_calls: 0,
        _429_errors: 0,
        _503_errors: 0,
        total_retries: 0,
        avg_latency_ms: 0,
        effective_rpm: 0
    }

    let consecutiveErrors = 0
    let totalLatency = 0
    const overallStartTime = Date.now()

    for (let i = 0; i < selectedCases.length; i++) {
        const c = selectedCases[i]
        console.log(`\nProcessing [${i+1}/${selectedCases.length}]: ${c.finding_id}`)
        console.log(`Finding: ${c.original_text}`)
        console.log(`Target Candidate: ${c.top_candidate_group}`)

        const prompt = `You are a Semantic Adjudicator for a healthcare audit system.
Your task is to compare an audit finding to an existing recurrence group candidate.

FINDING:
"${c.original_text}"

CANDIDATE GROUP TITLE:
"${c.top_candidate_group}"

Compare the two based on:
1. Entity (e.g., department, specific equipment, role)
2. Defect (e.g., incomplete, broken, missing)
3. Requirement (e.g., specific policy, standard)
4. Context/Scope (e.g., general vs specific, emergency vs routine)

SAFETY RULES:
- Only output SAME_ISSUE if Entity, Defect, and Context are all compatible.
- SEPARATE > MERGE. When in doubt, prefer DISTINCT or UNCERTAIN.
- Any conflicting scope/entity/defect means DISTINCT.

Adjudicate this match.`

        const iterationStartTime = Date.now()
        const result = await callGeminiWithRetry(prompt, 0, consecutiveErrors)
        
        // Enforce rate limiting delay
        const iterationDuration = Date.now() - iterationStartTime
        if (iterationDuration < MIN_DELAY_MS) {
            await delay(MIN_DELAY_MS - iterationDuration)
        }

        report.total_retries += result.retries
        totalLatency += result.latency

        if (result.error) {
            console.log(`Failed: ${result.error}`)
            report.failed_calls++
            if (result.status === 429) report._429_errors++
            if (result.status === 503) report._503_errors++
            consecutiveErrors++
            
            results.push({
                finding_id: c.finding_id,
                original_text: c.original_text,
                candidate_title: c.top_candidate_group,
                local_score: c.candidate_score,
                status: 'ERROR',
                error_message: result.error,
                retries: result.retries,
                latency: result.latency,
                timestamp: new Date().toISOString()
            })

            if (consecutiveErrors >= 2) {
                console.log("\nSTOPPING PILOT due to 2 consecutive errors.")
                break
            }
        } else {
            console.log(`Success: ${result.data.decision} (${result.data.confidence}) - ${result.data.reason}`)
            consecutiveErrors = 0
            report.successful_calls++
            
            if (result.data.decision === 'SAME_ISSUE') report.SAME_ISSUE++
            else if (result.data.decision === 'DISTINCT') report.DISTINCT++
            else report.UNCERTAIN++

            results.push({
                finding_id: c.finding_id,
                original_text: c.original_text,
                candidate_title: c.top_candidate_group,
                local_score: c.candidate_score,
                gemini_decision: result.data.decision,
                gemini_confidence: result.data.confidence,
                gemini_reason: result.data.reason,
                entity_comparison: result.data.entity_comparison,
                defect_comparison: result.data.defect_comparison,
                requirement_comparison: result.data.requirement_comparison,
                context_comparison: result.data.context_comparison,
                model: MODEL_NAME,
                retries: result.retries,
                latency: result.latency,
                status: 'SUCCESS',
                timestamp: new Date().toISOString()
            })
        }
    }

    const overallDurationMin = (Date.now() - overallStartTime) / 60000
    report.avg_latency_ms = report.successful_calls > 0 ? Math.round(totalLatency / report.successful_calls) : 0
    report.effective_rpm = overallDurationMin > 0 ? +(report.successful_calls / overallDurationMin).toFixed(2) : 0

    fs.writeFileSync('gemini_targeted_pilot_5.json', JSON.stringify(results, null, 2))
    fs.writeFileSync('gemini_targeted_pilot_5_report.json', JSON.stringify(report, null, 2))

    console.log(`\nPilot Complete. Results saved to gemini_targeted_pilot_5.json and gemini_targeted_pilot_5_report.json`)
    console.log(JSON.stringify(report, null, 2))
}

runTargetedPilot().catch(console.error)
