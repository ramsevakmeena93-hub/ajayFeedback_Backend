const express = require('express');
const router = express.Router();
const multer = require('multer');
const pLimit = require('p-limit');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');
const AdmZip = require('adm-zip');
const { parseCSV } = require('../services/csvParser');
const { analyzePDF, analyzePDFBuffer, extractMetaFromPDF, convertDriveLink } = require('../services/pdfAnalyzer');
const { getCached, setCache } = require('../services/cache');
const FacultyReport = require('../models/FacultyReport');
const User = require('../models/User');
const { authMiddleware } = require('./middleware');
const { log } = require('../services/logger');

// CSV / Excel upload: 20MB limit
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Batch upload (multiple PDFs or ZIP): up to 500MB, 500 files
// Uses memoryStorage — buffers are released after each file is processed
const batchUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024, files: 500 }
});

// PDF upload: up to 50 files, 20MB each
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 50 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  }
});

// ─── CSV / EXCEL UPLOAD — parse links, don't process yet ──────────────────
router.post('/upload-csv', authMiddleware, csvUpload.any(), async (req, res) => {
  try {
    const file = req.files && req.files.length > 0 ? req.files[0] : req.file;
    if (!file) return res.status(400).json({ error: 'No CSV or Excel file uploaded' });

    const entries = parseCSV(file.buffer);
    console.log(`[upload-csv] Parsed ${entries.length} entries from file: ${file.originalname}, size: ${file.size}`);
    if (entries.length === 0) {
      // Log first few rows to help debug
      try {
        const XLSX = require('xlsx');
        const wb = XLSX.read(file.buffer, { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const preview = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }).slice(0, 5);
        console.log('[upload-csv] First 5 rows preview:', JSON.stringify(preview));
      } catch(e) { console.log('[upload-csv] Could not preview:', e.message); }
      return res.status(400).json({ error: 'No valid PDF links found in the uploaded file. Make sure your Excel contains a column with PDF/HTTP URLs.' });
    }

    // Return just the links — don't create DB records yet
    res.json({
      message: `Found ${entries.length} PDF links`,
      links: entries, // Send full objects {pdfLink, responseCount}
      total: entries.length
    });
  } catch (err) {
    console.error('[upload-csv] Error parsing file:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── PROCESS ONE PDF by Drive link (called when HOD clicks OK) ─────────────
router.post('/process-one', authMiddleware, async (req, res) => {
  // Set longer timeout for AI processing
  req.setTimeout(120000);
  res.setTimeout(120000);
  try {
    const { pdfLink, sno } = req.body;
    if (!pdfLink) return res.status(400).json({ error: 'No PDF link provided' });

    // Check cache first
    const cacheKey = `pdf_${pdfLink}`;
    let result = getCached(cacheKey);

    if (!result) {
      // Download and analyze — retry once on rate limit
      let response;
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          response = await axios.get(convertDriveLink(pdfLink), {
            responseType: 'arraybuffer', timeout: 30000,
            headers: { 'User-Agent': 'Mozilla/5.0' }, maxRedirects: 5
          });
          break; // success
        } catch (err) {
          const status = err.response?.status;
          if (attempt < 4 && (status === 429 || status === 503)) {
            // Exponential backoff with jitter: 5s, 10s, 20s
            const delay = (5000 * attempt) + Math.random() * 2000;
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          if (status === 429) {
            throw new Error('Google Drive rate limit reached. Please wait a minute and try again.');
          }
          throw err;
        }
      }
      const buffer = Buffer.from(response.data);
      result = await analyzePDFBuffer(buffer);
      setCache(cacheKey, result);
    }

    const meta = result.meta || {};

    // Save to DB
    const report = await FacultyReport.create({
      hodId: req.user.id,
      facultyName: meta.facultyName || '',
      subjectCode: meta.subjectCode || '',
      programme: meta.programme || '',
      semester: meta.semester || '',
      pdfLink,
      driveLink: pdfLink,
      appreciation: result.appreciation,
      commentsNeedingAttention: result.commentsNeedingAttention,
      appreciationCount: result.appreciationCount,
      attentionCount: result.attentionCount,
      ffiScore: result.ffiScore ?? meta.ffiScore ?? null,
      responseCount: req.body.responseCount ?? result.responseCount ?? meta.responseCount ?? null,
      responsePercent: req.body.responsePercent ?? result.responsePercent ?? meta.responsePercent ?? null,
      registeredStudents: meta.registeredStudents ?? null,
      linkSent: meta.linkSent ?? null,
      rawStudentComments: result.rawStudentComments || [],
      commentCategories: result.commentCategories || {},
      commentPercentages: result.commentPercentages || {},
      status: 'processed',
      analyzedAt: result.analyzedAt
    });

    res.json({ report, sno });
  } catch (err) {
    console.error('[process-one] ERROR:', err.message || err);
    res.status(500).json({ error: err.message || 'Processing failed' });
  }
});

// ─── PROCESSING STATUS POLL ─────────────────────────────────────────────────
router.post('/status', authMiddleware, async (req, res) => {
  try {
    const { reportIds } = req.body;
    const reports = await FacultyReport.find({ _id: { $in: reportIds } })
      .select('facultyName subjectCode status appreciationCount attentionCount errorMessage');

    const total = reports.length;
    const processed = reports.filter(r => r.status === 'processed').length;
    const errors = reports.filter(r => r.status === 'error').length;

    res.json({ total, processed, errors, pending: total - processed - errors, reports });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SCAN PDFs — extract metadata only, no DB save ─────────────────────────
router.post('/scan-pdfs', authMiddleware, pdfUpload.array('pdfs', 50), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No PDF files provided' });
    }

    const results = await Promise.all(
      req.files.map(async (file) => {
        try {
          const meta = await extractMetaFromPDF(file.buffer);
          if (!meta.facultyName) {
            meta.facultyName = file.originalname.replace(/\.pdf$/i, '').replace(/[_\-]/g, ' ').trim();
          }
          return { filename: file.originalname, ...meta, error: null };
        } catch (err) {
          return {
            filename: file.originalname,
            facultyName: file.originalname.replace(/\.pdf$/i, '').replace(/[_\-]/g, ' ').trim(),
            subjectCode: '', programme: '', semester: '',
            error: err.message
          };
        }
      })
    );

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DIRECT PDF UPLOAD + ANALYZE ────────────────────────────────────────────
router.post('/upload-pdfs', authMiddleware, pdfUpload.array('pdfs', 50), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No PDF files uploaded' });
    }

    let metadata = [];
    try { metadata = req.body.metadata ? JSON.parse(req.body.metadata) : []; } catch {}

    const reportDocs = req.files.map((file, idx) => {
      const meta = metadata[idx] || {};
      return {
        hodId: req.user.id,
        facultyName: meta.facultyName || '',  // will be filled from PDF
        subjectCode: meta.subjectCode || '',
        programme: meta.programme || '',
        semester: meta.semester || '',
        pdfLink: `uploaded:${file.originalname}`,
        driveLink: meta.driveLink || '',
        status: 'pending'
      };
    });

    const reports = await FacultyReport.insertMany(reportDocs);

    const limit = pLimit(5);
    const processTasks = reports.map((report, idx) =>
      limit(async () => {
        const fileBuffer = req.files[idx].buffer;
        const fileName = req.files[idx].originalname;
        const cacheKey = `pdf_buf_${crypto.createHash('md5').update(fileBuffer).digest('hex')}`;
        let result = getCached(cacheKey);

        // Save locally via cloudStorage
        let storageResult = null;
        try {
          const { uploadPdf } = require('../services/cloudStorage');
          storageResult = await uploadPdf({ fileName, buffer: fileBuffer, hodUser: user, academicYear: req.body.academicYear, session: req.body.session });
        } catch (uploadErr) {
          console.warn(`[DirectUpload] Storage upload warning for ${fileName}:`, uploadErr.message);
        }

        if (!result) {
          try {
            // AI Analysis
            result = await analyzePDFBuffer(fileBuffer);
            setCache(cacheKey, result);
          } catch (err) {
            await FacultyReport.findByIdAndUpdate(report._id, {
              status: 'error',
              errorMessage: err.message,
              driveLink: storageResult?.webViewLink || report.driveLink || '',
              pdfLink: storageResult?.webViewLink || report.pdfLink || '',
              pdfFilePath: storageResult?.localFilePath || ''
            });
            return;
          }
        }

        const pdfMeta = result.meta || {};

        await FacultyReport.findByIdAndUpdate(report._id, {
          ...result,
          facultyName: pdfMeta.facultyName || report.facultyName || '',
          subjectCode: pdfMeta.subjectCode || report.subjectCode || '',
          programme: pdfMeta.programme || report.programme || '',
          semester: pdfMeta.semester || report.semester || '',
          ffiScore: result.ffiScore ?? pdfMeta.ffiScore ?? null,
          rawStudentComments: result.rawStudentComments || [],
          commentCategories: result.commentCategories || {},
          commentPercentages: result.commentPercentages || {},
          driveLink: storageResult?.webViewLink || report.driveLink || '',
          pdfLink: storageResult?.webViewLink || report.pdfLink || '',
          pdfFilePath: storageResult?.localFilePath || '',
          status: 'processed'
        });
      })
    );

    Promise.all(processTasks).catch(console.error);

    res.json({
      message: `Processing ${reports.length} PDF(s) in background`,
      reportIds: reports.map(r => r._id),
      total: reports.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── BATCH UPLOAD: PDF files or ZIP, analyzes with AI ───
router.post('/upload-batch', authMiddleware, batchUpload.any(), async (req, res) => {
  req.setTimeout(600000);
  res.setTimeout(600000);

  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No PDF or ZIP files uploaded' });
    }

    const { department, academicYear, session, feedbackFormNo } = req.body;

    // Collect all PDF files (either directly uploaded or extracted from ZIP)
    const pdfFiles = [];

    for (const file of req.files) {
      const isZip = file.mimetype === 'application/zip' ||
                    file.mimetype === 'application/x-zip-compressed' ||
                    file.originalname.toLowerCase().endsWith('.zip');

      if (isZip) {
        try {
          const zip = new AdmZip(file.buffer);
          const zipEntries = zip.getEntries();
          for (const entry of zipEntries) {
            if (!entry.isDirectory && entry.entryName.toLowerCase().endsWith('.pdf')) {
              if (!entry.entryName.includes('__MACOSX') && !path.basename(entry.entryName).startsWith('._')) {
                pdfFiles.push({
                  originalname: path.basename(entry.entryName),
                  buffer: entry.getData()
                });
              }
            }
          }
          // Release ZIP buffer from memory immediately after extraction
          file.buffer = null;
        } catch (zipErr) {
          console.error('[UploadBatch] Failed to parse ZIP:', zipErr.message);
          return res.status(400).json({ error: `Failed to extract ZIP: ${zipErr.message}` });
        }
      } else if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
        pdfFiles.push({
          originalname: file.originalname,
          buffer: file.buffer
        });
      }
    }

    if (pdfFiles.length === 0) {
      return res.status(400).json({ error: 'No valid PDF files found in the upload' });
    }

    const user = await User.findById(req.user.id);

    // Process each PDF file concurrently (limit: 3 concurrent to control RAM usage)
    const limit = pLimit(3);
    const results = [];
    const errors = [];

    const tasks = pdfFiles.map((file) =>
      limit(async () => {
        try {
          // 0. Split multi-faculty PDF into individual slices first
          const { splitPdfByFaculty } = require('../services/pdfSliceService');
          const facultySlices = await splitPdfByFaculty(file.buffer);

          for (const slice of facultySlices) {
            const sliceBuffer = slice.buffer;
            const sliceName   = slice.facultyName
              ? `${slice.facultyName.replace(/\s+/g, '_')}_${file.originalname}`
              : file.originalname;

          // 1. Save PDF locally via cloudStorage
          const { uploadPdf } = require('../services/cloudStorage');
          const driveResult = await uploadPdf({
            fileName: sliceName,
            buffer:   sliceBuffer,
            hodUser:  user,
            academicYear,
            session
          });

          // 2. Analyze PDF buffer in-memory with AI & Regex parser
          let analysis = null;
          try {
            analysis = await analyzePDFBuffer(file.buffer);
          } catch (aiErr) {
            console.warn(`[UploadBatch] AI analysis failed for ${file.originalname}:`, aiErr.message);
            const meta = await extractMetaFromPDF(file.buffer).catch(() => ({}));
            analysis = {
              meta,
              appreciation: [],
              commentsNeedingAttention: [],
              appreciationCount: 0,
              attentionCount: 0,
              ffiScore: meta.ffiScore || null,
              responseCount: meta.responseCount || null
            };
          }

          // Release buffer from memory as early as possible
          file.buffer = null;

          const pdfMeta = analysis.meta || {};
          const detectedFacultyName = pdfMeta.facultyName || file.originalname.replace(/\.pdf$/i, '').replace(/[_\-]/g, ' ').trim();

          // 3. Auto-match faculty to User in MongoDB
          let facultyUserId = null;
          if (detectedFacultyName) {
            let matchedUser = await User.findOne({
              name: { $regex: new RegExp(`^${detectedFacultyName.trim()}$`, 'i') }
            });

            if (!matchedUser) {
              const strippedName = detectedFacultyName.replace(/^(Dr\.|Prof\.|Mr\.|Ms\.|Mrs\.)\s+/i, '').trim();
              matchedUser = await User.findOne({
                name: { $regex: new RegExp(strippedName, 'i') }
              });
            }

            if (matchedUser) {
              facultyUserId = matchedUser._id;
            }
          }

          // 4. Save FacultyReport to MongoDB
          const report = await FacultyReport.create({
            hodId: req.user.id,
            facultyUserId,
            facultyName: detectedFacultyName,
            subjectCode: pdfMeta.subjectCode || '',
            programme: pdfMeta.programme || '',
            semester: pdfMeta.semester || '',
            branch: pdfMeta.branch || department || user?.department || '',
            section: pdfMeta.section || '',
            academicYear: academicYear || new Date().getFullYear().toString(),
            pdfLink: driveResult.webViewLink,
            driveLink: driveResult.webViewLink,
            pdfFilePath: driveResult.localFilePath || '',
            appreciation: analysis.appreciation || [],
            commentsNeedingAttention: analysis.commentsNeedingAttention || [],
            appreciationCount: analysis.appreciationCount || 0,
            attentionCount: analysis.attentionCount || 0,
            ffiScore: analysis.ffiScore ?? pdfMeta.ffiScore ?? null,
            responseCount: analysis.responseCount ?? pdfMeta.responseCount ?? null,
            responsePercent: analysis.responsePercent ?? pdfMeta.responsePercent ?? null,
            registeredStudents: analysis.registeredStudents ?? pdfMeta.registeredStudents ?? null,
            linkSent: analysis.linkSent ?? pdfMeta.linkSent ?? null,
            rawStudentComments: analysis.rawStudentComments || [],
            commentCategories: analysis.commentCategories || {},
            commentPercentages: analysis.commentPercentages || {},
            hodRemarks: `Session: ${session || ''} | Form: ${feedbackFormNo || ''}`,
            status: 'processed',
            analyzedAt: new Date()
          });

          results.push({
            reportId: report._id,
            fileName: file.originalname,
            facultyName: detectedFacultyName,
            matched: !!facultyUserId,
            subjectCode: pdfMeta.subjectCode || '',
            driveLink: driveResult.webViewLink,
            status: 'success'
          });
        } catch (fileErr) {
          console.error(`[UploadBatch] Error processing ${file.originalname}:`, fileErr.message);
          errors.push({
            fileName: file.originalname,
            error: fileErr.message
          });
        }
      })
    );

    await Promise.all(tasks);

    res.json({
      message: `Processed ${results.length} of ${pdfFiles.length} file(s) successfully`,
      total: pdfFiles.length,
      successful: results.length,
      failed: errors.length,
      results,
      errors
    });
  } catch (err) {
    console.error('[UploadBatch] Fatal error:', err.message);
    res.status(500).json({ error: err.message || 'Batch upload failed' });
  }
});

module.exports = router;
