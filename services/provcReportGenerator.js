/**
 * provcReportGenerator.js
 *
 * Generates a landscape A4 "Faculty Feedback Report (Course Wise)"
 * PDF that includes Pro-VC comments alongside HOD action-taken and
 * student feedback — matching the reference image layout.
 *
 * Uses PDFKit (already in project dependencies).
 */

'use strict';

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// ── Asset paths ────────────────────────────────────────────────────────────
const MITS_LOGO_LEFT  = path.join(__dirname, '../../src/assets/mits-logo.png');
const MITS_HEADER_PNG = path.join(__dirname, '../assets/mits-header.png');

// ── Page geometry (landscape A4) ──────────────────────────────────────────
const PAGE_W = 841.89;
const PAGE_H = 595.28;
const MARGIN  = 18;

// ── Brand colours ─────────────────────────────────────────────────────────
const C = {
  darkBlue  : '#1B3D7A',
  midBlue   : '#2952A3',
  red       : '#C0392B',
  green     : '#1E6B3C',
  headerFill: '#1B3D7A',   // dark navy row header
  rowAlt    : '#F9FBFF',
  rowGold   : '#FFF8E1',   // FFI cell highlight
  border    : '#CCCCCC',
  textDark  : '#111111',
  textMid   : '#333333',
  textGrey  : '#666666',
  ffiGreen  : '#1E8449',
  ffiAmber  : '#D35400',
  ffiRed    : '#C0392B',
  commentBg : '#EAF4FF',   // Pro-VC comments column tint
};

// ── Colour helpers ─────────────────────────────────────────────────────────
function ffiColor(score) {
  if (!score) return C.textDark;
  if (score >= 4.0) return C.ffiGreen;
  if (score >= 3.5) return C.ffiAmber;
  return C.ffiRed;
}

// ── Text helpers ───────────────────────────────────────────────────────────
function safe(v, fallback = '') {
  return v == null ? fallback : String(v).trim() || fallback;
}

/**
 * Draw text wrapping inside a rectangular cell.
 * Returns the actual text height used (for dynamic row sizing).
 */
function cellText(doc, text, x, y, w, opts = {}) {
  const {
    fontSize  = 8,
    bold      = false,
    color     = C.textDark,
    align     = 'left',
    padX      = 4,
    padY      = 3,
    maxLines  = 999,
    bullet    = false,
  } = opts;

  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
     .fontSize(fontSize)
     .fillColor(color);

  const tx = x + padX;
  const tw = w - padX * 2;

  if (bullet && text.startsWith('•')) {
    // draw bullet separately, indent rest
    doc.text('•', tx, y + padY, { width: 8, continued: false });
    doc.text(text.slice(1).trim(), tx + 10, y + padY, {
      width : tw - 10,
      align,
      lineBreak : true,
      ellipsis  : false,
    });
  } else {
    doc.text(safe(text), tx, y + padY, {
      width : tw,
      align,
      lineBreak : true,
      ellipsis  : false,
    });
  }
}

/**
 * Estimate how many pt the text will occupy in a column of width w.
 */
function estimateTextHeight(doc, text, w, fontSize = 8, padX = 4, padY = 3) {
  if (!text) return fontSize + padY * 2;
  doc.font('Helvetica').fontSize(fontSize);
  const h = doc.heightOfString(safe(text), { width: w - padX * 2 });
  return h + padY * 2;
}

/**
 * Estimate height of a bullet-list of comments.
 */
function estimateBulletHeight(doc, items, w, fontSize = 8) {
  if (!items || !items.length) return 14;
  let total = 3; // top padding
  for (const item of items) {
    const h = doc.heightOfString(safe(item), { width: w - 14 });
    total += h + 3;
  }
  return total + 3;
}

// ── Cell border drawing ────────────────────────────────────────────────────
function drawRect(doc, x, y, w, h, fillColor) {
  doc.save()
     .rect(x, y, w, h)
     .fillAndStroke(fillColor || 'white', C.border)
     .restore();
}

