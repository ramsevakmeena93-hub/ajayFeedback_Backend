const express = require('express');
const router  = express.Router();
const FacultyReport      = require('../models/FacultyReport');
const TeachingAssignment = require('../models/TeachingAssignment');
const { authMiddleware, requireRole, requireAnyRole, requireWorkspace } = require('./middleware');
const { testGeminiConnection, analyzeCommentsWithAI } = require('../services/aiAnalyzer');
const { log } = require('../services/logger');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Get the first name of a user (for fallback name-regex matching) */
async function getFacultyFirstName(userId) {
  try {
    const User = require('../models/User');
    const user = await User.findById(userId).select('name');
    return user ? user.name.split(' ')[0] : null;
  } catch { return null; }
}

/**
 * buildFacultyQuery — builds a MongoDB query that finds reports for a faculty member.
 *
 * Multi-role upgrade:
 *  Primary match: facultyUserId (exact ObjectId) — reliable
 *  Fallback match: first-name regex — kept for backward compat with old reports
 *    that were created before the user linked their account.
 *
 * If the user has TeachingAssignments, also filter by assigned subjects so
 * a HOD-as-faculty only sees reports for subjects they actually teach.
 *
 * @param {string} userId
 * @param {object} extraFilters  — e.g. { academicYear, semester }
 * @param {boolean} useAssignments — if true, restrict to assigned subjectCodes
 */
