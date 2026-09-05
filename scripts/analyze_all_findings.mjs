import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';

const envFile = fs.readFileSync('.env.local', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  const match = line.trim().match(/^([^=]+)=(.*)$/);
  if (match) env[match[1]] = match[2];
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

async function run() {
  console.log('Fetching findings from Supabase...');
  
  let allFindings = [];
  let start = 0;
  const limit = 1000;
  
  while (true) {
    const { data: findings, error } = await supabase
      .from('findings')
      .select('id, original_text, hospitals(name), departments(name)')
      .range(start, start + limit - 1);
      
    if (error) {
      console.error('Error fetching findings:', error);
      return;
    }
    
    if (findings.length === 0) break;
    
    allFindings = allFindings.concat(findings);
    start += limit;
  }
  
  console.log(`Fetched ${allFindings.length} findings.`);
  
  const findingsList = allFindings.map((f, i) => {
    const hospitalName = f.hospitals ? f.hospitals.name : 'Unknown';
    const deptName = f.departments ? f.departments.name : 'Unknown';
    return `[${i+1}] المستشفى: ${hospitalName} | القسم: ${deptName} | السلبية: ${f.original_text}`;
  }).join('\n');

  console.log('Sending to Gemini for analysis (this may take a minute)...');
  
  const prompt = `أنت خبير في جودة الرعاية الصحية ومكافحة العدوى وإدارة السلبيات في المستشفيات.
لدينا قائمة بالسلبيات (Findings) التي تم رصدها في مستشفيات مختلفة. بعض هذه السلبيات متكررة عبر المستشفيات أو الأقسام ولكن تمت صياغتها بطرق مختلفة (نفس المعنى والمشكلة ولكن بكلمات مختلفة).

المطلوب:
1. تحليل جميع السلبيات وتجميعها إلى "مجموعات" (Clusters) بناءً على المعنى والمشكلة الجذرية المشتركة.
2. استخراج أهم السلبيات التي تكررت بأشكال وصياغات مختلفة واعتبارها مشكلة واحدة مشتركة.
3. لكل مجموعة من السلبيات المتكررة بصيغ مختلفة، اذكر:
   - اسم المشكلة الأساسية (عنوان واضح ومختصر للمشكلة).
   - عدد تكراراتها الإجمالي.
   - أمثلة على الصياغات المختلفة التي ظهرت بها هذه السلبية في التقرير لتوضيح التباين في الصياغة لنفس المشكلة (اذكر ٣-٤ صياغات مختلفة على الأقل إن وجدت).
   - أسماء المستشفيات التي تكررت فيها هذه المشكلة (بدون تكرار).

أريد الإخراج بصيغة Markdown منسقة كتقرير تحليلي. ركز على السلبيات الأكثر شيوعاً وتكراراً والتي تأخذ صياغات مختلفة.

قائمة السلبيات:
${findingsList}`;

  // Use gemini-3.6-flash
  const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });
  
  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    const outputDir = 'C:/Users/Dr Abdallah/.gemini/antigravity-ide/brain/22f02dc4-238c-4190-b66b-30f9eb515355';
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, 'recurring_negatives_analysis.md');
    fs.writeFileSync(outputPath, text);
    console.log(`Analysis complete. Results saved to ${outputPath}`);
  } catch (err) {
    console.error('Gemini error:', err);
  }
}

run();