// ── Draw institution header ────────────────────────────────────────────────
function drawHeader(doc) {
  const logoSize = 58;

  // Left logo
  if (fs.existsSync(MITS_LOGO_LEFT)) {
    doc.image(MITS_LOGO_LEFT, MARGIN, 8, { fit: [logoSize, logoSize] });
  }

  // If the existing mits-header PNG covers the full header strip, use it
  if (fs.existsSync(MITS_HEADER_PNG)) {
    // use header PNG spanning centre — it's already a full-width banner
    doc.image(MITS_HEADER_PNG, MARGIN + logoSize + 4, 8, {
      width : PAGE_W - (MARGIN + logoSize + 4) * 2,
      height: 68,
    });
  } else {
    // fallback: draw text header
    const cx = MARGIN + logoSize + 4;
    const cw = PAGE_W - cx - logoSize - 24;

    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.darkBlue)
       .text('माधव प्रौद्योगिकी एवं विज्ञान संस्थान, ग्वालियर (म.प्र.), भारत', cx, 10, { width: cw, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.darkBlue)
       .text('Madhav Institute of Technology & Science, Gwalior (M.P.), INDIA', cx, 23, { width: cw, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.red)
       .text('Deemed University', cx, 36, { width: cw, align: 'center' });
    doc.font('Helvetica').fontSize(8).fillColor(C.green)
       .text('(Declared under Distinct Category by Ministry of Education, Government of India)', cx, 47, { width: cw, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.red)
       .text('NAAC ACCREDITED WITH A++ GRADE', cx, 58, { width: cw, align: 'center' });
  }
}

// ── Report title bar ───────────────────────────────────────────────────────
function drawTitleBar(doc, y) {
  const bw = PAGE_W - MARGIN * 2;
  doc.rect(MARGIN, y, bw, 18)
     .fill(C.headerFill);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor('white')
     .text('FACULTY FEEDBACK REPORT (COURSE WISE)', MARGIN, y + 4, { width: bw, align: 'center' });
  return y + 18;
}

// ── Faculty info block ─────────────────────────────────────────────────────
function drawInfoBlock(doc, info, y) {
  const bw   = PAGE_W - MARGIN * 2;
  const half = bw / 2;
  const rh   = 14;  // row height
  const rows = [
    ['Faculty Name', info.facultyName,    'Academic Session', info.session],
    ['Designation',  info.designation,    'Programme',        info.programme],
    ['Department',   info.department,     'Dept. Avg Response %', info.avgResponse],
    ['',             '',                  'DFI (Department)', info.dfi],
  ];

  let cy = y;
  for (const [lk, lv, rk, rv] of rows) {
    // left cell
    drawRect(doc, MARGIN,          cy, half, rh, lk ? '#EEF2FF' : 'white');
    drawRect(doc, MARGIN + half,   cy, half, rh, 'white');
    if (lk) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.textDark)
         .text(lk, MARGIN + 3, cy + 3, { width: 90 });
      doc.font('Helvetica').fontSize(8).fillColor(C.textDark)
         .text(safe(lv), MARGIN + 96, cy + 3, { width: half - 100 });
    }
    if (rk) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.textDark)
         .text(rk, MARGIN + half + 3, cy + 3, { width: 110 });
      doc.font('Helvetica').fontSize(8).fillColor(C.textDark)
         .text(safe(rv), MARGIN + half + 116, cy + 3, { width: half - 120 });
    }
    cy += rh;
  }
  return cy;
}

// ── Column definitions ─────────────────────────────────────────────────────
// Total usable width: PAGE_W - 2*MARGIN = 805.89 pt
//
//  S.No | Course Code | Course Name | Reg | Sent | Resp | % Resp | FFI | Student Comments | HOD Comments | Pro-VC Comments
//
const COLS = [
  { key: 'sno',        label: 'S.No',                        w: 24,  align: 'center' },
  { key: 'code',       label: 'Course Code\n(Section)',       w: 58,  align: 'center' },
  { key: 'name',       label: 'Course Name',                  w: 95,  align: 'left'   },
  { key: 'reg',        label: 'Registered\nStudents',         w: 38,  align: 'center' },
  { key: 'sent',       label: 'Link Sent\nto Students',       w: 38,  align: 'center' },
  { key: 'resp',       label: 'Response',                     w: 36,  align: 'center' },
  { key: 'pct',        label: '%\nResponse',                  w: 36,  align: 'center' },
  { key: 'ffi',        label: 'FFI\nScore',                   w: 34,  align: 'center' },
  { key: 'student',    label: 'Student Comments\n(Key Points)',w: 155, align: 'left'   },
  { key: 'hod',        label: 'HOD Comments\n(Action Taken / Remarks)', w: 155, align: 'left' },
  { key: 'provc',      label: 'Pro-VC Comments',              w: 136, align: 'left'   },
];

// ── Table header row ───────────────────────────────────────────────────────
function drawTableHeader(doc, y) {
  const HEADER_H = 28;
  let x = MARGIN;

  for (const col of COLS) {
    // header background
    doc.rect(x, y, col.w, HEADER_H).fill(C.headerFill).stroke(C.border);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('white');
    doc.text(col.label, x + 2, y + 3, {
      width    : col.w - 4,
      align    : 'center',
      lineBreak: true,
    });
    x += col.w;
  }
  return y + HEADER_H;
}

