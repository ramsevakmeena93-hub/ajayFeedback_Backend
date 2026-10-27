// ═══════════════════════════════════════════════════════════════════════════
// Department Summary Builder
//
// Converts a Submission + its FacultyReports (already extracted by pdfAnalyzer.js)
// into the analysis object expected by departmentReportGenerator.generateDepartmentSummaryPdf().
//
// This is a SEPARATE file — it does NOT modify or import the existing pdfAnalyzer
// or aiAnalyzer. It reads directly from the Mongoose models.
// ═══════════════════════════════════════════════════════════════════════════

const Submission  = require('../models/Submission');
const FacultyReport = require('../models/FacultyReport');

const DEFAULT_THRESHOLDS = {
  lowFfi: 3.0,
  watchFfi: 3.5,
  lowResponsePercent: 65,
  strongFfi: 4.0,
  strongResponsePercent: 80,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function mean(values) {
  const valid = values.filter(v => v !== null && v !== undefined && Number.isFinite(v));
  return valid.length
    ? Number((valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2))
    : null;
}

function buildSessionName(submission) {
  const formMap = { I: 'First', II: 'Second' };
  const sessionMap = {
    'jul-dec': 'July-Dec',
    'jan-may': 'Jan-May',
  };
  const form    = formMap[submission.feedbackFormNo] || submission.feedbackFormNo || '';
  const session = sessionMap[(submission.session || '').toLowerCase()] || submission.session || '';
  const year    = submission.academicYear || String(new Date().getFullYear());
  return `${form} Faculty Feedback ${session} ${year}`.replace(/\s+/g, ' ').trim();
}

// ── Main builder ───────────────────────────────────────────────────────────

/**
 * Build a department-summary analysis object from database records.
 *
 * @param {string} submissionId  — Mongo ObjectId of the Submission
 * @param {object} options       — { thresholds, expectedRecordCount }
 * @returns {object} analysis result compatible with generateDepartmentSummaryPdf()
 */
async function buildDepartmentSummaryAnalysis(submissionId, options = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) };

  // 1. Fetch submission with populated reports + HOD
  const submission = await Submission.findById(submissionId)
    .populate({ path: 'reports', model: FacultyReport })
    .populate('hodId');

  if (!submission) throw new Error('Submission not found');

  const reports = submission.reports || [];
  if (!reports.length) throw new Error('No reports found in this submission');

  const hod = submission.hodId;

  // 2. Build metadata
  const responsePercents = reports.map(r => r.responsePercent).filter(v => v != null);
  const ffiScores        = reports.map(r => r.ffiScore).filter(v => v != null);
  const avgResponse      = mean(responsePercents);
  const avgFFI           = mean(ffiScores);

  const metadata = {
    institution: 'Madhav Institute of Technology & Science, Gwalior (M.P.), INDIA',
    departmentName: submission.department || hod?.department || '',
    sessionName: buildSessionName(submission),
    programmeName: reports[0]?.programme || '',
    departmentAverageResponsePercent: avgResponse,
    dfi: avgFFI,
    coordinatorName: hod?.name || '',
  };

  // 3. Build records from FacultyReport documents
  const records = reports.map((r, i) => ({
    serialNumber: i + 1,
    facultyName:       r.facultyName || '',
    courseCode:        r.subjectCode || '',
    courseName:        r.programme || '',
    semester:          r.semester ? parseInt(r.semester, 10) : null,
    registeredStudents: r.registeredStudents ?? null,
    linksSent:         r.linkSent ?? null,
    responseCount:     r.responseCount ?? null,
    responsePercent:   r.responsePercent ?? null,
    ffiScore:          r.ffiScore ?? null,
    sourcePage: 1,
  }));

  // 4. Build faculty analysis (group by faculty name)
  const facultyMap = new Map();
  for (const record of records) {
    const key = record.facultyName.toLowerCase();
    if (!facultyMap.has(key)) {
      facultyMap.set(key, {
        facultyName: record.facultyName,
        courses: [],
        ffiScores: [],
        responsePercents: [],
      });
    }
    const entry = facultyMap.get(key);
    entry.courses.push(record);
    entry.ffiScores.push(record.ffiScore);
    entry.responsePercents.push(record.responsePercent);
  }

  const facultyAnalysis = [...facultyMap.values()].map(f => ({
    facultyName: f.facultyName,
    courseCount: f.courses.length,
    averageFfiScore: mean(f.ffiScores),
    averageResponsePercent: mean(f.responsePercents),
    courses: f.courses,
  }));

  // 5. Build needs-attention list
  const needsAttention = records
    .filter(r =>
      (r.ffiScore        != null && r.ffiScore < thresholds.watchFfi) ||
      (r.responsePercent != null && r.responsePercent < thresholds.lowResponsePercent)
    )
    .map(r => ({
      serialNumber: r.serialNumber,
      facultyName: r.facultyName,
      courseCode: r.courseCode,
      courseName: r.courseName,
      ffiScore: r.ffiScore,
      responsePercent: r.responsePercent,
      reasons: [
        ...(r.ffiScore != null && r.ffiScore < thresholds.lowFfi
          ? [`FFI below ${thresholds.lowFfi}`] : []),
        ...(r.ffiScore != null && r.ffiScore >= thresholds.lowFfi && r.ffiScore < thresholds.watchFfi
          ? [`FFI below watch threshold ${thresholds.watchFfi}`] : []),
        ...(r.responsePercent != null && r.responsePercent < thresholds.lowResponsePercent
          ? [`Response below ${thresholds.lowResponsePercent}%`] : []),
      ],
    }));

  // 6. Build strengths list
  const strengths = records
    .filter(r =>
      r.ffiScore        != null && r.ffiScore >= thresholds.strongFfi &&
      r.responsePercent != null && r.responsePercent >= thresholds.strongResponsePercent
    )
    .map(r => ({
      serialNumber: r.serialNumber,
      facultyName: r.facultyName,
      courseCode: r.courseCode,
      courseName: r.courseName,
      ffiScore: r.ffiScore,
      responsePercent: r.responsePercent,
    }));

  // 7. Build summary
  const summary = {
    recordCount: records.length,
    distinctFacultyCount: facultyMap.size,
    meanFfiRecordLevel: avgFFI,
    meanResponseRecordLevel: avgResponse,
    sourceDfi: metadata.dfi,
    sourceDepartmentAverageResponsePercent: metadata.departmentAverageResponsePercent,
  };

  // 8. Build validation + warnings
  const warnings = [];
  const missingFields = records.filter(r =>
    !r.facultyName || !r.courseCode || !r.courseName ||
    r.ffiScore == null || r.responsePercent == null
  );
  if (missingFields.length > 0) {
    warnings.push({
      message: `${missingFields.length} record(s) have missing fields. Check extraction and source data.`,
    });
  }

  const validation = {
    pageCount: 1,
    expectedRecordCount: options.expectedRecordCount ?? null,
    recordCountMatchesExpected:
      options.expectedRecordCount === undefined ? null : records.length === options.expectedRecordCount,
    allRecordsHaveRequiredFields: records.every(r =>
      r.facultyName && r.courseCode && r.courseName &&
      r.semester        != null &&
      r.registeredStudents != null &&
      r.linksSent      != null &&
      r.responseCount  != null &&
      r.responsePercent != null &&
      r.ffiScore       != null
    ),
    rowWarningCount: warnings.length,
  };

  return {
    reportType: 'department_summary',
    metadata,
    thresholds,
    summary,
    records,
    facultyAnalysis,
    needsAttention,
    strengths,
    validation,
    warnings,
    analyzedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildDepartmentSummaryAnalysis,
  buildSessionName,
  DEFAULT_THRESHOLDS,
};
