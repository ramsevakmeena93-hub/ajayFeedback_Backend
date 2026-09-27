/**
 * Test Google Drive Access
 * 
 * This script tests if the service account can access the MITS feedback folder.
 * Run: node test_drive_access.js
 */

require('dotenv').config();
const { google } = require('googleapis');

async function testDriveAccess() {
  console.log('🔍 Testing Google Drive Access...\n');

  // Check environment variables
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_DRIVE_PRIVATE_KEY;

  if (!folderId) {
    console.error('❌ GOOGLE_DRIVE_FOLDER_ID is not set');
    return;
  }

  if (!clientEmail) {
    console.error('❌ GOOGLE_DRIVE_CLIENT_EMAIL is not set');
    return;
  }

  if (!privateKey) {
    console.error('❌ GOOGLE_DRIVE_PRIVATE_KEY is not set');
    return;
  }

  console.log('✅ Environment variables found');
  console.log(`📁 Folder ID: ${folderId}`);
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
    
    // List files in folder
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, mimeType, createdTime, modifiedTime, size)',
      orderBy: 'modifiedTime desc',
    });

    console.log('✅ Drive access successful!\n');
    
    const files = response.data.files;
    
    if (files.length === 0) {
      console.log('📂 Folder is empty (no files found)');
    } else {
      console.log(`📂 Found ${files.length} file(s):\n`);
      
      files.forEach((file, index) => {
        const size = file.size ? `${(file.size / 1024).toFixed(2)} KB` : 'N/A';
        const created = new Date(file.createdTime).toLocaleString();
        
        console.log(`${index + 1}. ${file.name}`);
        console.log(`   Type: ${file.mimeType}`);
        console.log(`   Size: ${size}`);
        console.log(`   Created: ${created}`);
        console.log(`   ID: ${file.id}\n`);
      });
    }

    // Test folder metadata access
    console.log('📋 Testing folder metadata access...');
    const folderInfo = await drive.files.get({
      fileId: folderId,
      fields: 'id, name, permissions, shared, owners',
    });

    console.log('✅ Folder metadata access successful!');
    console.log(`📁 Folder Name: ${folderInfo.data.name}`);
    console.log(`🔓 Shared: ${folderInfo.data.shared ? 'Yes' : 'No'}\n`);

    console.log('🎉 All tests passed! Service account can access the folder.');
    
  } catch (error) {
    console.error('❌ Drive access failed:');
    console.error(`Error: ${error.message}`);
    
    if (error.code === 404) {
      console.error('\n💡 Suggestion: Check if the folder ID is correct and the service account has access.');
    } else if (error.code === 403) {
      console.error('\n💡 Suggestion: Share the folder with the service account email:');
      console.error(`   ${clientEmail}`);
    } else if (error.message.includes('private_key')) {
      console.error('\n💡 Suggestion: Check if GOOGLE_DRIVE_PRIVATE_KEY is properly formatted with \\n characters.');
    }
  }
}

// Run the test
testDriveAccess()
  .then(() => {
    console.log('\n✅ Test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  });