// ── Draw a single data row ─────────────────────────────────────────────────
function drawDataRow(doc, rowData, y, rowH, rowIndex) {
  let x = MARGIN;
  const isEven = rowIndex % 2 === 0;

  for (const col of COLS) {
    const value = rowData[col.key];
    let bg = isEven ? 'white' : C.rowAlt;
    if (col.key === 'provc') bg = C.commentBg;
    if (col.key === 'ffi') bg = C.rowGold;

    doc.rect(x, y, col.w, rowH).fill(bg).stroke(C.border);

    if (col.key === 'student' || col.key === 'hod' || col.key === 'provc') {
      // Bullet list
      const items = Array.isArray(value) ? value : (value ? [value] : []);
      let ty = y + 3;
      for (const item of items) {
        if (!item || !item.trim()) continue;
        const cleaned = item.trim();
        const lineH = doc.heightOfString(cleaned, { width: col.w - 14 });
        doc.font('Helvetica').fontSize(7.5).fillColor(C.textDark);
        doc.text('•', x + 3, ty, { width: 8, continued: false });
        doc.text(cleaned, x + 12, ty, { width: col.w - 15, lineBreak: true });
        ty += lineH + 2;
        if (ty > y + rowH - 6) break;
      }
    } else if (col.key === 'ffi') {
      const score = parseFloat(safe(value, '0'));
      doc.font('Helvetica-Bold').fontSize(9).fillColor(ffiColor(score));
      doc.text(safe(value), x + 2, y + (rowH - 10) / 2, { width: col.w - 4, align: 'center' });
    } else {
      doc.font('Helvetica').fontSize(7.5).fillColor(C.textDark);
      doc.text(safe(value), x + 2, y + 3, { width: col.w - 4, align: col.align, lineBreak: true });
    }

    x += col.w;
  }
}

// ── Calculate row height for a data row ──────────────────────────────────
function calcRowHeight(doc, rowData) {
  const MIN_H = 32;
  let maxH = MIN_H;

  for (const col of COLS) {
    const value = rowData[col.key];
    let h = MIN_H;

    if (col.key === 'student' || col.key === 'hod' || col.key === 'provc') {
      const items = Array.isArray(value) ? value : (value ? [value] : []);
      let total = 6;
      for (const item of items) {
        if (!item || !item.trim()) continue;
        doc.font('Helvetica').fontSize(7.5);
        total += doc.heightOfString(item.trim(), { width: col.w - 14 }) + 2;
      }
      h = Math.max(MIN_H, total);
    } else if (value) {
      doc.font('Helvetica').fontSize(7.5);
      const th = doc.heightOfString(safe(value), { width: col.w - 4 }) + 6;
      h = Math.max(MIN_H, th);
    }

    maxH = Math.max(maxH, h);
  }

  return maxH;
}

// ── Signature block ────────────────────────────────────────────────────────
function drawSignatures(doc, y, vcUser, approvedDate) {
  const sigY = Math.max(y + 8, PAGE_H - 70);

  // HOD side (left)
  doc.font('Helvetica').fontSize(8).fillColor(C.textDark);
  doc.text('HOD Name & Signature', MARGIN, sigY, { width: 180 });
  doc.moveTo(MARGIN, sigY + 18).lineTo(MARGIN + 160, sigY + 18).stroke(C.textDark);
  doc.text('Date :  _______________', MARGIN, sigY + 22, { width: 180 });

  // Pro-VC side (right)
  const rx = PAGE_W - MARGIN - 160;
  if (vcUser?.signatureImage) {
    // signature already embedded by caller if available
  }
  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.darkBlue);
  doc.text(safe(vcUser?.name, 'Prof. Rajeev K. Singh'), rx, sigY - 2, { width: 160, align: 'right' });
  doc.font('Helvetica').fontSize(8).fillColor(C.textDark);
  doc.text('Pro-VC', rx, sigY + 10, { width: 160, align: 'right' });
  doc.text('MITS, Gwalior', rx, sigY + 20, { width: 160, align: 'right' });
  doc.text(`Date :  ${safe(approvedDate, new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }))}`, rx, sigY + 30, { width: 160, align: 'right' });
}

// ── Main generator function ────────────────────────────────────────────────
/**
 * Generate a Pro-VC comments PDF for one faculty member.
 *
 * @param {object} params
 * @param {object} params.faculty       – { name, designation, department }
 * @param {object} params.submission    – { academicYear, session, provcComments }
 * @param {Array}  params.reports       – FacultyReport docs for this faculty
 * @param {object} [params.hodUser]     – HOD user doc { name }
 * @param {object} [params.vcUser]      – VC user doc { name, signatureImage }
 * @param {string} [params.approvedDate]
 * @param {number} [params.avgResponse] – department avg response %
 * @param {number} [params.dfi]         – department FFI
 * @returns {Promise<Buffer>}
 */
