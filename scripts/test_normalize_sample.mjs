import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';

const envFile = fs.readFileSync('.env.local', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  const match = line.trim().match(/^([^=]+)=(.*)$/);
  if (match) env[match[1]] = match[2];
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

async function test() {
  const { data: sample, error } = await supabase.from('findings')
    .select('id, original_text, departments(name)')
    .limit(10);
    
  if (error) {
    console.error(error);
    return;
  }
  
  const prompt = `أنت خبير جودة رعاية صحية ومكافحة عدوى واعتماد مستشفيات.
قم بتوحيد صياغة السلبيات التالية تحت مسميات معيارية قياسية موحدة واحترافية (canonical_text).
السلبيات التي تتناول نفس المشكلة الجوهرية يجب أن تأخذ نفس الصياغة المعيارية تماماً بدون تغيير حرفي بينها.

السلبيات:
${sample.map(s => `[${s.id}]: ${s.original_text}`).join('\n')}

أجب بصيغة JSON Array فقط:
[
  { "id": "uuid", "canonical_text": "الصياغة المعيارية الموحدة" }
]
`;

  const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });
  const res = await model.generateContent(prompt);
  console.log('Gemini output:\n', res.response.text());
}

test();
