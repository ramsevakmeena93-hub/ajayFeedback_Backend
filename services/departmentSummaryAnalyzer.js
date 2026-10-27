const { extractPdfPages } = require("./pdfTypeDetector");

const DEFAULT_THRESHOLDS = {
  lowFfi: 3.0,
  watchFfi: 3.5,
  lowResponsePercent: 65,
  strongFfi: 4.0,
  strongResponsePercent: 80,
};

// These are column boundaries for the landscape MITS Department Summary form.
// Tune them if a different revision of the official PDF changes its layout.
const DEFAULT_COLUMNS = [
  { key: "serialNumber", min: 0, max: 57 },
  { key: "facultyName", min: 57, max: 216 },
  { key: "courseCode", min: 216, max: 294 },
  { key: "courseName", min: 294, max: 512 },
  { key: "semester", min: 512, max: 540 },
  { key: "registeredStudents", min: 540, max: 610 },
  { key: "linksSent", min: 610, max: 678 },
  { key: "responseCount", min: 678, max: 738 },
  { key: "responsePercent", min: 738, max: 798 },
  { key: "ffiScore", min: 798, max: 850 },
];

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const toNumber = (s) => {
  const match = clean(s).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};

function columnForX(x, columns) {
  return columns.find((col) => x >= col.min && x < col.max)?.key || null;
}

function groupItemsByVisualLine(items, yTolerance = 3.2) {
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(a.y - b.y) > yTolerance) return a.y - b.y;
    return a.x - b.x;
  });

  const lines = [];
  for (const item of sorted) {
    let line = lines.find((l) => Math.abs(l.y - item.y) <= yTolerance);
    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }

  return lines
    .map((line) => ({
      y: line.y,
      items: line.items.sort((a, b) => a.x - b.x),
      text: clean(line.items.sort((a, b) => a.x - b.x).map((i) => i.text).join(" ")),
    }))
    .sort((a, b) => a.y - b.y);
}

function parseMetadata(text) {
  const normalized = clean(text);
  const get = (regex) => {
    const match = normalized.match(regex);
    return match ? clean(match[1]) : null;
  };

  return {
    institution: /Madhav Institute of Technology\s*&\s*Science/i.test(normalized)
      ? "Madhav Institute of Technology & Science, Gwalior (M.P.), INDIA"
      : null,
    departmentName: get(/Department Name\s*:\s*(.+?)(?=\s+Department Average Response\s*%?\s*:|\s+DFI\s*:|\s+Programme Name\s*:|$)/i),
    sessionName: get(/Session Name\s*:\s*(.+?)(?=\s+Department Name\s*:|\s+Department Average Response\s*%?\s*:|\s+DFI\s*:|\s+Programme Name\s*:|$)/i),
    programmeName: get(/Programme Name\s*:\s*(.+?)(?=\s+Department Name\s*:|\s+Department Average Response\s*%?\s*:|\s+DFI\s*:|\s+Session Name\s*:|$)/i),
    departmentAverageResponsePercent: toNumber(
      get(/Department Average Response\s*%?\s*:\s*([\d.]+)/i)
    ),
    dfi: toNumber(get(/\bDFI\s*:\s*([\d.]+)/i)),
    coordinatorName: get(/Coordinator Name\s*:\s*(.*?)(?=\s+Session Name\s*:|$)/i),
  };
}

