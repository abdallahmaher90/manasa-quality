import fs from 'fs'

const multiGroups = JSON.parse(fs.readFileSync('C:/Users/Dr Abdallah/.gemini/antigravity-ide/brain/be48360a-d082-48ef-a62c-f7305ced7778/scratch/multi_groups.json', 'utf8'));
const allFindings = JSON.parse(fs.readFileSync('C:/Users/Dr Abdallah/.gemini/antigravity-ide/brain/be48360a-d082-48ef-a62c-f7305ced7778/scratch/all_findings.json', 'utf8'));

console.log('--- FALSE POSITIVE CANDIDATES (Over-grouped) ---');
let fpCount = 0;
for (const g of multiGroups) {
  // if items have very different lengths or no common words
  const texts = g.items.map(i => i.text);
  const lengths = texts.map(t => t?.length || 0);
  const minLen = Math.min(...lengths);
  const maxLen = Math.max(...lengths);
  
  if (maxLen > minLen * 2 && fpCount < 5) {
    console.log(`\nGroup: ${g.title}`);
    texts.forEach(t => console.log(`  - ${t}`));
    fpCount++;
  }
}

console.log('\n--- FALSE NEGATIVE CANDIDATES (Under-grouped) ---');
// Same hospital, different groups, similar texts
const hospGroups = new Map();
for (const f of allFindings) {
  if (!hospGroups.has(f.hosp)) hospGroups.set(f.hosp, []);
  hospGroups.get(f.hosp).push(f);
}

let fnCount = 0;
for (const [hosp, items] of hospGroups.entries()) {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a.group !== b.group && a.text && b.text) {
        // check if very similar
        const tokA = new Set(a.text.split(' '));
        const tokB = new Set(b.text.split(' '));
        const shared = [...tokA].filter(x => tokB.has(x) && x.length > 3);
        if (shared.length >= 3 && fnCount < 5) {
          console.log(`\nHosp: ${hosp}`);
          console.log(`  Group ${a.group}: ${a.text}`);
          console.log(`  Group ${b.group}: ${b.text}`);
          console.log(`  Shared: ${shared.join(', ')}`);
          fnCount++;
        }
      }
    }
  }
}