async function generateProVCReport({
  faculty,
  submission,
  reports,
  hodUser,
  vcUser,
  approvedDate,
  avgResponse,
  dfi,
}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size    : [PAGE_W, PAGE_H],
      layout  : 'landscape',
      margins : { top: 0, bottom: 0, left: 0, right: 0 },
      bufferPages: true,
      autoFirstPage: true,
      info: {
        Title  : `Pro-VC Faculty Feedback Report – ${faculty.name}`,
        Author : 'MITS Gwalior Feedback System',
        Subject: 'Faculty Feedback Report (Course Wise)',
      },
    });

    doc.on('data',  chunk => chunks.push(chunk));
    doc.on('end',   ()    => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Session label
    const sessionLabel =
      submission.session === 'jan-may' ? `${submission.academicYear || ''} (Jan–Jun)` :
      submission.session === 'jul-dec' ? `${submission.academicYear || ''} (July–Dec)` :
      safe(submission.academicYear);

    // Collect the provcComments lookup
    const provcMap = {};
    (submission.provcComments || []).forEach(c => {
      const k = `${(c.facultyName || '').toLowerCase()}|${(c.subjectCode || '').toLowerCase()}`;
      provcMap[k] = c.comment;
    });

    function getProvcComment(facultyName, subjectCode) {
      const k = `${(facultyName || '').toLowerCase()}|${(subjectCode || '').toLowerCase()}`;
      return provcMap[k] || '';
    }

    // Build row data
    const rowsData = reports.map((r, idx) => {
      const studentItems = [
        ...(r.appreciation     || []).filter(c => c && c.trim().split(/\s+/).length >= 4).slice(0, 4),
        ...(r.commentsNeedingAttention || []).filter(c => c && c.trim().split(/\s+/).length >= 4).slice(0, 4),
      ].slice(0, 6);

      // HOD comments: hodRemarks + actionTaken
      const hodItems = [];
      if (r.hodRemarks && r.hodRemarks.trim()) {
        r.hodRemarks.split(/\n|\.(?=\s)/).map(s => s.trim()).filter(Boolean).slice(0, 3).forEach(s => hodItems.push(s));
      }
      if (r.actionTaken && r.actionTaken.trim()) {
        r.actionTaken.split(/\n|\d+\.\s+/).map(s => s.trim()).filter(Boolean).slice(0, 3).forEach(s => hodItems.push(s));
      }
      if (!hodItems.length) hodItems.push('—');

      const provcRaw = getProvcComment(r.facultyName, r.subjectCode);
      const provcItems = provcRaw
        ? provcRaw.split(/\n|\.(?=\s)/).map(s => s.trim()).filter(Boolean)
        : [];

      const pct = r.responsePercent != null
        ? Number(r.responsePercent).toFixed(2)
        : (r.responseCount && r.registeredStudents
            ? ((r.responseCount / r.registeredStudents) * 100).toFixed(2)
            : '—');

      return {
        sno    : String(idx + 1),
        code   : safe(r.subjectCode),
        name   : safe(r.programme || r.subjectCode),
        reg    : safe(r.registeredStudents, '—'),
        sent   : safe(r.linkSent || r.linksSent, '—'),
        resp   : safe(r.responseCount, '—'),
        pct    : pct,
        ffi    : r.ffiScore != null ? Number(r.ffiScore).toFixed(2) : '—',
        student: studentItems,
        hod    : hodItems,
        provc  : provcItems,
      };
    });

    // ── Page 1 ──────────────────────────────────────────────────────────────
    let y = MARGIN;

    // Header
    drawHeader(doc);
    y = 78;

    // Title bar
    y = drawTitleBar(doc, y);
    y += 2;

    // Info block
    y = drawInfoBlock(doc, {
      facultyName : safe(faculty.name),
      designation : safe(faculty.designation, 'Faculty'),
      department  : safe(faculty.department),
      session     : sessionLabel,
      programme   : safe(reports[0]?.programme, 'B.Tech.'),
      avgResponse : avgResponse != null ? Number(avgResponse).toFixed(2) : '—',
      dfi         : dfi != null ? Number(dfi).toFixed(2) : '—',
    }, y);
    y += 4;

    // Table header
    y = drawTableHeader(doc, y);

    // Data rows — paginate
    const BOTTOM_LIMIT = PAGE_H - 75; // leave room for signatures

    for (let i = 0; i < rowsData.length; i++) {
      const rh = calcRowHeight(doc, rowsData[i]);

      if (y + rh > BOTTOM_LIMIT) {
        // New page
        doc.addPage({ size: [PAGE_W, PAGE_H], layout: 'landscape', margins: { top: 0, bottom: 0, left: 0, right: 0 } });
        y = MARGIN;
        drawHeader(doc);
        y = 78;
        y = drawTitleBar(doc, y);
        y += 2;
        y = drawTableHeader(doc, y);
      }

      drawDataRow(doc, rowsData[i], y, rh, i);
      y += rh;
    }

    if (rowsData.length === 0) {
      doc.font('Helvetica').fontSize(10).fillColor(C.textMid)
         .text('No course reports available for this faculty member.', MARGIN, y + 10, { width: PAGE_W - MARGIN * 2 });
      y += 30;
    }

    // Signatures
    drawSignatures(doc, y, vcUser, approvedDate);

    doc.end();
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// DEPARTMENT OVERALL PRO-VC COMMENTS REPORT
// ══════════════════════════════════════════════════════════════════════════════

// ── Sentence splitter (shared by HOD / Pro-VC / overall comments) ──────────
function splitSentences(text) {
  if (!text) return [];
  return String(text)
    .split(/\n|\.(?=\s+)/)
    .map(s => s.trim())
    .filter(Boolean);
}

// ── Department report column layout ─────────────────────────────────────────
//  S.No | Faculty Name(merged) | Course Code(Section) | Course Name |
//  Reg.Stud. | Response% | FFI | Student Comments | HOD Comments | Pro-VC Comments
//
//  Width budget (usable = 805.89):
//   24 + 95 + 62 + 100 + 34 + 38 + 34 + 140 + 140 + 138 = 805
const FACULTY_W   = 95;
const DEPT_X = {
  sno    : 0,
  faculty: 24,     // width 95  -> ends 119
  code   : 119,    // width 62  -> ends 181
  name   : 181,    // width 100 -> ends 281
  reg    : 281,    // width 34  -> ends 315
  pct    : 315,    // width 38  -> ends 353
  ffi    : 353,    // width 34  -> ends 387
  student: 387,    // width 140 -> ends 527
  hod    : 527,    // width 140 -> ends 667
  provc  : 667,    // width 138 -> ends 805
};
const DEPT_W = {
  sno: 24, faculty: 95, code: 62, name: 100, reg: 34,
  pct: 38, ffi: 34, student: 140, hod: 140, provc: 138,
};

const DEPT_HEADER_LABELS = [
  { x: DEPT_X.sno,     w: DEPT_W.sno,     label: 'S.No' },
  { x: DEPT_X.faculty, w: DEPT_W.faculty, label: 'Faculty Name' },
  { x: DEPT_X.code,    w: DEPT_W.code,    label: 'Course Code\n(Section)' },
  { x: DEPT_X.name,    w: DEPT_W.name,    label: 'Course Name' },
  { x: DEPT_X.reg,     w: DEPT_W.reg,     label: 'Reg.\nStud.' },
  { x: DEPT_X.pct,     w: DEPT_W.pct,     label: 'Response %' },
  { x: DEPT_X.ffi,     w: DEPT_W.ffi,     label: 'FFI\nScore' },
  { x: DEPT_X.student, w: DEPT_W.student, label: 'Student Comments\n(Key Points)' },
  { x: DEPT_X.hod,     w: DEPT_W.hod,     label: 'HOD Comments\n(Action Taken / Remarks)' },
  { x: DEPT_X.provc,   w: DEPT_W.provc,   label: 'Pro-VC Comments' },
];

// ── Department title bar ─────────────────────────────────────────────────────
function drawDeptTitleBar(doc, y) {
  const bw = PAGE_W - MARGIN * 2;
  doc.rect(MARGIN, y, bw, 18).fill(C.headerFill);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor('white')
     .text('DEPARTMENT OVERALL PRO-VC COMMENTS REPORT', MARGIN, y + 4, { width: bw, align: 'center' });
  return y + 18;
}

// ── Department info block (2 rows × 4 cols) ─────────────────────────────────
function drawDeptInfoBlock(doc, info, y) {
  const bw    = PAGE_W - MARGIN * 2;
  const half  = bw / 2;
  const labelW = 120;
  const rh    = 16;
  const rows = [
    ['Department', info.department,    'Academic Session',    info.session],
    ['Programme',  info.programme,     'Report Generated On', info.generatedOn],
  ];

  let cy = y;
  for (const [lk, lv, rk, rv] of rows) {
    drawRect(doc, MARGIN,                  cy, labelW,        rh, '#EEF2FF');
    drawRect(doc, MARGIN + labelW,         cy, half - labelW, rh, 'white');
    drawRect(doc, MARGIN + half,           cy, labelW,        rh, '#EEF2FF');
    drawRect(doc, MARGIN + half + labelW, cy, half - labelW, rh, 'white');

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.textDark)
       .text(lk, MARGIN + 4, cy + 4, { width: labelW - 8 });
    doc.font('Helvetica').fontSize(8.5).fillColor(C.textDark)
       .text(safe(lv), MARGIN + labelW + 4, cy + 4, { width: half - labelW - 8 });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.textDark)
       .text(rk, MARGIN + half + 4, cy + 4, { width: labelW - 8 });
    doc.font('Helvetica').fontSize(8.5).fillColor(C.textDark)
       .text(safe(rv), MARGIN + half + labelW + 4, cy + 4, { width: half - labelW - 8 });

    cy += rh;
  }
  return cy;
}

