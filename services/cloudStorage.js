/**
 * cloudStorage.js
 * Uploads PDFs to Google Cloud Storage (GCS).
 *
 * GCS folder structure (auto-created, no manual work):
 *   {hodEmail}/
 *     {department}/
 *       {year}-{session}/
 *         timestamp_filename.pdf
 *
 * Required env vars:
 *   GOOGLE_SERVICE_ACCOUNT_KEY  — full JSON of service account key (one line)
 *   GCS_BUCKET_NAME             — bucket name (e.g. mits-feedback-pdfs)
 */

const { Readable } = require("stream");
const path = require("path");
const fs   = require("fs");

// ─────────────────────────────────────────────────────────────────
// Google Cloud Storage upload
// ─────────────────────────────────────────────────────────────────
async function uploadToGCS(buffer, fileName, { hodEmail, department, academicYear, session } = {}) {
  const keyRaw     = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!keyRaw || !bucketName) return null;

  try {
    const { Storage } = require("@google-cloud/storage");
    const credentials = typeof keyRaw === "string" ? JSON.parse(keyRaw) : keyRaw;
    const storage     = new Storage({ credentials });
    const bucket      = storage.bucket(bucketName);

    // Build folder path: hod_email/department/year-session/file.pdf
    const safeEmail = (hodEmail || "general").replace(/[^a-zA-Z0-9._-]/g, "_");
    const safeDept  = (department || "General").replace(/[^a-zA-Z0-9._-]/g, "_");
    const safeYear  = (academicYear || new Date().getFullYear()).toString().replace(/[^a-zA-Z0-9-]/g, "_");
    const safeSess  = (session || "session").replace(/[^a-zA-Z0-9-]/g, "_");
    const cleanFile = (fileName || "report.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectName = `${safeEmail}/${safeDept}/${safeYear}_${safeSess}/${Date.now()}_${cleanFile}`;

    const file = bucket.file(objectName);

    await new Promise((resolve, reject) => {
      const ws = file.createWriteStream({
        resumable:   false,
        contentType: "application/pdf",
        metadata:    { cacheControl: "public, max-age=31536000" }
      });
      ws.on("error", reject);
      ws.on("finish", resolve);
      Readable.from(buffer).pipe(ws);
    });

    // Make publicly readable
    await file.makePublic();

    const url = `https://storage.googleapis.com/${bucketName}/${objectName}`;
    console.log(`[GCS] Uploaded → ${url}`);
    return url;
  } catch (e) {
    console.error("[GCS] Upload failed:", e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Local fallback (only on this machine)
// ─────────────────────────────────────────────────────────────────
function saveLocally(buffer, fileName, { hodEmail, department } = {}) {
  try {
    const safeEmail = (hodEmail || "general").replace(/[^a-zA-Z0-9._-]/g, "_");
    const safeDept  = (department || "General").replace(/[^a-zA-Z0-9._-]/g, "_");
    const uploadDir = path.join(__dirname, "..", "uploads", "reports", safeEmail, safeDept);
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const cleanFile = (fileName || "report.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
    const safeName  = `${Date.now()}_${cleanFile}`;
    const localFilePath = path.join(uploadDir, safeName);
    fs.writeFileSync(localFilePath, buffer);
    const base = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`;
    const url  = `${base}/uploads/reports/${safeEmail}/${safeDept}/${safeName}`;
    return { url, localFilePath };
  } catch (e) {
    console.error("[Storage] Local save failed:", e.message);
    return { url: "", localFilePath: null };
  }
}

// ─────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────
async function uploadPdf(buffer, fileName, meta = {}) {
  // Always save a local copy for instant 100% reliable viewing
  const localRes = saveLocally(buffer, fileName, meta);

  const gcsUrl = await uploadToGCS(buffer, fileName, meta);
  if (gcsUrl) {
    return { url: gcsUrl, localFilePath: localRes.localFilePath, storage: "google_cloud_storage" };
  }

  return { url: localRes.url || "", localFilePath: localRes.localFilePath, storage: "local" };
}

module.exports = { uploadPdf, uploadToGCS, saveLocally };
