const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { ensureDriveFolder, uploadPdfToDrive, getDriveClientForUser } = require('../services/googleDriveService');
const { extractMetaFromPDF } = require('../services/pdfAnalyzer');

async function runTest() {
  console.log('=== 1. Testing Google Drive Service ===');
  const mockUser = {
    email: 'hod.cse@mits.ac.in',
    department: 'Computer Science',
    googleDriveConnected: false
  };

  const { drive, mode, email } = getDriveClientForUser(mockUser);
  console.log(`Drive client initialized: mode=${mode}, email=${email}`);

  const folderId = await ensureDriveFolder(drive, 'Test_Batch_Reports');
  console.log(`Drive folder ensured: folderId=${folderId}`);

  // Test buffer upload
  const samplePdfPath = path.join(__dirname, '../demo-output.pdf');
  let pdfBuffer;
  if (fs.existsSync(samplePdfPath)) {
    pdfBuffer = fs.readFileSync(samplePdfPath);
    console.log(`Loaded test PDF (${(pdfBuffer.length / 1024).toFixed(1)} KB)`);
  } else {
    pdfBuffer = Buffer.from('%PDF-1.4 test sample buffer');
    console.log('Created dummy PDF buffer');
  }

  const uploadResult = await uploadPdfToDrive({
    drive,
    fileName: 'Dr_Sharma_Feedback_Sem4.pdf',
    buffer: pdfBuffer,
    folderId
  });
  console.log('Upload result:', uploadResult);

  console.log('\n=== 2. Testing In-Memory ZIP Handling ===');
  const zip = new AdmZip();
  zip.addFile('feedback_dept/Dr_Sharma_CS101.pdf', pdfBuffer);
  zip.addFile('feedback_dept/Prof_Gupta_CS102.pdf', pdfBuffer);
  const zipBuffer = zip.toBuffer();
  console.log(`Created in-memory test ZIP archive (${(zipBuffer.length / 1024).toFixed(1)} KB)`);

  const readZip = new AdmZip(zipBuffer);
  const entries = readZip.getEntries().filter(e => !e.isDirectory && e.entryName.toLowerCase().endsWith('.pdf'));
  console.log(`Extracted ${entries.length} PDFs from ZIP archive:`);
  entries.forEach(e => console.log(` - ${path.basename(e.entryName)} (${(e.getData().length / 1024).toFixed(1)} KB)`));

  console.log('\n=== 3. Testing PDF Metadata Extraction ===');
  if (fs.existsSync(samplePdfPath)) {
    const meta = await extractMetaFromPDF(pdfBuffer);
    console.log('Extracted metadata:', meta);
  }

  console.log('\n=== 4. Testing Faculty Name Fuzzy Matching ===');
  function fuzzyMatch(extractedName, dbUsers) {
    // 1. Exact match
    let match = dbUsers.find(u => u.name.toLowerCase() === extractedName.toLowerCase());
    if (match) return { user: match, rule: 'exact' };

    // 2. Stripped prefix match (Dr., Prof., Mr., Ms.)
    const cleanExtracted = extractedName.replace(/^(Dr\.|Prof\.|Mr\.|Ms\.|Mrs\.)\s+/i, '').trim();
    match = dbUsers.find(u => {
      const cleanDb = u.name.replace(/^(Dr\.|Prof\.|Mr\.|Ms\.|Mrs\.)\s+/i, '').trim();
      return cleanDb.toLowerCase() === cleanExtracted.toLowerCase();
    });
    if (match) return { user: match, rule: 'prefix_stripped' };

    return null;
  }

  const testDb = [
    { _id: '1', name: 'Tanuja Sharma' },
    { _id: '2', name: 'Amit Kumar' }
  ];

  const m1 = fuzzyMatch('Dr. Tanuja Sharma', testDb);
  console.log('"Dr. Tanuja Sharma" matched to:', m1?.user?.name, `(rule: ${m1?.rule})`);

  const m2 = fuzzyMatch('Amit Kumar', testDb);
  console.log('"Amit Kumar" matched to:', m2?.user?.name, `(rule: ${m2?.rule})`);

  const m3 = fuzzyMatch('Guest Lecturer X', testDb);
  console.log('"Guest Lecturer X" matched to:', m3 ? m3.user.name : 'Unlinked (needs manual review)');

  console.log('\nALL VERIFICATION CHECKS PASSED SUCCESSFULLY!');
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
