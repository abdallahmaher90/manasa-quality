const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else {
      if (file.endsWith('.js') || file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.jsx')) {
        results.push(file);
      }
    }
  });
  return results;
}

const files = walk('src/app');
let replacedCount = 0;

files.forEach(file => {
  if (file.includes('save-report') || file.includes('update-finding')) return;
  
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes(".from('findings')")) {
    content = content.replace(/\.from\('findings'\)/g, ".from('v_report_findings')");
    fs.writeFileSync(file, content, 'utf8');
    console.log('Updated: ' + file);
    replacedCount++;
  }
});
console.log('Total files updated: ' + replacedCount);
