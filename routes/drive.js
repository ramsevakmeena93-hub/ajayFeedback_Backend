/**
 * routes/drive.js
 *
 * Google Drive integration — completely separate from existing upload workflow.
 * Does NOT touch any existing routes or models.
 *
 * Endpoints:
 *   GET  /api/drive/auth-url          → generate OAuth consent URL for this HOD
 *   GET  /api/drive/callback           → exchange auth code, save tokens, redirect to frontend
 *   GET  /api/drive/status             → is this HOD connected?
 *   GET  /api/drive/files              → list files from HOD's Drive
 *   POST /api/drive/save-links         → save selected Drive file metadata to DB
 *   GET  /api/drive/saved-files        → get previously saved Drive file links
 *   POST /api/drive/disconnect         → revoke and clear tokens
 */

const express = require('express');
const router  = express.Router();
const { google } = require('googleapis');
const User         = require('../models/User');
const DriveFile    = require('../models/DriveFile');
const { authMiddleware, requireAnyRole } = require('./middleware');

// ─── OAuth2 client factory ───────────────────────────────────────────────────

function makeOAuth2Client() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri  = process.env.GOOGLE_DRIVE_REDIRECT_URI
                    || process.env.GOOGLE_REDIRECT_URI
                    || 'http://localhost:5000/api/drive/callback';

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in environment variables');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// ─── Scopes — minimum required (read-only Drive access) ─────────────────────
const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

