const fs = require('fs');
const path = require('path');

const appreciationComments = fs.readFileSync(
  path.join(__dirname, '..', 'training_data', 'appreciation_1000.txt'), 'utf8'
).split('\n').map(l => l.trim()).filter(Boolean);

// Load APPRECIATION_PATTERNS from tune_appreciation
const tuneCode = fs.readFileSync(path.join(__dirname, 'tune_appreciation.js'), 'utf8');
const match = tuneCode.match(/const APPRECIATION_PATTERNS = \[([\s\S]*?)\];/);
if (!match) { console.error('Could not find patterns'); process.exit(1); }

let patterns = eval('[' + match[1] + ']');

let unmatched = appreciationComments.filter(c => !patterns.some(p => p.test(c)));
console.log('Initially unmatched:', unmatched.length);

// Print all remaining unmatched comments
unmatched.forEach((c, i) => {
  console.log(`${i+1}: "${c}"`);
});