// ── Department table header row ─────────────────────────────────────────────
function drawDeptTableHeader(doc, y) {
  const HEADER_H = 30;
  for (const col of DEPT_HEADER_LABELS) {
    doc.rect(MARGIN + col.x, y, col.w, HEADER_H).fill(C.headerFill).stroke(C.border);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('white');
    doc.text(col.label, MARGIN + col.x + 2, y + 4, { width: col.w - 4, align: 'center', lineBreak: true });
  }
  return y + HEADER_H;
}

// ── Build a single course row's data ────────────────────────────────────────
function buildDeptCourseRow(r, idx, provcMap) {
  const studentItems = [
    ...(r.appreciation || []).filter(c => c && c.trim().split(/\s+/).length >= 4).slice(0, 4),
    ...(r.commentsNeedingAttention || []).filter(c => c && c.trim().split(/\s+/).length >= 4).slice(0, 4),
  ].slice(0, 6);

  const hodItems = [];
  if (r.hodRemarks && r.hodRemarks.trim()) splitSentences(r.hodRemarks).slice(0, 3).forEach(s => hodItems.push(s));
  if (r.actionTaken && r.actionTaken.trim()) splitSentences(r.actionTaken).slice(0, 3).forEach(s => hodItems.push(s));
  if (!hodItems.length) hodItems.push('—');

  const provcRaw = provcMap[`${(r.facultyName || '').toLowerCase()}|${(r.subjectCode || '').toLowerCase()}`] || '';
  const provcItems = provcRaw ? splitSentences(provcRaw) : [];

  const pct = r.responsePercent != null
    ? Number(r.responsePercent).toFixed(2)
    : (r.responseCount && r.registeredStudents
        ? ((r.responseCount / r.registeredStudents) * 100).toFixed(2)
        : '—');

  return {
    sno    : String(idx + 1),
    code   : safe(r.subjectCode),
    name   : safe(r.programme || r.subjectCode),
    reg    : safe(r.registeredStudents, '—'),
    pct,
    ffi    : r.ffiScore != null ? Number(r.ffiScore).toFixed(2) : '—',
    student: studentItems,
    hod    : hodItems,
    provc  : provcItems,
  };
}

