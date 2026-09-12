import { GoogleGenerativeAI } from '@google/generative-ai'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config({ path: '.env.local' })
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey)

async function run() {
    console.log("Fetching available models...");
    let availableModels = [];
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const data = await res.json();
        availableModels = data.models || [];
    } catch (e) {
        console.error("Failed to fetch models:", e.message);
        return;
    }

    const flashModels = availableModels.filter(m => m.name.includes('flash'));
    console.log(`Found ${flashModels.length} Flash models.`);
    
    // Pick a model, prefer 1.5-flash if available, or just the first stable one.
    let selectedModelName = null;
    const prefer15 = flashModels.find(m => m.name.includes('gemini-1.5-flash') && !m.name.includes('latest') && !m.name.includes('tuning'));
    if (prefer15) {
        selectedModelName = prefer15.name.replace('models/', '');
    } else if (flashModels.length > 0) {
        selectedModelName = flashModels[0].name.replace('models/', '');
    }

    if (!selectedModelName) {
        console.error("No Flash models found.");
        return;
    }

    // Skip the one that failed (gemini-3.8-flash / gemini-flash-latest) if possible
    if (selectedModelName.includes('3.8') || selectedModelName === 'gemini-flash-latest') {
        const alternative = flashModels.find(m => !m.name.includes('3.8') && !m.name.includes('latest'));
        if (alternative) selectedModelName = alternative.name.replace('models/', '');
    }

    console.log("Selected Model:", selectedModelName);
    
    const diagnosis = {
        model: selectedModelName,
        sdk: "@google/generative-ai",
        success: false,
        httpStatus: null,
        exactErrorCategory: null,
        quotaMetric: null,
        quotaLimit: null,
        responseLatencyMs: null
    };

    console.log("Running single generateContent call...");
    const model = genAI.getGenerativeModel({ model: selectedModelName });
    const start = Date.now();
    try {
        const response = await model.generateContent("Hello, are you available?");
        diagnosis.responseLatencyMs = Date.now() - start;
        diagnosis.success = true;
        diagnosis.httpStatus = 200;
        console.log(`SUCCESS in ${diagnosis.responseLatencyMs}ms`);
    } catch (e) {
        diagnosis.responseLatencyMs = Date.now() - start;
        diagnosis.success = false;
        
        console.error("FAILED:");
        console.error(e.message);

        // Try to parse the error message to extract HTTP status and quota details
        if (e.message.includes('429')) diagnosis.httpStatus = 429;
        else if (e.message.includes('503')) diagnosis.httpStatus = 503;
        else if (e.status) diagnosis.httpStatus = e.status;

        if (e.message.includes('Quota exceeded')) diagnosis.exactErrorCategory = 'Quota Exceeded';
        else diagnosis.exactErrorCategory = 'API Error';

        const metricMatch = e.message.match(/Quota exceeded for metric: ([\w\.\/_-]+), limit: (\d+)/);
        if (metricMatch) {
            diagnosis.quotaMetric = metricMatch[1];
            diagnosis.quotaLimit = parseInt(metricMatch[2], 10);
        }
    }

    fs.writeFileSync('alternate_model_diagnosis.json', JSON.stringify(diagnosis, null, 2));
    console.log("Results written to alternate_model_diagnosis.json");
}

run().catch(console.error);
