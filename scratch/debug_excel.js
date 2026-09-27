// Run: node scratch/debug_excel.js <path-to-your-excel-file>
// Example: node scratch/debug_excel.js "C:\Users\Hp\Downloads\feedback.xlsx"

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { parseCSV } = require('../services/csvParser');

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node scratch/debug_excel.js <path-to-excel>');
  process.exit(1);
}

const buffer = fs.readFileSync(filePath);

// 1. Show raw sheet content
console.log('\n=== RAW SHEET CONTENT ===');
const wb = XLSX.read(buffer, { type: 'buffer' });
console.log('Sheets:', wb.SheetNames);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
rows.slice(0, 10).forEach((row, i) => {
  console.log(`Row ${i}:`, row);
});

// 2. Show hyperlinks in cells
console.log('\n=== CELL HYPERLINKS ===');
Object.keys(ws).filter(k => !k.startsWith('!')).forEach(addr => {
  const cell = ws[addr];
  if (cell.l) console.log(`Cell ${addr}: link=${cell.l.Target}, val=${cell.v}`);
});

// 3. Run the parser
console.log('\n=== PARSER RESULT ===');
const results = parseCSV(buffer);
console.log(`Found ${results.length} entries:`);
results.forEach((r, i) => console.log(`  ${i+1}. ${r.pdfLink} | faculty: ${r.facultyName} | resp: ${r.responseCount}`));

if (results.length === 0) {
  console.log('\n⚠ Parser found nothing. Check rows above for URLs.');
}
