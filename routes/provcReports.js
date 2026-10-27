'use strict';

const express    = require('express');
const router     = express.Router();
const { authMiddleware, requireAnyRole } = require('./middleware');
const Submission   = require('../models/Submission');
const FacultyReport = require('../models/FacultyReport');
const ProVCReport  = require('../models/ProVCReport');
const User         = require('../models/User');
const { generateProVCReport, generateDepartmentProVCReport } = require('../services/provcReportGenerator');

// ─── Helper: compute dfi and avgResponse from a list of FacultyReport docs ───
function calcStats(reports) {
  const ffis  = (reports || []).map(r => r.ffiScore).filter(v => v != null);
  const pcts  = (reports || []).map(r => r.responsePercent).filter(v => v != null);
  const dfi   = ffis.length  ? ffis.reduce((s, v)  => s + v, 0)  / ffis.length  : null;
  const avg   = pcts.length  ? pcts.reduce((s, v)  => s + v, 0)  / pcts.length  : null;
  return { dfi, avgResponse: avg };
}

// ─── POST /generate-faculty ───────────────────────────────────────────────────
router.post(
  '/generate-faculty',
  authMiddleware,
  requireAnyRole('vc', 'provc', 'admin'),
  async (req, res) => {
    try {
      const { submissionId, facultyName } = req.body;
      if (!submissionId || !facultyName) {
        return res.status(400).json({ error: 'submissionId and facultyName are required' });
      }

      const submission = await Submission.findById(submissionId)
        .populate('hodId', 'name email department signatureImage')
        .populate({
          path: 'reports',
          model: 'FacultyReport',
          select:
            'facultyName subjectCode programme semester ffiScore responseCount responsePercent ' +
            'registeredStudents linkSent linksSent appreciation commentsNeedingAttention hodRemarks ' +
            'actionTaken academicYear',
        })
        .lean();

      if (!submission) return res.status(404).json({ error: 'Submission not found' });

      // Match faculty by exact name, fallback to case-insensitive
      let matchedReports = (submission.reports || []).filter(
        r => r.facultyName === facultyName
      );
      if (!matchedReports.length) {
        const lower = facultyName.toLowerCase();
        matchedReports = (submission.reports || []).filter(
          r => (r.facultyName || '').toLowerCase() === lower
        );
      }
      if (!matchedReports.length) {
        return res.status(400).json({
          error: `No reports found for faculty '${facultyName}' in this submission`,
        });
      }

      // Fix: query provc first, fallback to vc — avoids undeterministic findOne with $or
      let vcUser = await User.findOne({ role: 'provc' }).select('name signatureImage').lean();
      if (!vcUser) vcUser = await User.findOne({ role: 'vc' }).select('name signatureImage').lean();

      const { dfi, avgResponse } = calcStats(submission.reports || []);
      const approvedDate = new Date().toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
      });

      const pdfBuffer = await generateProVCReport({
        faculty: {
          name:        facultyName,
          designation: 'Faculty',
          department:  submission.department || submission.hodId?.department || '',
        },
        submission,
        reports:      matchedReports,
        hodUser:      submission.hodId,
        vcUser,
        approvedDate,
        avgResponse,
        dfi,
      });

      // Fix: guard against BSON 16 MB limit before attempting to store
      const BSON_LIMIT = 15 * 1024 * 1024; // 15 MB safe limit
      if (pdfBuffer.length > BSON_LIMIT) {
        return res.status(413).json({
          error: `Generated PDF is too large to store (${(pdfBuffer.length / (1024 * 1024)).toFixed(1)} MB). ` +
                 'Use the direct download endpoint instead.',
        });
      }

      const department = submission.department || submission.hodId?.department || '';
      // Fix: capture actionTaken snapshot from per-report fields
      const actionTakenSnapshot = (matchedReports || [])
        .map(r => r.actionTaken || '')
        .filter(Boolean)
        .join('\n') || '';

      const saved = await ProVCReport.create({
        reportType:      'faculty-wise',
        department,
        programme:       matchedReports[0]?.programme || '',
        academicYear:    submission.academicYear || '',
        session:         submission.session || '',
        facultyName,
        submissionId:    submission._id,
        generatedBy:     req.user.id,
        generatedByName: req.user.name || '',
        pdfData:         pdfBuffer,
        reportTitle:     `Pro-VC Comments Report — ${facultyName}`,
        overallComments: '',
        actionTaken:     actionTakenSnapshot,
      });

      res.json({ reportId: saved._id, message: 'Faculty report generated' });
    } catch (err) {
      console.error('[ProVC Faculty Report]', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── POST /generate-department ────────────────────────────────────────────────
router.post(
  '/generate-department',
  authMiddleware,
  requireAnyRole('vc', 'provc', 'admin'),
  async (req, res) => {
    try {
      const { submissionId, overallComments } = req.body;
      if (!submissionId) return res.status(400).json({ error: 'submissionId is required' });

      let submission = await Submission.findById(submissionId)
        .populate('hodId', 'name email department signatureImage')
        .populate({
          path: 'reports',
          model: 'FacultyReport',
          select:
            'facultyName subjectCode programme semester ffiScore responseCount responsePercent ' +
            'registeredStudents linkSent linksSent appreciation commentsNeedingAttention hodRemarks ' +
            'actionTaken academicYear',
        })
        .lean();

      if (!submission) return res.status(404).json({ error: 'Submission not found' });

      // If overallComments provided, persist it so the generator reads the new value
      if (overallComments && overallComments.trim()) {
        await Submission.findByIdAndUpdate(
          submissionId,
          { vcComment: overallComments.trim() },
          { new: true }
        );
        submission = { ...submission, vcComment: overallComments.trim() };
      }

      // Fix: query provc first, fallback to vc — avoids undeterministic findOne with $or
      let vcUser = await User.findOne({ role: 'provc' }).select('name signatureImage').lean();
      if (!vcUser) vcUser = await User.findOne({ role: 'vc' }).select('name signatureImage').lean();

      const allReports = submission.reports || [];
      const { dfi, avgResponse } = calcStats(allReports);
      const approvedDate = new Date().toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
      });

      const pdfBuffer = await generateDepartmentProVCReport({
        submission,
        reports:     allReports,
        hodUser:     submission.hodId,
        vcUser,
        approvedDate,
        avgResponse,
        dfi,
        programme:   allReports[0]?.programme || '',
      });

      // Fix: guard against BSON 16 MB limit before attempting to store
      const BSON_LIMIT = 15 * 1024 * 1024; // 15 MB safe limit
      if (pdfBuffer.length > BSON_LIMIT) {
        return res.status(413).json({
          error: `Generated PDF is too large to store (${(pdfBuffer.length / (1024 * 1024)).toFixed(1)} MB). ` +
                 'Use the direct download endpoint instead.',
        });
      }

      const department = submission.department || submission.hodId?.department || '';
      // Fix: capture actionTaken snapshot from vcComment and per-report actionTaken fields
      const actionTakenSnapshot = overallComments?.trim()
        || submission.vcComment
        || allReports.map(r => r.actionTaken || '').filter(Boolean).join('\n')
        || '';

      const saved = await ProVCReport.create({
        reportType:      'department-overall',
        department,
        programme:       allReports[0]?.programme || '',
        academicYear:    submission.academicYear || '',
        session:         submission.session || '',
        facultyName:     '',
        submissionId:    submission._id,
        generatedBy:     req.user.id,
        generatedByName: req.user.name || '',
        pdfData:         pdfBuffer,
        reportTitle:     `Overall Pro-VC Report — ${department} (${submission.academicYear || ''})`,
        overallComments: overallComments || submission.vcComment || '',
        actionTaken:     actionTakenSnapshot,
      });

      res.json({ reportId: saved._id, message: 'Department report generated' });
    } catch (err) {
      console.error('[ProVC Dept Report]', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── GET /submission/:submissionId ────────────────────────────────────────────
// Must be BEFORE /:id/download so Express doesn't match "submission" as an id
router.get(
  '/submission/:submissionId',
  authMiddleware,
  requireAnyRole('vc', 'provc', 'admin'),
  async (req, res) => {
    try {
      const reports = await ProVCReport
        .find({ submissionId: req.params.submissionId })
        .select('-pdfData')
        .sort({ generatedAt: -1 })
        .lean();
      res.json(reports);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── GET /department/:department ──────────────────────────────────────────────
// Must be BEFORE /:id/download so Express doesn't match "department" as an id
router.get(
  '/department/:department',
  authMiddleware,
  async (req, res) => {
    try {
      const callerRoles = new Set([
        ...(req.user?.roles || []),
        ...(req.user?.role ? [req.user.role] : []),
      ]);
      const isPrivileged = callerRoles.has('vc') || callerRoles.has('provc') || callerRoles.has('admin');

      if (!isPrivileged) {
        const userDept = req.user.departmentScope || req.user.department || '';
        const reqDept  = decodeURIComponent(req.params.department);
        if (reqDept !== userDept) {
          return res.status(403).json({ error: 'You can only access reports for your own department' });
        }
      }

      const department = decodeURIComponent(req.params.department);
      const reports = await ProVCReport
        .find({ department })
        .select('-pdfData')
        .sort({ generatedAt: -1 })
        .lean();
      res.json(reports);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── GET /:id/download ────────────────────────────────────────────────────────
router.get('/:id/download', authMiddleware, async (req, res) => {
  try {
    const report = await ProVCReport.findById(req.params.id).lean();
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const callerRoles = new Set([
      ...(req.user?.roles || []),
      ...(req.user?.role ? [req.user.role] : []),
    ]);
    const isPrivileged = callerRoles.has('vc') || callerRoles.has('provc') || callerRoles.has('admin');
    const isHod = callerRoles.has('hod');

    // Fix: explicit allowlist — only vc/provc/admin and hod (with dept match) are permitted
    if (!isPrivileged && !isHod) {
      return res.status(403).json({ error: 'Access denied — insufficient role' });
    }

    // HOD can only download their own department's reports
    if (isHod && !isPrivileged) {
      const userDept = req.user.departmentScope || req.user.department || '';
      if (report.department !== userDept) {
        return res.status(403).json({ error: 'Access denied — wrong department' });
      }
    }

    const facPart  = report.reportType === 'faculty-wise'
      ? (report.facultyName || 'Faculty').replace(/\s+/g, '_')
      : `Dept_${(report.department || 'Dept').replace(/\s+/g, '_')}`;
    const filename = `ProVC_${facPart}_${report.academicYear || 'Report'}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', report.pdfData.length);
    res.send(report.pdfData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
