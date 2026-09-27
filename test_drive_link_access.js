/**
 * Test if service account can access Google Drive PDF links
 * Run: node test_drive_link_access.js
 */

require('dotenv').config();
const axios = require('axios');
const { google } = require('googleapis');

async function testDriveLinkAccess() {
  console.log('🔍 Testing Google Drive Link Access...\n');

  // Example Drive link (replace with your actual PDF link)
  const testLink = 'https://drive.google.com/file/d/1ABC123_YOUR_FILE_ID/view';
  
  // Extract file ID from link
  const fileIdMatch = testLink.match(/\/d\/([^\/]+)/);
  if (!fileIdMatch) {
    console.error('❌ Invalid Drive link format');
    return;
  }
  
  const fileId = fileIdMatch[1];
  console.log(`📄 File ID: ${fileId}\n`);

  // Check environment variables
  const clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_DRIVE_PRIVATE_KEY;

  if (!clientEmail || !privateKey) {
    console.error('❌ Missing GOOGLE_DRIVE_CLIENT_EMAIL or GOOGLE_DRIVE_PRIVATE_KEY');
    return;
  }

  console.log(`📧 Service Account: ${clientEmail}\n`);

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
    
    console.log('🔐 Authenticating...');
    
    // Try to get file metadata
    const fileInfo = await drive.files.get({
      fileId: fileId,
      fields: 'id, name, mimeType, size, createdTime, modifiedTime, owners, shared, permissions',
    });

    console.log('✅ File metadata access successful!\n');
    console.log('📋 File Details:');
    console.log(`   Name: ${fileInfo.data.name}`);
    console.log(`   Type: ${fileInfo.data.mimeType}`);
    console.log(`   Size: ${(fileInfo.data.size / 1024).toFixed(2)} KB`);
    console.log(`   Shared: ${fileInfo.data.shared ? 'Yes' : 'No'}\n`);

    // Try to download file content
    console.log('📥 Attempting to download file content...');
    
    const response = await drive.files.get({
      fileId: fileId,
      alt: 'media',
    }, {
      responseType: 'arraybuffer'
    });

    console.log('✅ File download successful!');
    console.log(`   Downloaded: ${(response.data.byteLength / 1024).toFixed(2)} KB\n`);

    console.log('🎉 All tests passed! Service account can access Drive links.');
    console.log('\n💡 Your AI analyzer should work correctly now.');
    
  } catch (error) {
    console.error('❌ Access failed:');
    console.error(`   Error: ${error.message}`);
    
    if (error.code === 404) {
      console.error('\n💡 File not found. Possible reasons:');
      console.error('   1. File ID is incorrect');
      console.error('   2. File was deleted');
      console.error('   3. Service account has no access');
    } else if (error.code === 403) {
      console.error('\n💡 Permission denied! Fix:');
      console.error('   1. Share the file/folder with service account email:');
      console.error(`      ${clientEmail}`);
      console.error('   2. Grant "Viewer" permission');
      console.error('   3. For folders: Share parent folder, not individual files');
    } else if (error.message.includes('private_key')) {
      console.error('\n💡 Authentication failed:');
      console.error('   Check GOOGLE_DRIVE_PRIVATE_KEY format (needs \\n characters)');
    }
  }
}

// Instructions
console.log('╔════════════════════════════════════════════════════════╗');
console.log('║   Google Drive Link Access Test                        ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

console.log('📝 To test with your actual file:');
console.log('   1. Replace testLink in this file with your PDF link');
console.log('   2. Run: node test_drive_link_access.js\n');

// Run the test
testDriveLinkAccess()
  .then(() => {
    console.log('\n✅ Test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  });
