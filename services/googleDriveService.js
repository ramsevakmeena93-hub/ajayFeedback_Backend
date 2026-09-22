/**
 * googleDriveService.js
 *
 * Handles ALL Google Drive operations using a Service Account.
 * No HOD OAuth needed — backend connects directly using credentials.
 *
 * Required env vars:
 *   GOOGLE_SERVICE_ACCOUNT_KEY  — full service account JSON as one line
 *   GOOGLE_DRIVE_FOLDER_ID      — shared Drive folder ID
 */

const { google } = require("googleapis");
const { Readable } = require("stream");

// ─── Service Account Drive client (singleton) ────────────────────────────────
let _driveClient = null;

function getServiceAccountDrive() {
  if (_driveClient) return _driveClient;

  let keyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyRaw) {
    console.warn("[Drive] GOOGLE_SERVICE_ACCOUNT_KEY not set — Drive upload disabled");
    return null;
  }

  try {
    // Handle both single-line and multi-line JSON
    keyRaw = keyRaw.trim();
    // Fix common issue: actual newlines in private_key replaced with \n
    const credentials = JSON.parse(keyRaw);
    if (credentials.private_key) {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
    _driveClient = google.drive({ version: "v3", auth });
    console.log("[Drive] Service account client ready");
    return _driveClient;
  } catch (e) {
    console.error("[Drive] Failed to init service account:", e.message);
    return null;
  }
}

// ─── OAuth2 client (kept for login flow) ─────────────────────────────────────
function getOAuth2Client() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri  = process.env.GOOGLE_REDIRECT_URI || "postmessage";
  if (!clientId || !clientSecret) return null;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function getDriveClientForUser(user) {
  return { drive: null, mode: "service_account", email: user?.email || "" };
}

async function ensureDriveFolder() {
  return null;
}

// ─── Upload PDF to Google Drive using Service Account ────────────────────────
/**
 * Uploads a PDF buffer to the shared Google Drive folder.
 * Folder structure: MITS_Feedback_Reports / HOD_email / department / year-session / file.pdf
 *
 * @returns {{ webViewLink, fileId, storage }}
 */
