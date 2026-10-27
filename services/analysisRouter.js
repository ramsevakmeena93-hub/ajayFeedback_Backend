const { detectPdfType } = require("./pdfTypeDetector");
const { analyzeDepartmentSummaryBuffer } = require("./departmentSummaryAnalyzer");
const { generateDepartmentSummaryPdf } = require("./departmentReportGenerator");

// Change this require path to the location of your existing comments analyzer.
const existingCommentsAnalyzer = require("./pdfAnalyzer");

async function analyzeUploadedPdf(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new TypeError("A non-empty PDF buffer is required.");
  }

  const detected = await detectPdfType(buffer);

  if (detected.type === "department_summary") {
    const analysis = await analyzeDepartmentSummaryBuffer(buffer, {
      expectedRecordCount: options.expectedRecordCount,
      thresholds: options.thresholds,
      columns: options.columns,
    });

    return {
      reportType: "department_summary",
      detection: { type: detected.type, pageCount: detected.pageCount },
      analysis,
    };
  }

  // Preserve existing student feedback / action-taken analysis.
  const analysis = await existingCommentsAnalyzer.analyzePDFBuffer(buffer);
  return {
    reportType: detected.type,
    detection: { type: detected.type, pageCount: detected.pageCount },
    analysis,
  };
}

module.exports = { analyzeUploadedPdf, generateDepartmentSummaryPdf };