// ── Height of a course row (excludes the merged faculty column) ─────────────
function calcDeptRowHeight(doc, row) {
  const MIN_H = 30;
  let maxH = MIN_H;
  const bulletCols = [
    { w: DEPT_W.student, items: row.student },
    { w: DEPT_W.hod,     items: row.hod     },
    { w: DEPT_W.provc,   items: row.provc   },
  ];
  for (const col of bulletCols) {
    let total = 8;
    for (const item of (col.items || [])) {
      if (!item || !item.trim()) continue;
      doc.font('Helvetica').fontSize(7.5);
      total += doc.heightOfString(item.trim(), { width: col.w - 14 }) + 2;
    }
    if (total > maxH) maxH = total;
  }
  return Math.min(maxH, 160); // cap absurdly tall single rows
}

// ── Draw the non-faculty cells for one course row ───────────────────────────
function drawDeptCourseCells(doc, row, y, rowH, isEven) {
  const specs = [
    { x: DEPT_X.sno,     w: DEPT_W.sno,     kind: 'text',    val: row.sno,  align: 'center' },
    { x: DEPT_X.code,    w: DEPT_W.code,     kind: 'text',    val: row.code, align: 'center' },
    { x: DEPT_X.name,    w: DEPT_W.name,     kind: 'text',    val: row.name, align: 'left'   },
    { x: DEPT_X.reg,     w: DEPT_W.reg,      kind: 'text',    val: row.reg,  align: 'center' },
    { x: DEPT_X.pct,     w: DEPT_W.pct,      kind: 'text',    val: row.pct,  align: 'center' },
    { x: DEPT_X.ffi,     w: DEPT_W.ffi,      kind: 'ffi',     val: row.ffi },
    { x: DEPT_X.student, w: DEPT_W.student,  kind: 'bullets', val: row.student },
    { x: DEPT_X.hod,     w: DEPT_W.hod,      kind: 'bullets', val: row.hod },
    { x: DEPT_X.provc,   w: DEPT_W.provc,    kind: 'bullets', val: row.provc, bg: C.commentBg },
  ];

  for (const s of specs) {
    let bg = isEven ? 'white' : C.rowAlt;
    if (s.bg) bg = s.bg;
    doc.rect(MARGIN + s.x, y, s.w, rowH).fill(bg).stroke(C.border);

    if (s.kind === 'bullets') {
      const items = Array.isArray(s.val) ? s.val : (s.val ? [s.val] : []);
      let ty = y + 4;
      for (const item of items) {
        if (!item || !item.trim()) continue;
        const cleaned = item.trim();
        doc.font('Helvetica').fontSize(7.5).fillColor(C.textDark);
        const lineH = doc.heightOfString(cleaned, { width: s.w - 14 });
        if (ty + lineH > y + rowH - 2) break; // safety clip
        doc.text('•', MARGIN + s.x + 3, ty, { width: 8 });
        doc.text(cleaned, MARGIN + s.x + 12, ty, { width: s.w - 15, lineBreak: true });
        ty += lineH + 2;
      }
      if (items.length === 0) {
        doc.font('Helvetica').fontSize(7.5).fillColor(C.textGrey)
           .text('—', MARGIN + s.x + 3, y + 4, { width: s.w - 6, align: 'center' });
      }
    } else if (s.kind === 'ffi') {
      const score = parseFloat(safe(s.val, '0'));
      doc.font('Helvetica-Bold').fontSize(9).fillColor(ffiColor(score));
      doc.text(safe(s.val), MARGIN + s.x + 2, y + (rowH - 11) / 2, { width: s.w - 4, align: 'center' });
    } else {
      doc.font('Helvetica').fontSize(7.5).fillColor(C.textDark);
      doc.text(safe(s.val), MARGIN + s.x + 2, y + 4, { width: s.w - 4, align: s.align, lineBreak: true });
    }
  }
}

