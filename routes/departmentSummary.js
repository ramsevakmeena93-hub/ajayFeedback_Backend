// ═══════════════════════════════════════════════════════════════════════════
// Department Summary Route
//
// GET /api/department-summary/:submissionId
//   Generates a landscape A4 MITS-style Department Summary PDF from the
//   report data already extracted by pdfAnalyzer.js and stored in the DB.
//
// This route is SEPARATE from the existing submissions route — it does not
// modify any existing route or service file.
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

const { generateDepartmentSummaryPdf } = require('../services/departmentReportGenerator');
const { buildDepartmentSummaryAnalysis } = require('../services/departmentSummaryBuilder');
const { authMiddleware, requireAnyRole }  = require('./middleware');

// ── GET /:submissionId — generate & return PDF ────────────────────────────

router.get('/:submissionId', authMiddleware, requireAnyRole('vc', 'provc', 'admin'), async (req, res) => {
  const { submissionId } = req.params;

  try {
    // 1. Build analysis from DB records
    const analysis = await buildDepartmentSummaryAnalysis(submissionId, {
      thresholds: req.query.thresholds ? JSON.parse(req.query.thresholds) : undefined,
    });

    if (!analysis.records || analysis.records.length === 0) {
      return res.status(404).json({ error: 'No reports found in this submission' });
    }

    // 2. Generate PDF to a temp file
    const tmpPath  = path.join(os.tmpdir(), `dept-summary-${submissionId}-${Date.now()}.pdf`);
    const leftLogo = path.join(__dirname, '..', 'assets', 'mits-header.png');

    await generateDepartmentSummaryPdf(analysis, tmpPath, {
      leftLogo: fs.existsSync(leftLogo) ? leftLogo : undefined,
      rowsPerPage: [9, 14, 8],
    });

    // 3. Stream the PDF back to the client
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="department-summary-${submissionId}.pdf"`);

    const stream = fs.createReadStream(tmpPath);
    stream.pipe(res);
    stream.on('end',   () => fs.unlink(tmpPath, () => {}));
    stream.on('error', (err) => {
      console.error('[DeptSummary] Stream error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to send PDF' });
    });

  } catch (err) {
    console.error('[DeptSummary] Error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Failed to generate department summary' });
    }
  }
});

// ── GET /:submissionId/analysis — return JSON analysis (no PDF) ─────────────

router.get('/:submissionId/analysis', authMiddleware, requireAnyRole('vc', 'provc', 'admin'), async (req, res) => {
  try {
    const analysis = await buildDepartmentSummaryAnalysis(req.params.submissionId);
    res.json(analysis);
  } catch (err) {
    console.error('[DeptSummary] Analysis error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to build analysis' });
  }
});

module.exports = router;
