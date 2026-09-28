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

// module.exports moved to bottom of file — see splitPdfByFaculty export

/**
 * splitPdfByFaculty
 * Splits a multi-faculty PDF into individual buffers, one per faculty.
 * Each faculty's pages are detected by locating their name in the page text.
 *
 * Returns an array of:
 *   { facultyName, subjectCode, buffer }
 *
 * If the PDF has 3 or fewer pages (already individual), returns a single entry
 * with the full buffer.
 */
async function splitPdfByFaculty(buffer) {
  try {
    const uint8    = new Uint8Array(buffer);
    const doc      = await pdfjsLib.getDocument({ data: uint8, verbosity: 0 }).promise;
    const { PDFDocument } = require('pdf-lib');

    // Single-faculty PDF — return as-is
    if (doc.numPages <= 3) {
      return [{ facultyName: null, subjectCode: null, buffer }];
    }

    // Step 1: Extract text + detect faculty boundaries per page
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc   = await page.getTextContent();
      const text = tc.items.map(t => t.str).join(' ');

      // Detect if this page starts a new faculty section
      // Look for the MITS feedback form header row
      const isHeader =
        /Faculty\s+Name.*Course\s+Code/i.test(text) ||
        /Faculty\s+Name.*Code\s*\/\s*Batch/i.test(text);

      // Extract faculty name from the data row below the header
      let facultyName = null;
      let subjectCode = null;

      const nameMatch = text.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z.]+){1,4})\s+(\d{5,})/);
      if (nameMatch) {
        facultyName = nameMatch[1].trim();
        subjectCode = nameMatch[2].trim();
      }

      pages.push({ pageIndex: i - 1, text, isHeader, facultyName, subjectCode });
    }

    // Step 2: Group pages into faculty sections
    // A new section starts when we find a header row or a new faculty name
    const sections = [];
    let current = null;

    for (const page of pages) {
      if (page.facultyName && (!current || page.facultyName !== current.facultyName)) {
        // New faculty section
        if (current) sections.push(current);
        current = {
          facultyName: page.facultyName,
          subjectCode: page.subjectCode,
          pageIndices: [page.pageIndex],
        };
      } else if (current) {
        current.pageIndices.push(page.pageIndex);
      } else {
        // First pages before any faculty name detected
        current = { facultyName: null, subjectCode: null, pageIndices: [page.pageIndex] };
      }
    }
    if (current) sections.push(current);

    // If we couldn't split (only 1 section or no names found), return full buffer
    if (sections.length <= 1) {
      return [{ facultyName: null, subjectCode: null, buffer }];
    }

    // Step 3: Build individual PDF buffers for each faculty
    const srcDoc  = await PDFDocument.load(buffer);
    const results = [];

    for (const section of sections) {
      if (!section.facultyName || section.pageIndices.length === 0) continue;

      try {
        const subDoc  = await PDFDocument.create();
        const copied  = await subDoc.copyPages(srcDoc, section.pageIndices);
        copied.forEach(p => subDoc.addPage(p));
        const slicedBuffer = Buffer.from(await subDoc.save());

        results.push({
          facultyName: section.facultyName,
          subjectCode: section.subjectCode,
          buffer:      slicedBuffer,
        });
      } catch (e) {
        console.warn(`[PDF Split] Failed to slice pages for ${section.facultyName}:`, e.message);
      }
    }

    if (results.length === 0) {
      return [{ facultyName: null, subjectCode: null, buffer }];
    }

    console.log(`[PDF Split] Split into ${results.length} faculty sections`);
    return results;
  } catch (err) {
    console.warn('[PDF Split] Error splitting PDF:', err.message);
    return [{ facultyName: null, subjectCode: null, buffer }];
  }
}

module.exports = { slicePdfForReport, splitPdfByFaculty };
