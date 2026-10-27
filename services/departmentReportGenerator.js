const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const PAGE = { width: 841.68, height: 595.44 }; // landscape A4 points
const MARGIN = 17;
const COLORS = {
  headerFill: "#D3D3D3",
  border: "#222222",
  text: "#111111",
  muted: "#333333",
};

function safeText(value, fallback = "") {
  return value === null || value === undefined ? fallback : String(value);
}

function drawCell(doc, x, y, w, h, text, options = {}) {
  doc.save();
  doc.lineWidth(options.lineWidth || 0.8)
    .strokeColor(COLORS.border)
    .fillColor(options.fill || "#FFFFFF")
    .rect(x, y, w, h)
    .fillAndStroke();

  doc.fillColor(options.color || COLORS.text)
    .font(options.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(options.fontSize || 9)
    .text(safeText(text), x + (options.padX ?? 3), y + (options.padY ?? 4), {
      width: w - 2 * (options.padX ?? 3),
      height: h - 2 * (options.padY ?? 4),
      align: options.align || "left",
      valign: "center",
      lineBreak: true,
      ellipsis: false,
    });
  doc.restore();
}

function drawInstitutionHeader(doc, options = {}) {
  // Use the full MITS header image (contains logos, Hindi text, English text, branding)
  // as a full-width banner — no manual text rendering needed for the header.
  const headerImage = options.headerImage ||
    path.join(__dirname, "..", "assets", "mits-header.png");

  const HEADER_H = 72; // rendered height in points — keeps proportions on landscape A4

  if (headerImage && fs.existsSync(headerImage)) {
    // Draw a white background behind image so transparent PNGs look clean
    doc.save()
      .rect(0, 0, PAGE.width, HEADER_H)
      .fillColor("#FFFFFF")
      .fill()
      .restore();

    // Stretch image to full page width
    doc.image(headerImage, 0, 0, {
      width: PAGE.width,
      height: HEADER_H,
    });
  } else {
    // Fallback: plain text header if image is missing
    doc.font("Times-Bold").fontSize(11).fillColor("#29256F")
      .text("Madhav Institute of Technology & Science, Gwalior (M.P.), INDIA",
        0, 14, { width: PAGE.width, align: "center" });
    doc.font("Times-Bold").fontSize(9.5).fillColor("#9A1B1B")
      .text("Deemed University  |  NAAC ACCREDITED WITH A++ GRADE",
        0, 30, { width: PAGE.width, align: "center" });
  }

  // Thin divider below header image
  doc.save()
    .moveTo(MARGIN, HEADER_H + 2)
    .lineTo(PAGE.width - MARGIN, HEADER_H + 2)
    .lineWidth(0.6)
    .strokeColor("#29256F")
    .stroke()
    .restore();

  // Report title below divider
  doc.fillColor(COLORS.text).font("Times-Bold").fontSize(11)
    .text("Department Summary", 0, HEADER_H + 6, { width: PAGE.width, align: "center" });
}

function drawMetadataTable(doc, metadata, y = 97) {
  const x = MARGIN;
  const widths = [154, 309, 189, PAGE.width - MARGIN * 2 - 154 - 309 - 189];
  const heights = [31, 29, 29];
  const rows = [
    [
      ["Coordinator Name :", safeText(metadata.coordinatorName)],
      ["Session Name :", safeText(metadata.sessionName)],
    ],
    [
      ["Department Name :", safeText(metadata.departmentName)],
      ["Department Average Response % :", safeText(metadata.departmentAverageResponsePercent)],
    ],
    [
      ["DFI :", safeText(metadata.dfi)],
      ["Programme Name :", safeText(metadata.programmeName)],
    ],
  ];

  let cy = y;
  for (let r = 0; r < rows.length; r++) {
    const h = heights[r];
    const leftLabel = rows[r][0][0];
    const leftValue = rows[r][0][1];
    const rightLabel = rows[r][1][0];
    const rightValue = rows[r][1][1];

    drawCell(doc, x, cy, widths[0], h, leftLabel, { fill: COLORS.headerFill, bold: true, fontSize: 8.5 });
    drawCell(doc, x + widths[0], cy, widths[1], h, leftValue, { fontSize: 8.5 });
    drawCell(doc, x + widths[0] + widths[1], cy, widths[2], h, rightLabel, { fill: COLORS.headerFill, bold: true, fontSize: 8.5 });
    drawCell(doc, x + widths[0] + widths[1] + widths[2], cy, widths[3], h, rightValue, { fontSize: 8.5 });
    cy += h;
  }
  return cy;
}

const TABLE_COLUMNS = [
  { key: "serialNumber", label: "S.NO", width: 40, align: "center" },
  { key: "facultyName", label: "Faculty Name", width: 158 },
  { key: "courseCode", label: "Course code", width: 76 },
  { key: "courseName", label: "Course Name", width: 218 },
  { key: "semester", label: "Sem", width: 28, align: "center" },
  { key: "registeredStudents", label: "Registered\nStudents", width: 72, align: "center" },
  { key: "linksSent", label: "Link sent\nto\nStudents", width: 66, align: "center" },
  { key: "responseCount", label: "Response", width: 61, align: "center" },
  { key: "responsePercent", label: "%\nResponse", width: 60, align: "center" },
  { key: "ffiScore", label: "FFI", width: 34, align: "center" },
];

function drawTableHeader(doc, y) {
  let x = MARGIN;
  const h = 40;
  for (const col of TABLE_COLUMNS) {
    drawCell(doc, x, y, col.width, h, col.label, {
      fill: COLORS.headerFill,
      bold: true,
      fontSize: 8.5,
      align: "center",
      padX: 2,
      padY: 3,
    });
    x += col.width;
  }
  return y + h;
}

function drawRecordRow(doc, record, y, h = 30) {
  let x = MARGIN;
  for (const col of TABLE_COLUMNS) {
    let value = record[col.key];
    if (col.key === "courseCode") {
      value = safeText(value).replace(/(Batch-[A-Z])/i, "\n$1");
    }
    if (col.key === "responsePercent" || col.key === "ffiScore") {
      value = value === null || value === undefined ? "" : Number(value).toFixed(2);
    }
    drawCell(doc, x, y, col.width, h, safeText(value), {
      fontSize: 8.2,
      align: col.align || "left",
      padX: 3,
      padY: 3,
    });
    x += col.width;
  }
  return y + h;
}

function drawSignatures(doc, y) {
  const baseline = Math.max(y + 12, 520);
  doc.font("Times-Roman").fontSize(8.5).fillColor(COLORS.text);
  doc.text("Coordinator's Name & Signature", 12, baseline, { width: 210 });
  doc.text("HOD Name & Signature", 380, baseline, { width: 190 });
  doc.text("Pro-VC", PAGE.width - 58, baseline, { width: 50, align: "right" });
  doc.text("Date", 12, baseline + 12);
  doc.text("Date", 380, baseline + 12);
}

function generateDepartmentSummaryPdf(analysis, outputPath, options = {}) {
  if (!analysis || analysis.reportType !== "department_summary") {
    throw new TypeError("Expected department_summary analysis result.");
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [PAGE.width, PAGE.height],
      margin: 0,
      autoFirstPage: true,
      bufferPages: false,
      info: {
        Title: "MITS Department Summary",
        Author: "MITS Gwalior Feedback System",
        Subject: "Department Summary",
      },
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const records = analysis.records || [];
    const rowsPerPage = options.rowsPerPage || [9, 14, 8];
    let index = 0;
    let pageIndex = 0;

    do {
      if (pageIndex > 0) doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
      drawInstitutionHeader(doc, options);
      let y = 97;

      if (pageIndex === 0 || options.repeatMetadata) {
        y = drawMetadataTable(doc, analysis.metadata, y);
        y += 8;
      } else {
        y = 97;
      }

      y = drawTableHeader(doc, y);
      const pageLimit = rowsPerPage[pageIndex] ?? 12;
      let rendered = 0;

      while (index < records.length && rendered < pageLimit) {
        const record = records[index];
        const courseCode = safeText(record.courseCode);
        const courseName = safeText(record.courseName);
        const rowHeight = Math.max(
          30,
          courseCode.includes("Batch-") || courseName.length > 42 ? 32 : 30
        );
        if (y + rowHeight > 505) break;
        y = drawRecordRow(doc, record, y, rowHeight);
        index++;
        rendered++;
      }

      drawSignatures(doc, y);
      pageIndex++;

      // Avoid an infinite loop if custom page sizing cannot fit a row.
      if (index < records.length && rendered === 0) {
        doc.end();
        reject(new Error("Unable to fit any rows on the report page. Adjust page layout."));
        return;
      }
    } while (index < records.length);

    if (records.length === 0) {
      doc.font("Times-Roman").fontSize(10).text(
        "No confidently extracted records. Check extraction warnings before generating an official report.",
        25, 180, { width: PAGE.width - 50 }
      );
    }

    doc.end();
    stream.on("finish", () => resolve(outputPath));
    stream.on("error", reject);
  });
}

module.exports = { generateDepartmentSummaryPdf };
