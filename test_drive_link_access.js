/**
 * Test if service account can access Google Drive PDF links
 * Run: node test_drive_link_access.js
 */

require('dotenv').config();
const axios = require('axios');
const { google } = require('googleapis');

async function testDriveLinkAccess() {
  console.log('≡ƒöì Testing Google Drive Link Access...\n');

  // Example Drive link (replace with your actual PDF link)
  const testLink = 'https://drive.google.com/open?id=1txsD9qcwbRakuwDtNi3RrdYyYPcYXLwY&usp=drive_copy';
  
  // Extract file ID from link
  const fileIdMatch = testLink.match(/\/d\/([a-zA-Z0-9_-]+)|[?&]id=([a-zA-Z0-9_-]+)/);
  if (!fileIdMatch) {
    console.error('Γ¥î Invalid Drive link format');
    console.error('   Link:', testLink);
    return;
  }
  
  const fileId = fileIdMatch[1] || fileIdMatch[2];
  console.log(`≡ƒôä File ID: ${fileId}\n`);

  // Check environment variables
  const clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_DRIVE_PRIVATE_KEY;

  if (!clientEmail || !privateKey) {
    console.error('Γ¥î Missing GOOGLE_DRIVE_CLIENT_EMAIL or GOOGLE_DRIVE_PRIVATE_KEY');
    return;
  }

  console.log(`≡ƒôº Service Account: ${clientEmail}\n`);

  try {
    // Create authentication
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });

    const drive = google.drive({ version: 'v3', auth });
    
    console.log('≡ƒöÉ Authenticating...');
    
    // Try to get file metadata
    const fileInfo = await drive.files.get({
      fileId: fileId,
      fields: 'id, name, mimeType, size, createdTime, modifiedTime, owners, shared, permissions',
    });

    console.log('Γ£à File metadata access successful!\n');
    console.log('≡ƒôï File Details:');
    console.log(`   Name: ${fileInfo.data.name}`);
    console.log(`   Type: ${fileInfo.data.mimeType}`);
    console.log(`   Size: ${(fileInfo.data.size / 1024).toFixed(2)} KB`);
    console.log(`   Shared: ${fileInfo.data.shared ? 'Yes' : 'No'}\n`);

    // Try to download file content
    console.log('≡ƒôÑ Attempting to download file content...');
    
    const response = await drive.files.get({
      fileId: fileId,
      alt: 'media',
    }, {
      responseType: 'arraybuffer'
    });

    console.log('Γ£à File download successful!');
    console.log(`   Downloaded: ${(response.data.byteLength / 1024).toFixed(2)} KB\n`);

    console.log('≡ƒÄë All tests passed! Service account can access Drive links.');
    console.log('\n≡ƒÆí Your AI analyzer should work correctly now.');
    
  } catch (error) {
    console.error('Γ¥î Access failed:');
    console.error(`   Error: ${error.message}`);
    
    if (error.code === 404) {
      console.error('\n≡ƒÆí File not found. Possible reasons:');
      console.error('   1. File ID is incorrect');
      console.error('   2. File was deleted');
      console.error('   3. Service account has no access');
    } else if (error.code === 403) {
      console.error('\n≡ƒÆí Permission denied! Fix:');
      console.error('   1. Share the file/folder with service account email:');
      console.error(`      ${clientEmail}`);
      console.error('   2. Grant "Viewer" permission');
      console.error('   3. For folders: Share parent folder, not individual files');
    } else if (error.message.includes('private_key')) {
      console.error('\n≡ƒÆí Authentication failed:');
      console.error('   Check GOOGLE_DRIVE_PRIVATE_KEY format (needs \\n characters)');
    }
  }
}

// Instructions
console.log('ΓòöΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòù');
console.log('Γòæ   Google Drive Link Access Test                        Γòæ');
console.log('ΓòÜΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓò¥\n');

console.log('≡ƒô¥ To test with your actual file:');
console.log('   1. Replace testLink in this file with your PDF link');
console.log('   2. Run: node test_drive_link_access.js\n');

// Run the test
testDriveLinkAccess()
  .then(() => {
    console.log('\nΓ£à Test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nΓ¥î Test failed:', error.message);
    process.exit(1);
  });