// ── Draw the merged faculty-name cell (bold blue, vertically centred) ──────
function drawDeptFacultyCell(doc, name, y, height) {
  doc.rect(MARGIN + DEPT_X.faculty, y, DEPT_W.faculty, height).fill('white').stroke(C.border);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.darkBlue);
  const nameH = doc.heightOfString(safe(name), { width: DEPT_W.faculty - 8 });
  const nameY = y + Math.max(5, (height - nameH) / 2);
  doc.text(safe(name), MARGIN + DEPT_X.faculty + 4, nameY, { width: DEPT_W.faculty - 8, lineBreak: true });
}

// ── Overall VC comments box (light yellow) ─────────────────────────────────
function drawOverallComments(doc, vcComment, y) {
  const bw = PAGE_W - MARGIN * 2;
  const TITLE_H = 16;

  // Title bar
  doc.rect(MARGIN, y, bw, TITLE_H).fill(C.darkBlue);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('white')
     .text('OVERALL VC COMMENTS (FOR THE DEPARTMENT)', MARGIN, y + 3, { width: bw, align: 'center' });
  y += TITLE_H;

  const items = vcComment ? splitSentences(vcComment) : [];

  // Estimate body height
  doc.font('Helvetica').fontSize(8.5);
  let bodyH = 10;
  for (const item of items) {
    bodyH += doc.heightOfString(item, { width: bw - 28 }) + 5;
  }
  if (!items.length) bodyH = 22;

  // Background box
  doc.rect(MARGIN, y, bw, bodyH).fill('#FFFBEA').stroke(C.border);

  if (!items.length) {
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(C.textGrey)
       .text('No overall VC comments recorded for this department yet.', MARGIN + 14, y + 6, { width: bw - 28 });
  } else {
    let ty = y + 7;
    for (const item of items) {
      doc.font('Helvetica').fontSize(8.5).fillColor(C.textDark);
      const lineH = doc.heightOfString(item, { width: bw - 28 });
      doc.text('•', MARGIN + 8, ty, { width: 10 });
      doc.text(item, MARGIN + 20, ty, { width: bw - 28, lineBreak: true });
      ty += lineH + 5;
    }
  }
  return y + bodyH;
}

// ── Department signatures ────────────────────────────────────────────────────
function drawDeptSignatures(doc, y, hodUser, vcUser, approvedDate) {
  const sigY = Math.max(y + 10, PAGE_H - 72);
  const bw   = PAGE_W - MARGIN * 2;
  const half = bw / 2;

  // HOD side (left)
  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.darkBlue)
     .text('HOD Name & Signature', MARGIN, sigY, { width: half, align: 'left' });
  doc.font('Helvetica').fontSize(8.5).fillColor(C.textDark)
     .text(safe(hodUser?.name, 'Head of Department'), MARGIN, sigY + 14, { width: half });
  doc.moveTo(MARGIN, sigY + 34).lineTo(MARGIN + 200, sigY + 34).stroke(C.textDark);
  doc.font('Helvetica').fontSize(8.5).fillColor(C.textDark)
     .text('Date :  _______________', MARGIN, sigY + 38, { width: half });

  // Pro-VC side (right)
  const rx = MARGIN + half;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.darkBlue)
     .text('Pro-Vice Chancellor', rx, sigY, { width: half, align: 'right' });
  doc.font('Helvetica').fontSize(8.5).fillColor(C.textDark)
     .text(safe(vcUser?.name, 'Prof. Rajeev K. Singh'), rx, sigY + 14, { width: half, align: 'right' });
  doc.moveTo(rx + half - 200, sigY + 34).lineTo(rx + half, sigY + 34).stroke(C.textDark);
  const dateStr = safe(approvedDate, new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));
  doc.font('Helvetica').fontSize(8.5).fillColor(C.textDark)
     .text(`Date :  ${dateStr}`, rx, sigY + 38, { width: half, align: 'right' });
}