function extractRowsFromPages(pages, columns = DEFAULT_COLUMNS) {
  const records = [];
  const rowWarnings = [];
  const serialSeen = new Set();

  for (const page of pages) {
    const lines = groupItemsByVisualLine(page.items);
    const serialStarts = [];

    for (const line of lines) {
      const serialItem = line.items.find((item) => {
        const col = columnForX(item.x, columns);
        return col === "serialNumber" && /^\d{1,2}$/.test(item.text);
      });

      // The table begins below the report title/header. A serial number is
      // accepted only when it is a standalone integer in the first column.
      if (serialItem) {
        const serial = Number(serialItem.text);
        if (serial >= 1 && serial <= 100) {
          serialStarts.push({ serial, y: line.y });
        }
      }
    }

    const uniqueStarts = [];
    for (const start of serialStarts.sort((a, b) => a.y - b.y)) {
      if (!uniqueStarts.some((x) => x.serial === start.serial && Math.abs(x.y - start.y) < 3)) {
        uniqueStarts.push(start);
      }
    }

    for (let i = 0; i < uniqueStarts.length; i++) {
      const start = uniqueStarts[i];
      const next = uniqueStarts[i + 1];
      // Include wrapped lines until the next serial row; page boundaries are
      // handled independently because each official page starts new rows.
      const rowItems = page.items.filter((item) => {
        const withinY = item.y >= start.y - 1 && (!next || item.y < next.y - 1);
        return withinY;
      });

      const fields = Object.fromEntries(columns.map((c) => [c.key, []]));
      for (const item of rowItems) {
        const key = columnForX(item.x, columns);
        if (key) fields[key].push({ ...item, y: item.y });
      }

      const value = (key) => clean(
        fields[key]
          .sort((a, b) => a.y - b.y || a.x - b.x)
          .map((item) => item.text)
          .join(" ")
      );

      const record = {
        serialNumber: start.serial,
        facultyName: value("facultyName"),
        courseCode: value("courseCode").replace(/\s+/g, " "),
        courseName: value("courseName"),
        semester: toNumber(value("semester")),
        registeredStudents: toNumber(value("registeredStudents")),
        linksSent: toNumber(value("linksSent")),
        responseCount: toNumber(value("responseCount")),
        responsePercent: toNumber(value("responsePercent")),
        ffiScore: toNumber(value("ffiScore")),
        sourcePage: page.pageNumber,
      };

      // Wrapped batch labels sometimes appear as a separate line in the code
      // column. Normalize "30261107- Batch-A" into one value.
      record.courseCode = clean(record.courseCode.replace(/-\s+/g, "-"));

      const required = [
        record.facultyName,
        record.courseCode,
        record.courseName,
      ].every(Boolean) &&
        record.semester !== null &&
        record.registeredStudents !== null &&
        record.linksSent !== null &&
        record.responseCount !== null &&
        record.responsePercent !== null &&
        record.ffiScore !== null;

      if (!required) {
        rowWarnings.push({
          page: page.pageNumber,
          serial: record.serialNumber,
          message: "Row found but one or more fields could not be confidently extracted.",
          extracted: record,
        });
        continue;
      }

      // Preserve separate batches/courses. A repeated serial is an extraction
      // artifact, not a duplicate record.
      const key = `${record.serialNumber}|${record.courseCode}|${record.facultyName}`;
      if (serialSeen.has(key)) continue;
      serialSeen.add(key);
      records.push(record);
    }
  }

  return {
    records: records.sort((a, b) => a.serialNumber - b.serialNumber),
    rowWarnings,
  };
}

function mean(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length
    ? Number((valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2))
    : null;
}

