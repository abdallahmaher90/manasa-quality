import { GoogleGenerativeAI } from '@google/generative-ai'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

async function test() {
    console.log("Testing 1 single call to gemini-flash-latest...");
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
    try {
        const start = Date.now();
        const response = await model.generateContent("Hello, are you available?");
        const elapsed = Date.now() - start;
        console.log(`SUCCESS in ${elapsed}ms:`, response.response.text());
    } catch (e) {
        console.error("FAILED:");
        console.error(e.message);
    }
}
test();