// ── Page helpers for the department report ──────────────────────────────────
function newDeptTablePage(doc) {
  doc.addPage({ size: [PAGE_W, PAGE_H], layout: 'landscape', margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  drawHeader(doc);
  let y = 78;
  y = drawDeptTitleBar(doc, y);
  y += 2;
  y = drawDeptTableHeader(doc, y);
  return y;
}

/**
 * Generate a Department Overall Pro-VC Comments Report PDF (landscape A4).
 *
 * @param {object} params
 * @param {object} params.submission  – { academicYear, session, department, vcComment, provcComments }
 * @param {Array}  params.reports     – All FacultyReport docs for the submission
 * @param {object} [params.hodUser]   – HOD user doc { name }
 * @param {object} [params.vcUser]    – VC user doc { name, signatureImage }
 * @param {string} [params.approvedDate]
 * @param {number} [params.avgResponse]– department avg response %
 * @param {number} [params.dfi]        – department avg FFI
 * @param {string} [params.programme]  – programme label
 * @returns {Promise<Buffer>}
 */
async function generateDepartmentProVCReport({
  submission,
  reports,
  hodUser,
  vcUser,
  approvedDate,
  avgResponse,
  dfi,
  programme,
}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size        : [PAGE_W, PAGE_H],
      layout      : 'landscape',
      margins     : { top: 0, bottom: 0, left: 0, right: 0 },
      bufferPages : true,
      autoFirstPage: true,
      info: {
        Title  : 'Department Overall Pro-VC Comments Report',
        Author : 'MITS Gwalior Feedback System',
        Subject: 'Department Overall Pro-VC Comments Report',
      },
    });

    doc.on('data',  chunk => chunks.push(chunk));
    doc.on('end',   ()    => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const sessionLabel =
      submission.session === 'jan-may' ? `${submission.academicYear || ''} (Jan–Jun)` :
      submission.session === 'jul-dec' ? `${submission.academicYear || ''} (July–Dec)` :
      safe(submission.academicYear || submission.session);

    const generatedOn = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    // Pro-VC comment lookup
    const provcMap = {};
    (submission.provcComments || []).forEach(c => {
      const k = `${(c.facultyName || '').toLowerCase()}|${(c.subjectCode || '').toLowerCase()}`;
      provcMap[k] = c.comment;
    });

    // Group reports by faculty, preserving order of first appearance
    const groups = [];
    const groupIndex = {};
    (reports || []).forEach(r => {
      const name = r.facultyName || 'Unknown';
      if (groupIndex[name] == null) {
        groupIndex[name] = groups.length;
        groups.push({ facultyName: name, rows: [] });
      }
      groups[groupIndex[name]].rows.push(r);
    });

    // Build course rows for every group
    let sno = 0;
    for (const g of groups) {
      g.courseRows = g.rows.map(r => buildDeptCourseRow(r, sno++, provcMap));
      g.rowHeights  = g.courseRows.map(row => calcDeptRowHeight(doc, row));
      g.groupH      = g.rowHeights.reduce((s, h) => s + h, 0);
    }

    const BOTTOM_LIMIT = PAGE_H - 78; // reserve room for signatures on the last page

    // ── Page 1 header ─────────────────────────────────────────────────────
    drawHeader(doc);
    let y = 78;

    // Title bar
    y = drawDeptTitleBar(doc, y);
    y += 3;

    // Info block
    y = drawDeptInfoBlock(doc, {
      department  : safe(submission.department || hodUser?.department),
      session     : sessionLabel,
      programme   : safe(programme || reports?.[0]?.programme || 'B.Tech.'),
      generatedOn,
    }, y);
    y += 4;

    // Table header
    y = drawDeptTableHeader(doc, y);

    // ── Data rows (grouped by faculty, faculty name merged) ────────────────
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];

      // If the whole faculty group won't fit, start a new page
      if (y + g.groupH > BOTTOM_LIMIT && g.groupH < (BOTTOM_LIMIT - 110)) {
        y = newDeptTablePage(doc);
      }

      let rowY = y;
      for (let ri = 0; ri < g.courseRows.length; ri++) {
        const rh = g.rowHeights[ri];

        // Single course row taller than the page → force a new page first
        if (rowY + rh > BOTTOM_LIMIT && rh < (BOTTOM_LIMIT - 110)) {
          // finish faculty cell for what we have, then new page
          drawDeptFacultyCell(doc, g.facultyName, y, rowY - y);
          y = newDeptTablePage(doc);
          rowY = y;
          // remaining rows of this faculty continue on the new page with a fresh merged cell
          let remH = 0;
          for (let k = ri; k < g.courseRows.length; k++) remH += g.rowHeights[k];
          drawDeptFacultyCell(doc, g.facultyName, rowY, remH);
        }

        drawDeptCourseCells(doc, g.courseRows[ri], rowY, rh, ri % 2 === 0);
        rowY += rh;
      }

      // Draw the merged faculty-name cell spanning this group's rows
      drawDeptFacultyCell(doc, g.facultyName, y, rowY - y);
      y = rowY;
    }

    if (groups.length === 0) {
      doc.font('Helvetica').fontSize(10).fillColor(C.textMid)
         .text('No course reports available for this department.', MARGIN, y + 10, { width: PAGE_W - MARGIN * 2 });
      y += 30;
    }

    // ── Overall VC comments box ───────────────────────────────────────────
    y += 8;
    const boxH = 16 + (function () {
      doc.font('Helvetica').fontSize(8.5);
      const items = submission.vcComment ? splitSentences(submission.vcComment) : [];
      let h = 10;
      for (const it of items) h += doc.heightOfString(it, { width: PAGE_W - MARGIN * 2 - 28 }) + 5;
      return items.length ? h : 22;
    })();

    if (y + boxH > BOTTOM_LIMIT) {
      y = newDeptTablePage(doc);
    }
    y = drawOverallComments(doc, submission.vcComment, y);

    // ── Signatures ─────────────────────────────────────────────────────────
    drawDeptSignatures(doc, y, hodUser, vcUser, approvedDate);

    doc.end();
  });
}

module.exports = { generateProVCReport, generateDepartmentProVCReport };
