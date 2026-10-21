const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '..', 'services', 'aiAnalyzer.js');
let lines = fs.readFileSync(targetPath, 'utf8').split(/\r?\n/);

// Find line containing ": 'negated-praise-or-complaint'"
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("'negated-praise-or-complaint'")) {
    console.log('Found line at', i);
    // Remove the next line if it is ": 'generic-improvement-request'"
    if (lines[i+1] && lines[i+1].includes("'generic-improvement-request'")) {
      console.log('Removing line', i+1, lines[i+1]);
      lines.splice(i+1, 1);
      break;
    }
  }
}

fs.writeFileSync(targetPath, lines.join('\n'), 'utf8');
console.log('Done');