// ─── Helper: get authenticated Drive client for a user ──────────────────────
async function getDriveClient(userId) {
  const user = await User.findById(userId).select(
    'googleDriveRefreshToken googleDriveAccessToken googleDriveConnected googleDriveEmail'
  );
  if (!user || !user.googleDriveConnected || !user.googleDriveRefreshToken) {
    throw new Error('Google Drive not connected. Please connect your Google Drive first.');
  }

  const oauth2 = makeOAuth2Client();
  oauth2.setCredentials({
    refresh_token: user.googleDriveRefreshToken,
    access_token:  user.googleDriveAccessToken || undefined,
  });

  // Auto-refresh access token when expired
  oauth2.on('tokens', async (tokens) => {
    const update = {};
    if (tokens.access_token)  update.googleDriveAccessToken  = tokens.access_token;
    if (tokens.refresh_token) update.googleDriveRefreshToken = tokens.refresh_token;
    if (Object.keys(update).length > 0) {
      await User.findByIdAndUpdate(userId, update);
    }
  });

  return google.drive({ version: 'v3', auth: oauth2 });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/drive/auth-url
// Returns the Google OAuth consent page URL for this HOD.
// Frontend opens this URL in a new window/tab to start auth flow.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/auth-url', authMiddleware, requireAnyRole('hod'), (req, res) => {
  try {
    const oauth2 = makeOAuth2Client();
    const url = oauth2.generateAuthUrl({
      access_type:  'offline',   // get refresh_token
      prompt:       'consent',   // always show consent screen so refresh_token is returned
      scope:        DRIVE_SCOPES,
      state:        req.user.id, // pass HOD's userId through OAuth flow
    });
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/drive/callback
// Google redirects here after HOD approves permissions.
// Exchanges auth code for tokens, saves to DB, redirects HOD back to frontend.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/callback', async (req, res) => {
  const { code, state: userId, error } = req.query;

  // Determine frontend base URL for redirect
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (error) {
    console.error('[Drive] OAuth error:', error);
    return res.redirect(`${frontendUrl}/hod?drive_error=${encodeURIComponent(error)}`);
  }

  if (!code || !userId) {
    return res.redirect(`${frontendUrl}/hod?drive_error=missing_code`);
  }

  try {
    const oauth2 = makeOAuth2Client();

    // Exchange auth code for tokens
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);

    // Get the Google account email for display
    let driveEmail = '';
    try {
      const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2 });
      const { data } = await oauth2Api.userinfo.get();
      driveEmail = data.email || '';
    } catch {}

    // Save tokens to User in MongoDB
    await User.findByIdAndUpdate(userId, {
      googleDriveRefreshToken: tokens.refresh_token || '',
      googleDriveAccessToken:  tokens.access_token  || '',
      googleDriveConnected:    true,
      googleDriveEmail:        driveEmail,
    });

    console.log(`[Drive] Connected for user ${userId} (${driveEmail})`);

    // Redirect back to HOD dashboard with success flag
    res.redirect(`${frontendUrl}/hod?drive_connected=1`);
  } catch (err) {
    console.error('[Drive] Callback error:', err.message);
    res.redirect(`${frontendUrl}/hod?drive_error=${encodeURIComponent(err.message)}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/drive/status
// Returns connection status for this HOD.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/status', authMiddleware, requireAnyRole('hod'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('googleDriveConnected googleDriveEmail');
    res.json({
      connected: !!user?.googleDriveConnected,
      email:     user?.googleDriveEmail || '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/drive/files?pageToken=&search=&folderId=
// Lists PDF files from the HOD's connected Google Drive.
// Returns: id, name, mimeType, webViewLink, createdTime, size
// ─────────────────────────────────────────────────────────────────────────────
router.get('/files', authMiddleware, requireAnyRole('hod'), async (req, res) => {
  try {
    const drive = await getDriveClient(req.user.id);
    const { pageToken, search, folderId } = req.query;

    // Build query — only PDFs, not trashed
    let q = "mimeType='application/pdf' and trashed=false";
    if (folderId) q += ` and '${folderId}' in parents`;
    if (search)   q += ` and name contains '${search.replace(/'/g, "\\'")}'`;

    const response = await drive.files.list({
      q,
      pageSize:  50,
      pageToken: pageToken || undefined,
      fields:    'nextPageToken, files(id, name, mimeType, webViewLink, webContentLink, createdTime, size, parents)',
      orderBy:   'createdTime desc',
    });

    const files = (response.data.files || []).map(f => ({
      fileId:       f.id,
      name:         f.name,
      mimeType:     f.mimeType,
      driveUrl:     f.webViewLink,
      downloadUrl:  f.webContentLink,
      createdTime:  f.createdTime,
      size:         f.size,
      parents:      f.parents || [],
    }));

    res.json({
      files,
      nextPageToken: response.data.nextPageToken || null,
      total: files.length,
    });
  } catch (err) {
    console.error('[Drive] List files error:', err.message);

    // Detect token revocation
    if (err.message?.includes('invalid_grant') || err.code === 401) {
      await User.findByIdAndUpdate(req.user.id, {
        googleDriveConnected:    false,
        googleDriveRefreshToken: '',
        googleDriveAccessToken:  '',
      });
      return res.status(401).json({
        error: 'Google Drive authorization expired or revoked. Please reconnect.',
        needsReconnect: true,
      });
    }

    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/drive/save-links
// Body: { files: [{ fileId, name, mimeType, driveUrl }] }
// Saves Drive file metadata to DriveFile collection.
// Does NOT modify FacultyReport or any other existing collection.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/save-links', authMiddleware, requireAnyRole('hod'), async (req, res) => {
  try {
    const { files } = req.body;
    if (!files?.length) return res.status(400).json({ error: 'No files provided' });

    const saved = [];
    const skipped = [];

    for (const f of files) {
      if (!f.fileId || !f.driveUrl) continue;

      // Upsert — update if already saved, insert if new
      const doc = await DriveFile.findOneAndUpdate(
        { hodId: req.user.id, googleDriveFileId: f.fileId },
        {
          hodId:             req.user.id,
          googleDriveFileId: f.fileId,
          fileName:          f.name || 'Untitled',
          mimeType:          f.mimeType || 'application/pdf',
          googleDriveUrl:    f.driveUrl,
          googleAccountId:   req.user.email || '',
          savedAt:           new Date(),
        },
        { upsert: true, new: true }
      );

      if (doc) saved.push(doc);
    }

    res.json({ saved: saved.length, skipped: skipped.length, files: saved });
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
// POST /api/drive/disconnect
// Revoke Google Drive access and clear tokens from DB.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/disconnect', authMiddleware, requireAnyRole('hod'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('googleDriveRefreshToken');

    // Attempt to revoke the token at Google
    if (user?.googleDriveRefreshToken) {
      try {
        const oauth2 = makeOAuth2Client();
        oauth2.setCredentials({ refresh_token: user.googleDriveRefreshToken });
        await oauth2.revokeCredentials();
      } catch {} // ignore revocation errors — clear locally regardless
    }

    await User.findByIdAndUpdate(req.user.id, {
      googleDriveRefreshToken: '',
      googleDriveAccessToken:  '',
      googleDriveConnected:    false,
      googleDriveEmail:        '',
    });

    res.json({ success: true, message: 'Google Drive disconnected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
