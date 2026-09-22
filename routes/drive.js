/**
 * routes/drive.js
 *
 * Google Drive integration using Service Account.
 * No HOD OAuth needed — backend connects directly to shared folder.
 *
 * Endpoints:
 *   GET  /api/drive/status          → service account connected?
 *   GET  /api/drive/folder-files    → list files from shared Drive folder
 *   POST /api/drive/save-links      → save selected file metadata to DriveFile DB
 *   GET  /api/drive/saved-files     → get saved Drive file links for this HOD
 *   POST /api/drive/sync-to-reports → match Drive files to FacultyReport by name, save driveLink
 *
 * Legacy OAuth endpoints kept for backward compat (not used by new panel):
 *   GET  /api/drive/auth-url
 *   GET  /api/drive/callback
 *   GET  /api/drive/files
 *   POST /api/drive/disconnect
 */

const express = require('express');
const router  = express.Router();
const { google } = require('googleapis');
const User            = require('../models/User');
const DriveFile       = require('../models/DriveFile');
const FacultyReport   = require('../models/FacultyReport');
const { authMiddleware, requireAnyRole } = require('./middleware');
const { listSharedFolderFiles, getServiceAccountDrive } = require('../services/googleDriveService');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/drive/status
// Returns whether the service account is configured + folder ID exists.
// HODs no longer need to individually connect — service account handles it.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/status', authMiddleware, requireAnyRole('hod'), async (req, res) => {
  try {
    const drive    = getServiceAccountDrive();
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    const connected = !!(drive && folderId);

    res.json({
      connected,
      mode:      'service_account',
      email:     'mits-feedback-drive@feedbackmanagement-509215.iam.gserviceaccount.com',
      folderId:  folderId || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/drive/folder-files?search=&pageToken=
// Lists ALL files from the shared MITS_Feedback_Reports Drive folder.
// Uses service account — no HOD login needed.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/folder-files', authMiddleware, requireAnyRole('hod'), async (req, res) => {
  try {
    const { search = '', pageToken = '' } = req.query;
    const result = await listSharedFolderFiles({ search, pageToken, pageSize: 100 });

    if (result.error) {
      return res.status(500).json({ error: result.error });
    }

    res.json({
      files:         result.files,
      nextPageToken: result.nextPageToken,
      total:         result.files.length,
    });
  } catch (err) {
    console.error('[Drive] folder-files error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/drive/save-links
// Body: { files: [{ fileId, name, mimeType, driveUrl }] }
// Saves Drive file metadata to DriveFile collection in MongoDB.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/save-links', authMiddleware, requireAnyRole('hod'), async (req, res) => {
  try {
    const { files } = req.body;
    if (!files?.length) return res.status(400).json({ error: 'No files provided' });

    const saved = [];
    for (const f of files) {
      if (!f.fileId || !f.driveUrl) continue;
      const doc = await DriveFile.findOneAndUpdate(
        { hodId: req.user.id, googleDriveFileId: f.fileId },
        {
          hodId:             req.user.id,
          googleDriveFileId: f.fileId,
          fileName:          f.name     || 'Untitled',
          mimeType:          f.mimeType || 'application/pdf',
          googleDriveUrl:    f.driveUrl,
          googleAccountId:   'service_account',
          savedAt:           new Date(),
        },
        { upsert: true, new: true }
      );
      if (doc) saved.push(doc);
    }

    res.json({ saved: saved.length, files: saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/drive/saved-files
// Returns previously saved Drive file links for this HOD.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/saved-files', authMiddleware, requireAnyRole('hod'), async (req, res) => {
  try {
    const files = await DriveFile.find({ hodId: req.user.id })
      .sort({ savedAt: -1 })
      .lean();
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/drive/sync-to-reports
// Auto-matches Drive files to FacultyReport records by faculty name.
// Saves googleDriveUrl into FacultyReport.driveLink for matched reports.
//
// Body: { files: [{ fileId, name, driveUrl }] }  ← from folder-files list
// Returns: { matched, unmatched, total }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sync-to-reports', authMiddleware, requireAnyRole('hod'), async (req, res) => {
  try {
    const { files } = req.body;
    if (!files?.length) return res.status(400).json({ error: 'No files provided' });

    // Load all reports for this HOD
    const reports = await FacultyReport.find({ hodId: req.user.id }).lean();

    const matched   = [];
    const unmatched = [];

    for (const file of files) {
      const fileName = (file.name || '').toLowerCase().replace(/\.pdf$/i, '').replace(/[_\-\s]+/g, ' ').trim();
      if (!fileName) continue;

      // Try to match by faculty name inside the file name
      let bestReport = null;
      let bestScore  = 0;

      for (const report of reports) {
        const facultyName = (report.facultyName || '').toLowerCase().replace(/[_\-\s]+/g, ' ').trim();
        if (!facultyName) continue;

        // Strip titles
        const cleanFaculty = facultyName.replace(/^(dr\.|prof\.|mr\.|ms\.|mrs\.)\s*/i, '').trim();
        const firstName    = cleanFaculty.split(' ')[0];

        // Score: exact name match > first name match > subject code match
        let score = 0;
        if (fileName.includes(cleanFaculty)) score = 3;
        else if (fileName.includes(firstName) && firstName.length > 2) score = 2;

        // Also try subject code match
        const subjectCode = (report.subjectCode || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const cleanFile   = fileName.replace(/[^a-z0-9]/g, '');
        if (subjectCode && cleanFile.includes(subjectCode)) score += 1;

        if (score > bestScore) {
          bestScore  = score;
          bestReport = report;
        }
      }

      if (bestReport && bestScore >= 2) {
        // Save driveLink into FacultyReport
        await FacultyReport.findByIdAndUpdate(bestReport._id, {
          driveLink: file.driveUrl,
          pdfLink:   file.driveUrl,
        });

        // Also save to DriveFile collection
        await DriveFile.findOneAndUpdate(
          { hodId: req.user.id, googleDriveFileId: file.fileId },
          {
            hodId:             req.user.id,
            googleDriveFileId: file.fileId,
            fileName:          file.name,
            mimeType:          file.mimeType || 'application/pdf',
            googleDriveUrl:    file.driveUrl,
            applicationId:     bestReport._id,
            googleAccountId:   'service_account',
            savedAt:           new Date(),
          },
          { upsert: true, new: true }
        );

        matched.push({
          fileName:    file.name,
          driveUrl:    file.driveUrl,
          facultyName: bestReport.facultyName,
          reportId:    bestReport._id,
          score:       bestScore,
        });
      } else {
        unmatched.push({ fileName: file.name, driveUrl: file.driveUrl });
      }
    }

    console.log(`[Drive] Sync: ${matched.length} matched, ${unmatched.length} unmatched`);
    res.json({
      matched:   matched.length,
      unmatched: unmatched.length,
      total:     files.length,
      details:   { matched, unmatched },
    });
  } catch (err) {
    console.error('[Drive] sync-to-reports error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/drive/test — debug endpoint to check service account status
// ─────────────────────────────────────────────────────────────────────────────
router.get('/test', authMiddleware, requireAnyRole('hod'), async (req, res) => {
  try {
    const keyRaw   = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    if (!keyRaw) return res.json({ ok: false, error: 'GOOGLE_SERVICE_ACCOUNT_KEY not set in Render' });
    if (!folderId) return res.json({ ok: false, error: 'GOOGLE_DRIVE_FOLDER_ID not set in Render' });

    // Try to parse the key
    let credentials;
    try {
      let k = keyRaw.trim();
      credentials = JSON.parse(k);
    } catch (e1) {
      // Try replacing literal \n with actual newlines
      try {
        let k = keyRaw.trim().replace(/\\n/g, '\n');
        credentials = JSON.parse(k);
      } catch (e2) {
        return res.json({ ok: false, error: `JSON parse failed: ${e2.message}`, keyLength: keyRaw.length, keyStart: keyRaw.substring(0, 30) });
      }
    }

    // Try to connect
    const drive = getServiceAccountDrive();
    if (!drive) return res.json({ ok: false, error: 'Drive client failed to initialize', clientEmail: credentials?.client_email });

    // Try to list files
    const result = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      pageSize: 1,
      fields: 'files(id, name)',
    });

    res.json({
      ok: true,
      clientEmail: credentials?.client_email,
      folderId,
      filesFound: result.data.files?.length ?? 0,
      firstFile: result.data.files?.[0]?.name || 'none',
    });
  } catch (err) {
    res.json({ ok: false, error: err.message, code: err.code });
  }
});

function makeOAuth2Client() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri  = process.env.GOOGLE_DRIVE_REDIRECT_URI
                    || process.env.GOOGLE_REDIRECT_URI
                    || 'http://localhost:5000/api/drive/callback';
  if (!clientId || !clientSecret) throw new Error('Google OAuth not configured');
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

router.get('/auth-url', authMiddleware, requireAnyRole('hod'), (req, res) => {
  try {
    const oauth2 = makeOAuth2Client();
    const url = oauth2.generateAuthUrl({
      access_type: 'offline', prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/drive.metadata.readonly', 'https://www.googleapis.com/auth/userinfo.email'],
      state: req.user.id,
    });
    res.json({ url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/callback', async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const { code, state: userId, error } = req.query;
  if (error) return res.redirect(`${frontendUrl}/hod?drive_error=${encodeURIComponent(error)}`);
  if (!code || !userId) return res.redirect(`${frontendUrl}/hod?drive_error=missing_code`);
  try {
    const oauth2 = makeOAuth2Client();
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);
    let driveEmail = '';
    try { const o2 = google.oauth2({ version: 'v2', auth: oauth2 }); const { data } = await o2.userinfo.get(); driveEmail = data.email || ''; } catch {}
    await User.findByIdAndUpdate(userId, { googleDriveRefreshToken: tokens.refresh_token || '', googleDriveAccessToken: tokens.access_token || '', googleDriveConnected: true, googleDriveEmail: driveEmail });
    res.redirect(`${frontendUrl}/hod?drive_connected=1`);
  } catch (err) { res.redirect(`${frontendUrl}/hod?drive_error=${encodeURIComponent(err.message)}`); }
});

router.get('/files', authMiddleware, requireAnyRole('hod'), async (req, res) => {
  res.json({ files: [], message: 'Use /api/drive/folder-files instead (service account mode)' });
});

router.post('/disconnect', authMiddleware, requireAnyRole('hod'), async (req, res) => {
  await User.findByIdAndUpdate(req.user.id, { googleDriveRefreshToken: '', googleDriveAccessToken: '', googleDriveConnected: false, googleDriveEmail: '' });
  res.json({ success: true });
});

module.exports = router;
