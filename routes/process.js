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

    console.log(`[upload-csv] Received file: ${file.originalname}, size: ${file.size} bytes, mimetype: ${file.mimetype}`);
    
    // Generate file hash to detect duplicates
    const fileHash = crypto.createHash('md5').update(file.buffer).digest('hex');
    console.log(`[upload-csv] File hash: ${fileHash}`);
    
    // Check if this exact file has been uploaded before by this HOD
    const existingReport = await FacultyReport.findOne({
      hodId: req.user.id,
      fileHash: fileHash
    });
    
    if (existingReport) {
      console.log(`[upload-csv] Duplicate file detected. Hash: ${fileHash}`);
      return res.status(409).json({ 
        error: 'Duplicate file detected',
        message: `This CSV file has already been uploaded on ${new Date(existingReport.createdAt).toLocaleDateString('en-IN', { 
          day: '2-digit', 
          month: 'short', 
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })}. Please upload a different file or modify the existing reports.`,
        uploadedAt: existingReport.createdAt,
        isDuplicate: true
      });
    }
    
    const entries = parseCSV(file.buffer);
    console.log(`[upload-csv] Parsed ${entries.length} entries from file: ${file.originalname}`);
    
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

    console.log(`[upload-csv] Sample entries:`, entries.slice(0, 3));

    // Return just the links — don't create DB records yet
    // Include fileHash so frontend can send it when processing
    res.json({
      message: `Found ${entries.length} PDF links`,
      links: entries, // Send full objects {pdfLink, responseCount}
      total: entries.length,
      fileHash: fileHash // Send hash to frontend for later use
    });
  } catch (err) {
    console.error('[upload-csv] Error parsing file:', err);
    console.error('[upload-csv] Stack trace:', err.stack);
    res.status(500).json({ error: err.message, details: 'Check server logs for more information' });
  }
});