async function uploadPdfToDrive({ fileName, buffer, hodUser, academicYear, session } = {}) {
  const drive    = getServiceAccountDrive();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  // ── Fallback to GCS / local if service account not configured ───────────
  if (!drive || !folderId) {
    const { uploadPdf } = require("./cloudStorage");
    const meta = {
      hodEmail:     hodUser?.email      || "",
      department:   hodUser?.department  || "General",
      academicYear: academicYear         || new Date().getFullYear().toString(),
      session:      session              || "session",
    };
    const { url, localFilePath, storage } = await uploadPdf(buffer, fileName, meta);
    console.log(`[Storage] fallback "${storage}" → ${url}`);
    return { fileId: `${storage}_${Date.now()}`, webViewLink: url, webContentLink: url, localFilePath, storage };
  }

  try {
    // Build sub-folder path inside the shared folder
    const safeEmail = (hodUser?.email      || "general").replace(/[^a-zA-Z0-9._-]/g, "_");
    const safeDept  = (hodUser?.department || "General").replace(/[^a-zA-Z0-9._-]/g, "_");
    const safeYear  = (academicYear        || new Date().getFullYear().toString()).replace(/[^a-zA-Z0-9-]/g, "_");
    const safeSess  = (session             || "session").replace(/[^a-zA-Z0-9-]/g, "_");
    const subFolderName = `${safeEmail}__${safeDept}__${safeYear}_${safeSess}`;

    // Find or create sub-folder
    let subFolderId = await findOrCreateFolder(drive, subFolderName, folderId);

    // Upload file
    const cleanName = (fileName || "report.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
    const uploadName = `${Date.now()}_${cleanName}`;

    const response = await drive.files.create({
      requestBody: {
        name:    uploadName,
        parents: [subFolderId],
        mimeType: "application/pdf",
      },
      media: {
        mimeType: "application/pdf",
        body:     Readable.from(buffer),
      },
      fields: "id, webViewLink, webContentLink, name",
    });

    const file = response.data;

    // Make file publicly readable (so anyone with link can view)
    await drive.permissions.create({
      fileId:      file.id,
      requestBody: { role: "reader", type: "anyone" },
    });

    const webViewLink = `https://drive.google.com/file/d/${file.id}/view`;
    console.log(`[Drive] Uploaded "${uploadName}" → ${webViewLink}`);

    return {
      fileId:         file.id,
      webViewLink,
      webContentLink: file.webContentLink || webViewLink,
      localFilePath:  null,
      storage:        "google_drive",
    };
  } catch (err) {
    console.error("[Drive] Upload failed:", err.message);
    // Fallback to local
    const { saveLocally } = require("./cloudStorage");
    const res = saveLocally(buffer, fileName, { hodEmail: hodUser?.email, department: hodUser?.department });
    return { fileId: `local_${Date.now()}`, webViewLink: res.url, webContentLink: res.url, localFilePath: res.localFilePath, storage: "local" };
  }
}

// ─── Find or create a folder inside a parent folder ──────────────────────────
async function findOrCreateFolder(drive, name, parentId) {
  try {
    const safeName = name.replace(/'/g, "\\'");
    const res = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name='${safeName}' and '${parentId}' in parents and trashed=false`,
      fields: "files(id, name)",
      pageSize: 1,
    });
    if (res.data.files?.length > 0) return res.data.files[0].id;

    // Create it
    const created = await drive.files.create({
      requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
      fields: "id",
    });
    return created.data.id;
  } catch (e) {
    console.warn("[Drive] findOrCreateFolder failed:", e.message);
    return parentId; // fallback to root folder
  }
}

// ─── List files from shared Drive folder ─────────────────────────────────────
async function listSharedFolderFiles({ search = "", pageToken = "", pageSize = 50 } = {}) {
  const drive    = getServiceAccountDrive();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!drive || !folderId) return { files: [], nextPageToken: null, error: "Service account not configured" };

  try {
    let q = `'${folderId}' in parents and trashed=false`;
    if (search) q += ` and name contains '${search.replace(/'/g, "\\'")}'`;

    const res = await drive.files.list({
      q,
      pageSize,
      pageToken: pageToken || undefined,
      fields:    "nextPageToken, files(id, name, mimeType, webViewLink, createdTime, size, parents)",
      orderBy:   "createdTime desc",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });

    const files = (res.data.files || []).map(f => ({
      fileId:      f.id,
      name:        f.name,
      mimeType:    f.mimeType,
      driveUrl:    f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
      createdTime: f.createdTime,
      size:        f.size || null,
      isFolder:    f.mimeType === "application/vnd.google-apps.folder",
    }));

    return { files, nextPageToken: res.data.nextPageToken || null };
  } catch (e) {
    console.error("[Drive] listSharedFolderFiles error:", e.message);
    return { files: [], nextPageToken: null, error: e.message };
  }
}

// ─── List Drive files (legacy helper used by drive.js route) ─────────────────
async function listDriveFiles(drive, { search = "", folderId = "", pageToken = "", pageSize = 50 } = {}) {
  let q = "mimeType='application/pdf' and trashed=false";
  if (folderId) q += ` and '${folderId}' in parents`;
  if (search)   q += ` and name contains '${search.replace(/'/g, "\\'")}'`;

  const response = await drive.files.list({
    q, pageSize,
    pageToken: pageToken || undefined,
    fields: "nextPageToken, files(id, name, mimeType, webViewLink, webContentLink, createdTime, size)",
    orderBy: "createdTime desc",
  });

  const files = (response.data.files || []).map(f => ({
    fileId: f.id, name: f.name, mimeType: f.mimeType,
    driveUrl: f.webViewLink, downloadUrl: f.webContentLink,
    createdTime: f.createdTime, size: f.size || null,
  }));

  return { files, nextPageToken: response.data.nextPageToken || null };
}

async function getFileMetadata(drive, fileId) {
  const response = await drive.files.get({
    fileId,
    fields: "id, name, mimeType, webViewLink, webContentLink, createdTime, size, parents, owners",
  });
  const f = response.data;
  return {
    fileId: f.id, name: f.name, mimeType: f.mimeType,
    driveUrl: f.webViewLink, downloadUrl: f.webContentLink,
    createdTime: f.createdTime, size: f.size || null,
    owners: (f.owners || []).map(o => o.emailAddress),
  };
}

module.exports = {
  getOAuth2Client,
  getDriveClientForUser,
  ensureDriveFolder,
  uploadPdfToDrive,
  listDriveFiles,
  listSharedFolderFiles,
  getFileMetadata,
  getServiceAccountDrive,
};