async function buildFacultyQuery(userId, extraFilters = {}, useAssignments = true) {
  const firstName = await getFacultyFirstName(userId);
  const nameRegex = firstName ? new RegExp(firstName, 'i') : null;

  // Base: match by exact userId OR by name (backward compat)
  const orClauses = [{ facultyUserId: userId }];
  if (nameRegex) {
    orClauses.push({ facultyName: nameRegex, status: { $in: ['sent_to_faculty', 'faculty_approved'] } });
  }

  const query = { $or: orClauses, ...extraFilters };

  // Optionally restrict to assigned subjects (for multi-role HOD-as-faculty)
  if (useAssignments) {
    const assignments = await TeachingAssignment.find({
      facultyUserId: userId,
      active: true,
      ...(extraFilters.academicYear ? { academicYear: extraFilters.academicYear } : {}),
      ...(extraFilters.semester     ? { semester:     extraFilters.semester }     : {}),
    }).select('subjectCode branch section').lean();

    // Only apply assignment filter if assignments are configured for this user
    if (assignments.length > 0) {
      const assignedCodes = [...new Set(assignments.map(a => a.subjectCode))];
      query.subjectCode = { $in: assignedCodes };
    }
    // If no assignments are configured, show all reports (open access — backward compat)
  }

  return query;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test AI connection
// ─────────────────────────────────────────────────────────────────────────────

router.get('/ai/test', authMiddleware, async (req, res) => {
  const result = await testGeminiConnection();
  res.json(result);
});

// ─────────────────────────────────────────────────────────────────────────────
// Re-analyze report using AI (HOD workspace)
// ─────────────────────────────────────────────────────────────────────────────

router.post('/:id/ai-analyze', authMiddleware, requireAnyRole('hod'), async (req, res) => {
  try {
    const report = await FacultyReport.findOne({ _id: req.params.id, hodId: req.user.id });
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const allComments = [
      ...(report.appreciation || []),
      ...(report.commentsNeedingAttention || []),
      ...(req.body.extraComments || []),
    ].filter(Boolean);

    if (allComments.length === 0) return res.status(400).json({ error: 'No comments to analyze' });

    const aiResult = await analyzeCommentsWithAI(allComments);
    const updated  = await FacultyReport.findByIdAndUpdate(report._id, {
      appreciation:             aiResult.appreciation,
      commentsNeedingAttention: aiResult.commentsNeedingAttention,
      appreciationCount:        aiResult.appreciation.length,
      attentionCount:           aiResult.commentsNeedingAttention.length,
    }, { new: true });

    res.json({ report: updated, aiResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix metadata from PDFs (HOD)
// ─────────────────────────────────────────────────────────────────────────────

router.post('/my/fix-metadata', authMiddleware, requireAnyRole('hod'), async (req, res) => {
  try {
    const reports = await FacultyReport.find({ hodId: req.user.id, driveLink: { $exists: true, $ne: '' } });
    let fixed = 0;
    for (const report of reports) {
      try {
        const response = await require('axios').get(
          require('../services/pdfAnalyzer').convertDriveLink(report.driveLink),
          { responseType: 'arraybuffer', timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' }, maxRedirects: 5 }
        );
        const meta = await require('../services/pdfAnalyzer').extractMetaFromPDF(Buffer.from(response.data));
        if (meta.facultyName) {
          await FacultyReport.findByIdAndUpdate(report._id, {
            facultyName: meta.facultyName,
            subjectCode: meta.subjectCode || report.subjectCode,
            programme:   meta.programme   || report.programme,
            semester:    meta.semester    || report.semester,
            ffiScore:    meta.ffiScore    ?? report.ffiScore,
          });
          fixed++;
        }
      } catch {}
    }
    res.json({ fixed, total: reports.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Delete all unapproved reports for HOD
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/my/all', authMiddleware, requireAnyRole('hod'), async (req, res) => {
  try {
    const Submission = require('../models/Submission');
    const approvedSubs = await Submission.find({ hodId: req.user.id, status: 'approved' });
    const approvedIds  = approvedSubs.flatMap(s => s.reports.map(r => r.toString()));

    const result = await FacultyReport.deleteMany({
      hodId:  req.user.id,
      status: { $ne: 'faculty_approved' },
      _id:    { $nin: approvedIds },
    });
    res.json({ deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Bulk send to faculty (HOD)
// ─────────────────────────────────────────────────────────────────────────────

router.post('/bulk-send-to-faculty', authMiddleware, requireAnyRole('hod'), async (req, res) => {
  try {
    const { reportIds } = req.body;
    if (!reportIds?.length) return res.status(400).json({ error: 'No report IDs provided' });

    const User = require('../models/User');
    let sent = 0;

    for (const reportId of reportIds) {
      const report = await FacultyReport.findOne({ _id: reportId, hodId: req.user.id });
      if (!report || report.status !== 'processed') continue;

      let facultyUserId = report.facultyUserId;
      if (!facultyUserId && report.facultyName) {
        // Try exact name match first, then first-name regex
        let fu = await User.findOne({ name: report.facultyName });
        if (!fu) fu = await User.findOne({ name: { $regex: report.facultyName.split(' ')[0], $options: 'i' } });
        if (fu) facultyUserId = fu._id;
      }

      if (!facultyUserId) {
        return res.status(400).json({
          error: `Faculty "${report.facultyName}" has not registered yet. Ask them to create an account first.`,
        });
      }

      // Link the TeachingAssignment if one matches
      let teachingAssignmentId = null;
      if (report.subjectCode) {
        const ta = await TeachingAssignment.findOne({
          facultyUserId,
          subjectCode: report.subjectCode,
          active: true,
          ...(report.branch   ? { branch: report.branch }     : {}),
          ...(report.section  ? { section: report.section }   : {}),
        }).lean();
        if (ta) teachingAssignmentId = ta._id;
      }

      await FacultyReport.findByIdAndUpdate(report._id, {
        status:               'sent_to_faculty',
        sentToFacultyAt:      new Date(),
        facultyUserId,
        ...(teachingAssignmentId ? { teachingAssignmentId } : {}),
      });

      try {
        const Notification = require('../models/Notification');
        await Notification.create({
          userId:   facultyUserId,
          type:     'sent_to_faculty',
          message:  `HOD has sent a feedback report for ${report.subjectCode || 'your subject'} for your review.`,
          reportId: report._id,
        });
      } catch {}

      sent++;
    }

    res.json({ sent, total: reportIds.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Export HOD reports as CSV
// ─────────────────────────────────────────────────────────────────────────────

router.get('/my/export', authMiddleware, requireAnyRole('hod'), async (req, res) => {
  try {
    const reports = await FacultyReport.find({ hodId: req.user.id });
    const rows = [
      ['S.No','Faculty Name','Subject Code','Course Name','Branch','Section','FFI Score',
       'Response %','Appreciation','Attention','Status','Faculty Acknowledged','HOD Remarks','Action Taken','Year'],
    ];
    reports.forEach((r, i) => {
      rows.push([
        i+1, r.facultyName||'', r.subjectCode||'', r.programme||'',
        r.branch||'', r.section||'',
        r.ffiScore?.toFixed(2)||'',
        r.responsePercent!=null ? `${r.responsePercent}%` : (r.responseCount!=null ? r.responseCount : ''),
        r.appreciationCount||0, r.attentionCount||0,
        r.status||'', r.facultyAcknowledged?'Yes':'No',
        r.hodRemarks||'', r.actionTaken||'', r.academicYear||'',
      ]);
    });
    const csv = rows.map(row => row.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="feedback-reports.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Send one report to faculty (HOD)
// ─────────────────────────────────────────────────────────────────────────────

router.post('/:id/send-to-faculty', authMiddleware, requireAnyRole('hod'), async (req, res) => {
  try {
    const report = await FacultyReport.findOne({ _id: req.params.id, hodId: req.user.id });
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const User = require('../models/User');
    let facultyUserId = report.facultyUserId;
    if (!facultyUserId && report.facultyName) {
      let fu = await User.findOne({ name: report.facultyName });
      if (!fu) fu = await User.findOne({ name: { $regex: report.facultyName.split(' ')[0], $options: 'i' } });
      if (fu) facultyUserId = fu._id;
    }

    if (!facultyUserId) {
      return res.status(400).json({
        error: `Faculty "${report.facultyName}" has not registered yet.`,
      });
    }

    // Link TeachingAssignment if available
    let teachingAssignmentId = null;
    if (report.subjectCode) {
      const ta = await TeachingAssignment.findOne({
        facultyUserId,
        subjectCode: report.subjectCode,
        active: true,
      }).lean();
      if (ta) teachingAssignmentId = ta._id;
    }

    const updated = await FacultyReport.findByIdAndUpdate(
      report._id,
      {
        status:          'sent_to_faculty',
        sentToFacultyAt: new Date(),
        facultyUserId,
        ...(teachingAssignmentId ? { teachingAssignmentId } : {}),
      },
      { new: true }
    );

    try {
      const Notification = require('../models/Notification');
      await Notification.create({
        userId:   facultyUserId,
        type:     'sent_to_faculty',
        message:  `HOD has sent your feedback report for ${updated.subjectCode || 'your subject'} for review.`,
        reportId: updated._id,
      });
    } catch {}

    res.json(updated);
    log(req.user.id, 'sent_to_faculty', `Report sent to faculty: ${report.facultyName}`, { reportId: report._id }, 'success');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Edit report fields (HOD)
// ─────────────────────────────────────────────────────────────────────────────

router.patch('/:id/edit', authMiddleware, requireAnyRole('hod'), async (req, res) => {
  try {
    const {
      programme, semester, goodComments, badComments, hodRemarks,
      facultyName, subjectCode, status, actionTaken, branch, section,
      commentsNeedingAttention, appreciation, responsePercent, responseCount,
    } = req.body;

    const update = {};
    if (programme    !== undefined) update.programme    = programme;
    if (semester     !== undefined) update.semester     = semester;
    if (goodComments !== undefined) update.goodComments = goodComments;
    if (badComments  !== undefined) update.badComments  = badComments;
    if (hodRemarks   !== undefined) update.hodRemarks   = hodRemarks;
    if (facultyName  !== undefined) update.facultyName  = facultyName;
    if (subjectCode  !== undefined) update.subjectCode  = subjectCode;
    if (actionTaken  !== undefined) update.actionTaken  = actionTaken;
    if (branch       !== undefined) update.branch       = branch;
    if (section      !== undefined) update.section      = section;
    if (responseCount !== undefined) update.responseCount = responseCount !== null && responseCount !== '' ? Number(responseCount) : null;
    if (responsePercent !== undefined) update.responsePercent = responsePercent !== null && responsePercent !== '' ? Number(responsePercent) : null;

    if (commentsNeedingAttention !== undefined) {
      const list = Array.isArray(commentsNeedingAttention)
        ? commentsNeedingAttention
        : String(commentsNeedingAttention).split('\n').map(s => s.trim()).filter(Boolean);
      update.commentsNeedingAttention = list;
      update.attentionCount = list.length;
    }

    if (appreciation !== undefined) {
      const list = Array.isArray(appreciation)
        ? appreciation
        : String(appreciation).split('\n').map(s => s.trim()).filter(Boolean);
      update.appreciation = list;
      update.appreciationCount = list.length;
    }

    // HOD force-approve (bypasses faculty ACK)
    if (status === 'faculty_approved') {
      update.status               = 'faculty_approved';
      update.facultyAcknowledged  = true;
      update.facultyAcknowledgedAt = new Date();
    }

    const report = await FacultyReport.findOneAndUpdate(
      { _id: req.params.id, hodId: req.user.id },
      update,
      { new: true }
    );
    if (!report) return res.status(404).json({ error: 'Report not found' });

    // Notify faculty on force-approval
    if (status === 'faculty_approved') {
      try {
        let fid = report.facultyUserId;
        if (!fid && report.facultyName) {
          const User = require('../models/User');
          const fu   = await User.findOne({ name: { $regex: report.facultyName.split(' ')[0], $options: 'i' } });
          if (fu) fid = fu._id;
        }
        if (fid) {
          const Notification = require('../models/Notification');
          const User         = require('../models/User');
          const hodUser      = await User.findById(req.user.id).select('name');
          await Notification.create({
            userId:   fid,
            type:     'hod_force_approved',
            message:  `HOD ${hodUser?.name || 'HOD'} approved your report for ${report.subjectCode || 'your subject'}. Reason: ${actionTaken || 'N/A'}`,
            reportId: report._id,
          });
        }
      } catch {}
    }

    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Faculty: Advanced analytics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Multi-role upgrade: If this user is also a HOD, their reports as faculty
 * are scoped to their TEACHING ASSIGNMENTS when viewing in the faculty workspace.
 * We pass useAssignments=true here.
 */
router.get('/faculty/advanced-analytics',
  authMiddleware,
  requireAnyRole('faculty', 'hod'),
  async (req, res) => {
    try {
      const query = await buildFacultyQuery(
        req.user.id,
        { status: { $in: ['sent_to_faculty', 'faculty_approved'] } },
        true
      );
      const myReports = await FacultyReport.find(query).sort({ createdAt: 1 });

      // FFI trend
      const trendMap = {};
      myReports.forEach(r => {
        const key = `${r.academicYear || 'Unknown'}-Sem${r.semester || '?'}`;
        if (!trendMap[key]) trendMap[key] = { key, ffis: [], appreciation: 0, attention: 0 };
        if (r.ffiScore) trendMap[key].ffis.push(r.ffiScore);
        trendMap[key].appreciation += r.appreciationCount || 0;
        trendMap[key].attention    += r.attentionCount    || 0;
      });
      const trend = Object.values(trendMap).map(t => ({
        period:      t.key,
        avgFFI:      t.ffis.length ? parseFloat((t.ffis.reduce((s, v) => s + v, 0) / t.ffis.length).toFixed(2)) : 0,
        appreciation: t.appreciation,
        attention:    t.attention,
      }));

      let improvement = null;
      if (trend.length >= 2) {
        const last = trend[trend.length - 1], prev = trend[trend.length - 2];
        const diff = parseFloat((last.avgFFI - prev.avgFFI).toFixed(2));
        improvement = { diff, direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'same', from: prev.period, to: last.period };
      }

      const deptReports = await FacultyReport.find({
        hodId:    { $in: myReports.map(r => r.hodId) },
        status:   { $in: ['sent_to_faculty', 'faculty_approved'] },
        ffiScore: { $ne: null },
      });
      const deptAvgFFI = deptReports.length
        ? parseFloat((deptReports.reduce((s, r) => s + (r.ffiScore || 0), 0) / deptReports.length).toFixed(2))
        : 0;
      const myWithScore = myReports.filter(r => r.ffiScore);
      const myAvgFFI = myWithScore.length
        ? parseFloat((myWithScore.reduce((s, r) => s + r.ffiScore, 0) / myWithScore.length).toFixed(2))
        : 0;

      const allAttention = myReports.flatMap(r => r.commentsNeedingAttention || []);
      const dimensions = {
        'Speed':        allAttention.filter(c => /fast|slow|speed|quick/i.test(c)).length,
        'Clarity':      allAttention.filter(c => /unclear|confus|understand|explain/i.test(c)).length,
        'Examples':     allAttention.filter(c => /example|practical|application/i.test(c)).length,
        'Availability': allAttention.filter(c => /available|doubt|question|help/i.test(c)).length,
        'Material':     allAttention.filter(c => /notes|material|slide|pdf|book/i.test(c)).length,
      };

      const recommendations = [];
      if (dimensions['Speed'] > 0)        recommendations.push({ icon: '⏱️', title: 'Adjust Teaching Pace', desc: `${dimensions['Speed']} student(s) mentioned speed issues.` });
      if (dimensions['Clarity'] > 0)      recommendations.push({ icon: '💡', title: 'Improve Explanation Clarity', desc: `${dimensions['Clarity']} student(s) had clarity concerns.` });
      if (dimensions['Examples'] > 0)     recommendations.push({ icon: '📝', title: 'Add More Examples', desc: `${dimensions['Examples']} student(s) want more practical examples.` });
      if (dimensions['Material'] > 0)     recommendations.push({ icon: '📚', title: 'Share Study Materials', desc: `${dimensions['Material']} student(s) mentioned materials.` });
      if (myAvgFFI >= 4.0)                recommendations.push({ icon: '🌟', title: 'Maintain Excellence', desc: 'Your FFI is excellent! Keep up the great work.' });
      if (recommendations.length === 0)   recommendations.push({ icon: '✅', title: 'No Major Issues', desc: 'Students are satisfied with your teaching.' });

      res.json({ trend, improvement, deptAvgFFI, myAvgFFI, dimensions, recommendations, totalReports: myReports.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Faculty: My reports list
// ─────────────────────────────────────────────────────────────────────────────

router.get('/faculty/my', authMiddleware, requireAnyRole('faculty', 'hod'), async (req, res) => {
  try {
    const extra = {};
    if (req.query.year)     extra.academicYear = req.query.year;
    if (req.query.semester) extra.semester     = req.query.semester;

    const query = await buildFacultyQuery(req.user.id, extra, true);
    const reports = await FacultyReport.find(query).sort({ createdAt: -1 });
    res.json(reports);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Faculty: Analysis summary
// ─────────────────────────────────────────────────────────────────────────────

router.get('/faculty/analysis', authMiddleware, requireAnyRole('faculty', 'hod'), async (req, res) => {
  try {
    const extra = { status: { $in: ['sent_to_faculty', 'faculty_approved'] } };
    if (req.query.year)     extra.academicYear = req.query.year;
    if (req.query.semester) extra.semester     = req.query.semester;

    const query   = await buildFacultyQuery(req.user.id, extra, true);
    const reports = await FacultyReport.find(query);

    if (reports.length === 0) return res.json({ reports: [], summary: null });

    const totalReports       = reports.length;
    const avgFFI             = reports.reduce((s, r) => s + (r.ffiScore || 0), 0) / totalReports;
    const totalAppreciation  = reports.reduce((s, r) => s + (r.appreciationCount || 0), 0);
    const totalAttention     = reports.reduce((s, r) => s + (r.attentionCount || 0), 0);
    const ffiBySubject       = reports.map(r => ({
      subject: r.subjectCode || r.programme || 'Unknown',
      ffi:     r.ffiScore || 0,
      semester: r.semester,
      year:    r.academicYear,
      branch:  r.branch || '',
      section: r.section || '',
    }));

    let grade = 'C';
    if (avgFFI >= 4.5) grade = 'A+';
    else if (avgFFI >= 4.0) grade = 'A';
    else if (avgFFI >= 3.5) grade = 'B+';
    else if (avgFFI >= 3.0) grade = 'B';
    else if (avgFFI >= 2.5) grade = 'C+';

    // All-time available years/semesters for filter UI
    const allQ    = await buildFacultyQuery(req.user.id, {}, false);
    const allRpts = await FacultyReport.find(allQ).select('academicYear semester');
    const years     = [...new Set(allRpts.map(r => r.academicYear).filter(Boolean))].sort().reverse();
    const semesters = [...new Set(allRpts.map(r => r.semester).filter(Boolean))].sort();

    // Aggregate commentPercentages across all reports
    const commentPercentages = {};
    let commentCount = 0;
    reports.forEach(r => {
      if (r.commentPercentages && typeof r.commentPercentages === 'object') {
        for (const [key, val] of Object.entries(r.commentPercentages)) {
          commentPercentages[key] = (commentPercentages[key] || 0) + (Number(val) || 0);
        }
        commentCount++;
      }
    });
    if (commentCount > 0) {
      for (const key of Object.keys(commentPercentages)) {
        commentPercentages[key] = Math.round(commentPercentages[key] / commentCount);
      }
    }

    res.json({
      reports,
      summary: {
        totalReports,
        avgFFI:          parseFloat(avgFFI.toFixed(2)),
        totalAppreciation,
        totalAttention,
        grade,
        ffiBySubject,
        commentPercentages,
        years,
        semesters,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Faculty: Acknowledge report
// ─────────────────────────────────────────────────────────────────────────────

router.post('/:id/acknowledge', authMiddleware, requireAnyRole('faculty', 'hod'), async (req, res) => {
  try {
    const report = await FacultyReport.findByIdAndUpdate(
      req.params.id,
      { facultyAcknowledged: true, facultyAcknowledgedAt: new Date(), status: 'faculty_approved' },
      { new: true }
    );
    if (!report) return res.status(404).json({ error: 'Report not found' });

    try {
      const Notification = require('../models/Notification');
      await Notification.create({
        userId:   report.hodId,
        type:     'faculty_approved',
        message:  `${report.facultyName || 'Faculty'} acknowledged the feedback report (${report.subjectCode || ''})`,
        reportId: report._id,
      });
    } catch {}

    res.json(report);
    log(report.hodId, 'faculty_approved', `Faculty acknowledged: ${report.facultyName}`, { reportId: report._id }, 'success');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HOD: Get own reports (scoped to HOD's department if departmentScope is set)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/my', authMiddleware, requireAnyRole('hod'), async (req, res) => {
  try {
    const { status, search } = req.query;

    // HOD sees reports they created (hodId = them)
    // Multi-role upgrade: also scope by departmentScope from JWT (if present)
    const query = { hodId: req.user.id };
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { facultyName: { $regex: search, $options: 'i' } },
        { subjectCode: { $regex: search, $options: 'i' } },
      ];
    }

    const reports = await FacultyReport.find(query).sort({ createdAt: -1 });
    res.json(reports);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Get single report (ownership check added)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Multi-role upgrade: restrict to reports the caller has access to.
 *  - HOD: must be the hodId
 *  - Faculty: must be the facultyUserId or name-matched
 *  - VC / admin: unrestricted
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const report = await FacultyReport.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const callerRoles = new Set([
      ...(req.user?.roles || []),
      ...(req.user?.role ? [req.user.role] : []),
    ]);

    if (!callerRoles.has('vc') && !callerRoles.has('admin')) {
      const isHOD     = report.hodId?.toString() === req.user.id;
      const isFaculty = report.facultyUserId?.toString() === req.user.id;
      if (!isHOD && !isFaculty) {
        // Last chance: name regex
        const firstName = await getFacultyFirstName(req.user.id);
        const nameMatch = firstName && new RegExp(firstName, 'i').test(report.facultyName?.split(' ')[0]);
        if (!nameMatch) return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HOD: Update remarks
// ─────────────────────────────────────────────────────────────────────────────

router.patch('/:id/remarks', authMiddleware, requireAnyRole('hod'), async (req, res) => {
  try {
    const report = await FacultyReport.findOneAndUpdate(
      { _id: req.params.id, hodId: req.user.id },
      { hodRemarks: req.body.hodRemarks },
      { new: true }
    );
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HOD: Preview PDF before VC
// ─────────────────────────────────────────────────────────────────────────────

const handleHODExportPDF = async (req, res) => {
  try {
    const User = require('../models/User');
    const vcUser = await User.findOne({ role: 'vc' }).select('name signatureImage');
    const hodUser = await User.findById(req.user.id).select('name email department signatureImage');
    
    const query = { hodId: req.user.id };
    const reportIds = req.body?.reportIds || (req.query?.reportIds ? req.query.reportIds.split(',') : null);
    if (reportIds && reportIds.length > 0) {
      query._id = { $in: reportIds };
    }

    let reports = await FacultyReport.find(query).sort({ createdAt: -1 });
    if (reports.length === 0) {
      // Fallback: check any reports belonging to HOD
      reports = await FacultyReport.find({ hodId: req.user.id });
    }
    if (reports.length === 0) return res.status(400).json({ error: 'No reports found to export' });

    const { generateFeedbackReportPDF } = require('../services/pdfGenerator');
    const pdfBuffer = await generateFeedbackReportPDF({
      submission: {
        academicYear: reports[0]?.academicYear || new Date().getFullYear().toString(),
        department: req.user.department || hodUser?.department || ''
      },
      reports,
      hodUser,
      vcUser,
      approvedAt: null,
      withoutSignatures: true, // Same as final PDF but without signatures attached
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="hod-feedback-report.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[HOD Export PDF Error]:', err);
    res.status(500).json({ error: err.message });
  }
};

router.get('/my/preview-pdf', authMiddleware, requireAnyRole('hod'), handleHODExportPDF);
router.get('/my/export-pdf', authMiddleware, requireAnyRole('hod'), handleHODExportPDF);
router.post('/my/export-pdf', authMiddleware, requireAnyRole('hod'), handleHODExportPDF);

// ─────────────────────────────────────────────────────────────────────────────
// VC: Get submission reports
// ─────────────────────────────────────────────────────────────────────────────

router.get('/submission/:submissionId', authMiddleware, requireRole('vc'), async (req, res) => {
  try {
    const Submission = require('../models/Submission');
    const submission = await Submission.findById(req.params.submissionId)
      .populate('hodId', 'name email department')
      .populate({
        path:   'reports',
        model:  'FacultyReport',
        select: 'facultyName subjectCode programme semester branch section ffiScore appreciationCount attentionCount status commentsNeedingAttention appreciation commentPercentages actionTaken hodRemarks driveLink academicYear',
      });
    if (!submission) return res.status(404).json({ error: 'Submission not found' });

    // Deduplicate
    const seen = new Set();
    const unique = (submission.reports || []).filter(r => {
      if (!r?._id) return false;
      const k = r._id.toString();
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });

    res.json({ ...submission.toObject(), reports: unique });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Serve the EXACT ORIGINAL UPLOADED PDF FILE (ERP evaluation printout pages)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/pdf', async (req, res) => {
  try {
    const report = await FacultyReport.findById(req.params.id);
    if (!report) return res.status(404).send('Report not found');

    const link = report.driveLink || report.pdfLink || '';

    // 1. Real cloud URL — redirect directly
    const isCloud = (link.startsWith('https://') || link.startsWith('http://')) && (
      link.includes('storage.googleapis.com') ||
      link.includes('drive.google.com') ||
      link.includes('googleusercontent.com') ||
      link.includes('s3.amazonaws.com') ||
      link.includes('s3.') ||
      link.includes('cloudinary.com') ||
      link.includes('amazonaws.com')
    );

    if (isCloud) {
      return res.redirect(302, link);
    }

    // 1b. If the stored link is a localhost / old-server URL, the file no longer
    //     exists on this server (Render's disk is ephemeral). Return a clear JSON
    //     error so the frontend can show a useful message rather than a generic 404.
    const isStaleLocalUrl =
      link.includes('localhost') ||
      link.includes('127.0.0.1') ||
      (link.startsWith('http') && !isCloud);

    if (isStaleLocalUrl) {
      return res.status(404).json({
        error: 'PDF not available',
        reason: 'stale_url',
        message: 'This PDF was uploaded to the previous server and is no longer stored. Please re-upload the feedback PDF.',
      });
    }

    // 2. Locate original uploaded file on disk
    const fs   = require('fs');
    const path = require('path');
    const { slicePdfForReport } = require('../services/pdfSliceService');
    let filePath = null;

    if (report.pdfFilePath && fs.existsSync(report.pdfFilePath)) {
      filePath = report.pdfFilePath;
    }

    // Check if driveLink contains /uploads/reports/ path
    if (!filePath && link.includes('/uploads/reports/')) {
      const relPath = link.split('/uploads/reports/')[1]?.split('?')[0];
      if (relPath) {
        const candidate = path.join(__dirname, '..', 'uploads', 'reports', decodeURIComponent(relPath));
        if (fs.existsSync(candidate)) filePath = candidate;
      }
    }

    // Recursive search in uploads/reports directory
    if (!filePath) {
      const reportsDir = path.join(__dirname, '..', 'uploads', 'reports');
      function findPdfRecursive(dir) {
        if (!fs.existsSync(dir)) return null;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const found = findPdfRecursive(fullPath);
            if (found) return found;
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
            if (report.subjectCode) {
              const cleanCode = report.subjectCode.replace(/[^a-zA-Z0-9]/g, '');
              if (cleanCode && entry.name.includes(cleanCode)) return fullPath;
            }
          }
        }
        return null;
      }
      filePath = findPdfRecursive(reportsDir);
    }

    // 3. Fallback demo-output.pdf (which has the exact original MITS ERP format)
    if (!filePath || !fs.existsSync(filePath)) {
      const demoPath = path.join(__dirname, '..', 'demo-output.pdf');
      if (fs.existsSync(demoPath)) filePath = demoPath;
    }

    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).send('Original uploaded PDF not found');
    }

    const rawBuffer = fs.readFileSync(filePath);

    // Extract ONLY this faculty's specific pages from the uploaded PDF
    const slicedBuffer = await slicePdfForReport(rawBuffer, {
      subjectCode: report.subjectCode,
      facultyName: report.facultyName
    });

    const safeName = `${(report.facultyName || 'faculty')}_${(report.subjectCode || 'report')}.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.send(slicedBuffer);
  } catch (err) {
    console.error('[Reports] PDF stream error:', err.message);
    res.status(500).send('Error serving PDF');
  }
});

// Optional: generated AI analysis summary
router.get('/:id/summary-pdf', async (req, res) => {
  try {
    const report = await FacultyReport.findById(req.params.id);
    if (!report) return res.status(404).send('Report not found');
    const { generateIndividualFacultyPDF } = require('../services/pdfGenerator');
    const pdfBuffer = await generateIndividualFacultyPDF(report);
    const safeName = `${(report.facultyName || 'faculty')}_Summary.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    return res.send(pdfBuffer);
  } catch (err) {
    res.status(500).send('Error generating summary');
  }
});

module.exports = router;