async function analyzeDepartmentSummaryBuffer(buffer, options = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) };
  const parsed = await extractPdfPages(buffer);
  const fullText = parsed.pages.map((p) => p.items.map((i) => i.text).join(" ")).join(" ");
  const metadata = parseMetadata(fullText);
  const { records, rowWarnings } = extractRowsFromPages(
    parsed.pages,
    options.columns || DEFAULT_COLUMNS
  );

  const faculty = new Map();
  for (const record of records) {
    const key = record.facultyName.toLowerCase();
    if (!faculty.has(key)) {
      faculty.set(key, {
        facultyName: record.facultyName,
        courses: [],
        ffiScores: [],
        responsePercents: [],
      });
    }
    const entry = faculty.get(key);
    entry.courses.push(record);
    entry.ffiScores.push(record.ffiScore);
    entry.responsePercents.push(record.responsePercent);
  }

  const facultyAnalysis = [...faculty.values()].map((f) => ({
    facultyName: f.facultyName,
    courseCount: f.courses.length,
    averageFfiScore: mean(f.ffiScores),
    averageResponsePercent: mean(f.responsePercents),
    courses: f.courses,
  }));

  const needsAttention = records.filter(
    (r) => r.ffiScore < thresholds.watchFfi ||
      r.responsePercent < thresholds.lowResponsePercent
  ).map((r) => ({
    serialNumber: r.serialNumber,
    facultyName: r.facultyName,
    courseCode: r.courseCode,
    courseName: r.courseName,
    ffiScore: r.ffiScore,
    responsePercent: r.responsePercent,
    reasons: [
      ...(r.ffiScore < thresholds.lowFfi ? [`FFI below ${thresholds.lowFfi}`] : []),
      ...(r.ffiScore >= thresholds.lowFfi && r.ffiScore < thresholds.watchFfi
        ? [`FFI below watch threshold ${thresholds.watchFfi}`] : []),
      ...(r.responsePercent < thresholds.lowResponsePercent
        ? [`Response below ${thresholds.lowResponsePercent}%`] : []),
    ],
  }));

  const strengths = records.filter(
    (r) => r.ffiScore >= thresholds.strongFfi &&
      r.responsePercent >= thresholds.strongResponsePercent
  ).map((r) => ({
    serialNumber: r.serialNumber,
    facultyName: r.facultyName,
    courseCode: r.courseCode,
    courseName: r.courseName,
    ffiScore: r.ffiScore,
    responsePercent: r.responsePercent,
  }));

  const serials = new Set(records.map((r) => r.serialNumber));
  const expected = options.expectedRecordCount;
  const warnings = [...rowWarnings];

  if (expected !== undefined && records.length !== expected) {
    warnings.push({
      message: `Expected ${expected} records, extracted ${records.length}. Do not treat extraction as verified.`,
    });
  }
  if (records.length && records.length !== serials.size) {
    warnings.push({ message: "Duplicate serial numbers detected. Check extraction and source PDF." });
  }
  if (records.some((r) => r.responseCount > r.linksSent)) {
    warnings.push({ message: "At least one response count exceeds links sent; verify the extracted columns." });
  }
  if (records.some((r) => r.responsePercent < 0 || r.responsePercent > 100)) {
    warnings.push({ message: "At least one response percentage is outside 0–100%." });
  }

  return {
    reportType: "department_summary",
    metadata,
    thresholds,
    summary: {
      recordCount: records.length,
      distinctFacultyCount: faculty.size,
      meanFfiRecordLevel: mean(records.map((r) => r.ffiScore)),
      meanResponseRecordLevel: mean(records.map((r) => r.responsePercent)),
      sourceDfi: metadata.dfi,
      sourceDepartmentAverageResponsePercent: metadata.departmentAverageResponsePercent,
    },
    records,
    facultyAnalysis,
    needsAttention,
    strengths,
    validation: {
      pageCount: parsed.pageCount,
      expectedRecordCount: expected ?? null,
      recordCountMatchesExpected: expected === undefined ? null : records.length === expected,
      allRecordsHaveRequiredFields: records.every((r) =>
        r.facultyName && r.courseCode && r.courseName &&
        Number.isFinite(r.semester) &&
        Number.isFinite(r.registeredStudents) &&
        Number.isFinite(r.linksSent) &&
        Number.isFinite(r.responseCount) &&
        Number.isFinite(r.responsePercent) &&
        Number.isFinite(r.ffiScore)
      ),
      rowWarningCount: rowWarnings.length,
    },
    warnings,
    analyzedAt: new Date().toISOString(),
  };
}

module.exports = {
  analyzeDepartmentSummaryBuffer,
  extractRowsFromPages,
  parseMetadata,
  DEFAULT_THRESHOLDS,
  DEFAULT_COLUMNS,
};
