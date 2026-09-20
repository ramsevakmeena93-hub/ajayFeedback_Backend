const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
pdfjsLib.GlobalWorkerOptions.workerSrc = false;
const { PDFDocument } = require("pdf-lib");

/**
 * Slices a multi-course/multi-faculty PDF buffer so only the pages
 * corresponding to the specified report (subjectCode / facultyName) are extracted.
 *
 * @param {Buffer} buffer
 * @param {Object} target - { subjectCode, facultyName }
 * @returns {Promise<Buffer>} - Sliced PDF buffer containing only that faculty's evaluation pages
 */
async function slicePdfForReport(buffer, { subjectCode, facultyName } = {}) {
  try {
    const uint8 = new Uint8Array(buffer);
    const doc = await pdfjsLib.getDocument({ data: uint8, verbosity: 0 }).promise;

    // If PDF has only 1-3 pages total, it is already an individual file
    if (doc.numPages <= 3) return buffer;

    const cleanSubject = (subjectCode || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const cleanFaculty = (facultyName || "").replace(/^(dr\.|prof\.|mr\.|ms\.|mrs\.)\s*/i, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

    const matchingIndices = [];

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const str = tc.items.map(item => item.str).join(" ");

      // Exclude Action Taken Report compilation summary pages
      const isSummaryTable = str.includes("Action Taken Report") && (str.includes("Average FFI") || str.includes("Feedback Submitted:"));
      if (isSummaryTable) continue;

      const cleanStr = str.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

      // Check if page contains this specific subjectCode or facultyName in its header
      const matchesSubject = cleanSubject && cleanStr.includes(cleanSubject);
      const matchesFaculty = cleanFaculty && cleanStr.includes(cleanFaculty);

      if (matchesSubject || (matchesFaculty && !cleanSubject)) {
        matchingIndices.push(i - 1);
      }
    }

    if (matchingIndices.length === 0) {
      return buffer; // Fallback to entire buffer if no specific pages isolated
    }

    const srcDoc = await PDFDocument.load(buffer);
    const subDoc = await PDFDocument.create();
    const copied = await subDoc.copyPages(srcDoc, matchingIndices);
    copied.forEach(p => subDoc.addPage(p));
    return Buffer.from(await subDoc.save());
  } catch (err) {
    console.warn("[PDF Slice] Error slicing pages:", err.message);
    return buffer;
  }
}

module.exports = { slicePdfForReport };