// ─── PROCESS ONE PDF by Drive link (called when HOD clicks OK) ─────────────
router.post('/process-one', authMiddleware, async (req, res) => {
  // Set longer timeout for AI processing
  req.setTimeout(120000);
  res.setTimeout(120000);
  try {
    const { pdfLink, sno, fileHash } = req.body;
    if (!pdfLink) return res.status(400).json({ error: 'No PDF link provided' });

    // Check cache first
    const cacheKey = `pdf_${pdfLink}`;
    let result = getCached(cacheKey);

    if (!result) {
      // Download and analyze — retry once on rate limit
      let response;
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          console.log(`[process-one] Attempt ${attempt}: Downloading ${pdfLink.substring(0, 60)}...`);
          response = await axios.get(convertDriveLink(pdfLink), {
            responseType: 'arraybuffer', timeout: 30000,
            headers: { 'User-Agent': 'Mozilla/5.0' }, maxRedirects: 5
          });
          console.log(`[process-one] Download successful, size: ${response.data.byteLength} bytes`);
          break; // success
        } catch (err) {
          const status = err.response?.status;
          console.error(`[process-one] Download attempt ${attempt} failed:`, err.message, `Status: ${status || 'N/A'}`);
          
          if (attempt < 4 && (status === 429 || status === 503)) {
            // Exponential backoff with jitter: 5s, 10s, 20s
            const delay = (5000 * attempt) + Math.random() * 2000;
            console.log(`[process-one] Waiting ${Math.round(delay/1000)}s before retry...`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          if (status === 429) {
            throw new Error('Google Drive rate limit reached. Please wait a minute and try again.');
          }
          if (status === 403) {
            throw new Error('Access denied. Make sure the PDF is shared with "Anyone at MITS" or add service account to folder permissions.');
          }
          if (status === 404) {
            throw new Error('PDF not found. The link may be invalid or the file was deleted.');
          }
          throw err;
        }
      }
      
      if (!response) {
        throw new Error('Failed to download PDF after 4 attempts');
      }
      
      const buffer = Buffer.from(response.data);
      console.log(`[process-one] Analyzing PDF...`);
      result = await analyzePDFBuffer(buffer);
      console.log(`[process-one] Analysis complete. Comments: ${result.appreciation?.length || 0} appreciation, ${result.commentsNeedingAttention?.length || 0} attention`);
      setCache(cacheKey, result);
    } else {
      console.log(`[process-one] Using cached result for ${pdfLink.substring(0, 60)}`);
    }

    const meta = result.meta || {};

    // Check if this report already exists for this HOD
    const existingReport = await FacultyReport.findOne({
      hodId: req.user.id,
      driveLink: pdfLink,
      facultyName: meta.facultyName || '',
      subjectCode: meta.subjectCode || ''
    });

    let report;
    if (existingReport) {
      // Update existing report instead of creating duplicate
      console.log(`[process-one] Updating existing report for ${meta.facultyName} - ${meta.subjectCode}`);
      report = await FacultyReport.findByIdAndUpdate(existingReport._id, {
        appreciation: result.appreciation,
        commentsNeedingAttention: result.commentsNeedingAttention,
        appreciationCount: result.appreciationCount,
        attentionCount: result.attentionCount,
        ffiScore: result.ffiScore ?? meta.ffiScore ?? existingReport.ffiScore,
        responseCount: req.body.responseCount ?? result.responseCount ?? meta.responseCount ?? existingReport.responseCount,
        responsePercent: req.body.responsePercent ?? result.responsePercent ?? meta.responsePercent ?? existingReport.responsePercent,
        registeredStudents: meta.registeredStudents ?? existingReport.registeredStudents,
        linkSent: meta.linkSent ?? existingReport.linkSent,
        rawStudentComments: result.rawStudentComments || [],
        commentCategories: result.commentCategories || {},
        commentPercentages: result.commentPercentages || {},
        status: 'processed',
        analyzedAt: result.analyzedAt,
        fileHash: fileHash || existingReport.fileHash || ''
      }, { new: true });
    } else {
      // Save to DB as new report
      report = await FacultyReport.create({
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
        analyzedAt: result.analyzedAt,
        fileHash: fileHash || ''
      });
    }

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
          const { uploadPdf } = require('../services/cloudStorage');
          const { splitPdfByFaculty } = require('../services/pdfSliceService');
          const facultySlices = await splitPdfByFaculty(file.buffer);

          for (const slice of facultySlices) {
            const sliceBuffer = slice.buffer;
            const sliceName = slice.facultyName
              ? `${slice.facultyName.replace(/\s+/g, '_')}_${file.originalname}`
              : file.originalname;

            const driveResult = await uploadPdf({
              fileName: sliceName,
              buffer: sliceBuffer,
              hodUser: user,
              academicYear,
              session
            });

            let analysis = null;
            try {
              analysis = await analyzePDFBuffer(sliceBuffer);
            } catch (aiErr) {
              console.warn(`[UploadBatch] AI analysis failed for ${sliceName}:`, aiErr.message);
              const meta = await extractMetaFromPDF(sliceBuffer).catch(() => ({}));
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

            const pdfMeta = analysis.meta || {};
            const detectedFacultyName = pdfMeta.facultyName || file.originalname.replace(/\.pdf$/i, '').replace(/[_\-]/g, ' ').trim();

            let facultyUserId = null;
            if (detectedFacultyName) {
              let matchedUser = await User.findOne({ name: { $regex: new RegExp(`^${detectedFacultyName.trim()}$`, 'i') } });
              if (!matchedUser) {
                const strippedName = detectedFacultyName.replace(/^(Dr\.|Prof\.|Mr\.|Ms\.|Mrs\.)\s+/i, '').trim();
                matchedUser = await User.findOne({ name: { $regex: new RegExp(strippedName, 'i') } });
              }
              if (matchedUser) facultyUserId = matchedUser._id;
            }

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
              pdfLink: driveResult.webViewLink || driveResult.localFilePath || '',
              driveLink: driveResult.webViewLink || '',
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
              fileName: sliceName,
              facultyName: detectedFacultyName,
              matched: !!facultyUserId,
              subjectCode: pdfMeta.subjectCode || '',
              status: 'success'
            });
          }
        } catch (fileErr) {
          console.error(`[UploadBatch] Error processing ${file.originalname}:`, fileErr.message);
          errors.push({ fileName: file.originalname, error: fileErr.message });
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

// ─── DELETE ALL REPORTS (for testing/cleanup) ─────────────────────────────
router.delete('/clear-all', authMiddleware, async (req, res) => {
  try {
    const result = await FacultyReport.deleteMany({ hodId: req.user.id });
    console.log(`[clear-all] Deleted ${result.deletedCount} reports for HOD ${req.user.id}`);
    res.json({ 
      message: `Deleted ${result.deletedCount} reports`, 
      deletedCount: result.deletedCount 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
