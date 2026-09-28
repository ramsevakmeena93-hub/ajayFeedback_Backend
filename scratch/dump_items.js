const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

async function dump() {
  const buf = fs.readFileSync('./scratch/sample.pdf');
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  tc.items.forEach(i => {
    const s = i.str.trim();
    if (s) {
      console.log('x=' + Math.round(i.transform[4]) + ', y=' + Math.round(i.transform[5]) + ' : "' + s + '"');
    }
  });
}

dump().catch(console.error);
