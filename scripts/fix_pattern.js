const fs = require('fs');
const path = require('path');

const appreciationComments = fs.readFileSync(
  path.join(__dirname, '..', 'training_data', 'appreciation_1000.txt'), 'utf8'
).split('\n').map(l => l.trim()).filter(Boolean);

let code = fs.readFileSync(path.join(__dirname, 'tune_appreciation.js'), 'utf8');
code = code.replace(
  /\/\\b\(in\|with\|using\)\\s\+\(simple\|understandable\|accessible\|clear\)\\s\+\(language\|words\|terms\|demonstrations\?\|steps\|way\)\\b\/i/,
  '/\\\\b(in|with|using)\\\\s+(a\\\\s+)?(simple|understandable|accessible|clear).*?\\\\b(language|words|terms|demonstrations?|steps|way)\\\\b/i'
);
fs.writeFileSync(path.join(__dirname, 'tune_appreciation.js'), code, 'utf8');
