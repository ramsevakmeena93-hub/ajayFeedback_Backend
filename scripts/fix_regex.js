const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '..', 'services', 'aiAnalyzer.js');
let lines = fs.readFileSync(targetPath, 'utf8').split(/\r?\n/);

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('// "not just theory, actually practice"')) {
    lines.splice(i + 1, 2,
      '  /\\bnot\\s+just\\s+(the\\s+)?(theory|procedure|reading|watching|listening)[,\\s].*(actually|also|but)\\s+(practic|apply|code|hands[\\s-]on|do)\\b/i,',
      '  /\\bnot\\s+just\\s+(the\\s+)?(theory|procedure|reading|watching|listening)[.\\s]*$/i,'
    );
    break;
  }
}

fs.writeFileSync(targetPath, lines.join('\n'), 'utf8');
console.log('Added not just procedure override');
