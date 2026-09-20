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

module.exports = { getOAuth2Client, getDriveClientForUser, ensureDriveFolder, uploadPdfToDrive };
