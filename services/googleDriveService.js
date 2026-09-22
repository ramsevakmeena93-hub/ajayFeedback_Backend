const { google } = require("googleapis");
const { uploadPdf } = require("./cloudStorage");

function getOAuth2Client() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri  = process.env.GOOGLE_REDIRECT_URI || "postmessage";
  if (!clientId || !clientSecret) return null;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function getDriveClientForUser(user) {
  return { drive: null, mode: "gcs", email: user?.email || "gcs" };
}

async function ensureDriveFolder() {
  return null; // Not used with GCS
}

/**
 * Upload PDF to Google Cloud Storage, organized by HOD email and department.
 *
 * @param {Buffer} buffer      - PDF file buffer
 * @param {string} fileName    - Original filename
 * @param {object} hodUser     - HOD user object from MongoDB { email, department, ... }
 * @param {string} academicYear
 * @param {string} session
 */
async function uploadPdfToDrive({ fileName, buffer, hodUser, academicYear, session } = {}) {
  const meta = {
    hodEmail:     hodUser?.email     || "",
    department:   hodUser?.department || "General",
    academicYear: academicYear        || new Date().getFullYear().toString(),
    session:      session             || "session"
  };

  const { url, localFilePath, storage } = await uploadPdf(buffer, fileName, meta);
  console.log(`[Storage] "${storage}" | HOD: ${meta.hodEmail} | Dept: ${meta.department} → ${url}`);

  return {
    fileId:         `${storage}_${Date.now()}`,
    webViewLink:    url,
    webContentLink: url,
    localFilePath:  localFilePath || null,
    isMock:         storage === "local",
    storage
  };
}

module.exports = { getOAuth2Client, getDriveClientForUser, ensureDriveFolder, uploadPdfToDrive, listDriveFiles, getFileMetadata };

// ─────────────────────────────────────────────────────────────────────────────
// Google Drive helpers for the new Drive integration panel
// Added separately — does NOT modify any existing function above
// ─────────────────────────────────────────────────────────────────────────────

/**
 * listDriveFiles
 * Lists PDF files from the given authenticated Drive client.
 *
 * @param {object} drive        - Authenticated googleapis drive v3 client
 * @param {object} options
 * @param {string} [options.search]      - Optional filename search string
 * @param {string} [options.folderId]    - Optional folder to restrict listing
 * @param {string} [options.pageToken]   - Pagination token
 * @param {number} [options.pageSize=50] - Max results
 * @returns {Promise<{ files: object[], nextPageToken: string|null }>}
 */
async function listDriveFiles(drive, { search = '', folderId = '', pageToken = '', pageSize = 50 } = {}) {
  let q = "mimeType='application/pdf' and trashed=false";
  if (folderId) q += ` and '${folderId}' in parents`;
  if (search)   q += ` and name contains '${search.replace(/'/g, "\\'")}'`;

  const response = await drive.files.list({
    q,
    pageSize,
    pageToken:  pageToken || undefined,
    fields:     'nextPageToken, files(id, name, mimeType, webViewLink, webContentLink, createdTime, size)',
    orderBy:    'createdTime desc',
  });

  const files = (response.data.files || []).map(f => ({
    fileId:      f.id,
    name:        f.name,
    mimeType:    f.mimeType,
    driveUrl:    f.webViewLink,
    downloadUrl: f.webContentLink,
    createdTime: f.createdTime,
    size:        f.size || null,
  }));

  return { files, nextPageToken: response.data.nextPageToken || null };
}

/**
 * getFileMetadata
 * Gets full metadata for a single file by its Drive file ID.
 *
 * @param {object} drive    - Authenticated googleapis drive v3 client
 * @param {string} fileId   - Google Drive file ID
 * @returns {Promise<object>} file metadata
 */
async function getFileMetadata(drive, fileId) {
  const response = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, webViewLink, webContentLink, createdTime, size, parents, owners',
  });
  const f = response.data;
  return {
    fileId:      f.id,
    name:        f.name,
    mimeType:    f.mimeType,
    driveUrl:    f.webViewLink,
    downloadUrl: f.webContentLink,
    createdTime: f.createdTime,
    size:        f.size || null,
    owners:      (f.owners || []).map(o => o.emailAddress),
  };
}



