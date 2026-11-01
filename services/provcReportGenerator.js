'use strict';

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const MITS_LOGO_LEFT  = path.join(__dirname, '../../src/assets/mits-logo.png');
const MITS_HEADER_PNG = path.join(__dirname, '../assets/mits-header.png');

const PAGE_W = 841.89;
const PAGE_H = 595.28;
const MARGIN = 18;
const HEADER_BOTTOM = 78;
const FOOTER_H      = 22;
const TABLE_BOTTOM  = PAGE_H - FOOTER_H;
const SIG_H         = 70;
const MIN_ROW_H     = 30;
const FS            = 7.5;
const BULLET_X      = 3;
const TEXT_X        = 12;
const PAD_R         = 3;

const C = {
  darkBlue  : '#1B3D7A',
  red       : '#C0392B',
  green     : '#1E6B3C',
  headerFill: '#1B3D7A',
  rowAlt    : '#F9FBFF',
  rowGold   : '#FFF8E1',
  border    : '#CCCCCC',
  textDark  : '#111111',
  textMid   : '#333333',
  textGrey  : '#666666',
  ffiGreen  : '#1E8449',
  ffiAmber  : '#D35400',
  ffiRed    : '#C0392B',
  commentBg : '#EAF4FF',
  labelBg   : '#EEF2FF',
};

function ffiColor(score) {
  if (!score) return C.textDark;
  if (score >= 4.0) return C.ffiGreen;
  if (score >= 3.5) return C.ffiAmber;
  return C.ffiRed;
}

function safe(v, fallback = '') {
  return v == null ? fallback : String(v).trim() || fallback;
}

function fmtDate(d) {
  return safe(d, new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));
}

const ABBREV_GUARD = /(?<!\b(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|vs|etc|Fig|No)\.)(?<=[.!?])\s+(?=[A-Z])/;

function splitSentences(text) {
  if (!text) return [];
  const s = String(text)
    .replace(/\r/g, '')
    .replace(/(?:^|\n|(?<=[.!?])\s)\s*\d{1,2}[.)]\s+(?=[A-Z])/g, '\n');
  return s
    .split(/\n+/)
    .flatMap(line => line.split(ABBREV_GUARD))
    .map(t => t.replace(/^[•\-*]\s*/, '').trim())
    .filter(Boolean);
}

function cleanCourseName(v) {
  return safe(v)
    .replace(/submitted\s+answers\s*:?\s*-?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCourseCode(raw) {
  const s = safe(raw).replace(/\s+/g, ' ');
  const m = s.match(/^(.+?)-Batch-?\s*([A-Z0-9])/);
  if (m) return { code: m[1], section: `Batch-${m[2]}` };
  return { code: s, section: '' };
}

function codeLabel(raw) {
  const { code, section } = parseCourseCode(raw);
  return section ? `${code}\n(${section})` : code;
}

function courseNameOf(r) {
  return cleanCourseName(
    r.subjectName || r.courseName || r.courseTitle || r.subjectTitle ||
    r.subject || r.programme || r.subjectCode
  );
}

function fmtPct(r) {
  if (r.responsePercent != null) return Number(r.responsePercent).toFixed(2);
  if (r.responseCount && r.registeredStudents) {
    return ((r.responseCount / r.registeredStudents) * 100).toFixed(2);
  }
  return '—';
}

function sessionLabelOf(submission) {
  const ay = submission.academicYear || '';
  if (submission.session === 'jan-may') return `${ay} (Jan–Jun)`;
  if (submission.session === 'jul-dec') return `${ay} (July–Dec)`;
  return safe(submission.academicYear || submission.session);
}

const norm = s => safe(s).toLowerCase().replace(/\s+/g, ' ');

function buildProvcLookup(submission) {
  const map = new Map();
  (submission?.provcComments || []).forEach(c => {
    const f = norm(c.facultyName);
    const { code, section } = parseCourseCode(c.subjectCode);
    map.set(`${f}|${norm(c.subjectCode)}`, c.comment);
    map.set(`${f}|${norm(code)}|${norm(section)}`, c.comment);
  });
  return (facultyName, subjectCode) => {
    const f = norm(facultyName);
    const { code, section } = parseCourseCode(subjectCode);
    return map.get(`${f}|${norm(subjectCode)}`) ??
           map.get(`${f}|${norm(code)}|${norm(section)}`) ?? '';
  };
}

function buildRow(r, idx, getProvc, strict) {
  const clean = arr => (arr || []).map(c => safe(c)).filter(Boolean);
  let student;
  if (strict) {
    const long = arr => clean(arr).filter(c => c.split(/\s+/).length >= 4);
    student = [...long(r.appreciation).slice(0, 4), ...long(r.commentsNeedingAttention).slice(0, 4)].slice(0, 6);
  } else {
    student = [...clean(r.appreciation), ...clean(r.commentsNeedingAttention)];
  }

  const hod = [
    ...splitSentences(r.hodRemarks).slice(0, 3),
    ...splitSentences(r.actionTaken).slice(0, 3),
  ];

  return {
    sno    : String(idx + 1),
    code   : codeLabel(r.subjectCode),
    name   : courseNameOf(r),
    reg    : safe(r.registeredStudents, '—'),
    sent   : safe(r.linkSent || r.linksSent, '—'),
    resp   : safe(r.responseCount, '—'),
    pct    : fmtPct(r),
    ffi    : r.ffiScore != null ? Number(r.ffiScore).toFixed(2) : '—',
    student,
    hod,
    provc  : splitSentences(getProvc(r.facultyName, r.subjectCode)),
  };
}

function drawRect(doc, x, y, w, h, fill) {
  doc.save()
     .lineWidth(0.5)
     .rect(x, y, w, h)
     .fillAndStroke(fill || 'white', C.border)
     .restore();
}

const bulletTextW = w => w - TEXT_X - PAD_R;

function bulletsHeight(doc, items, w) {
  let total = 4;
  doc.font('Helvetica').fontSize(FS);
  for (const it of items || []) {
    if (!it) continue;
    total += doc.heightOfString(it, { width: bulletTextW(w) }) + 2;
  }
  return total + 2;
}

function drawBullets(doc, items, x, y, w, h) {
  const list = (items || []).filter(Boolean);
  if (!list.length) {
    doc.font('Helvetica').fontSize(FS).fillColor(C.textGrey)
       .text('—', x + 2, y + 4, { width: w - 4, align: 'center' });
    return;
  }
  const maxY = y + h - 2;
  let ty = y + 4;
  for (const it of list) {
    doc.font('Helvetica').fontSize(FS).fillColor(C.textDark);
    const th = doc.heightOfString(it, { width: bulletTextW(w) });
    if (ty + th > maxY) {
      if (ty + 9 <= y + h) doc.text('…', x + TEXT_X, ty, { width: 20, lineBreak: false });
      break;
    }
    doc.text('•', x + BULLET_X, ty, { width: 8, lineBreak: false });
    doc.text(it, x + TEXT_X, ty, { width: bulletTextW(w) });
    ty += th + 2;
  }
}

function drawHeader(doc) {
  const logoSize = 58;
  if (fs.existsSync(MITS_LOGO_LEFT)) {
    doc.image(MITS_LOGO_LEFT, MARGIN, 8, { fit: [logoSize, logoSize] });
  }
  const bx = MARGIN + logoSize + 4;
  const bw = PAGE_W - bx * 2;

  if (fs.existsSync(MITS_HEADER_PNG)) {
    doc.image(MITS_HEADER_PNG, bx, 8, { fit: [bw, 68], align: 'center', valign: 'top' });
  } else {
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.darkBlue)
       .text('Madhav Institute of Technology & Science, Gwalior (M.P.), INDIA', bx, 14, { width: bw, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.red)
       .text('Deemed University', bx, 30, { width: bw, align: 'center' });
    doc.font('Helvetica').fontSize(8).fillColor(C.green)
       .text('(Declared under Distinct Category by Ministry of Education, Government of India)', bx, 42, { width: bw, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.red)
       .text('NAAC ACCREDITED WITH A++ GRADE', bx, 55, { width: bw, align: 'center' });
  }
}

function drawTitleBar(doc, y, title) {
  const bw = PAGE_W - MARGIN * 2;
  doc.rect(MARGIN, y, bw, 18).fill(C.headerFill);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor('white')
     .text(title, MARGIN, y + 4, { width: bw, align: 'center' });
  return y + 18;
}

function newPage(doc) {
  doc.addPage({ size: [PAGE_W, PAGE_H], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
}

function newPlainPage(doc, title) {
  newPage(doc);
  drawHeader(doc);
  return drawTitleBar(doc, HEADER_BOTTOM, title) + 3;
}

function drawInfoGrid(doc, rows, y) {
  const bw = PAGE_W - MARGIN * 2;
  const half = bw / 2;
  const labelW = 120;
  const valW = half - labelW;
  let cy = y;

  for (const [lk, lv, rk, rv] of rows) {
    doc.font('Helvetica').fontSize(8.5);
    const hL = doc.heightOfString(safe(lv), { width: valW - 8 });
    const hR = doc.heightOfString(safe(rv), { width: valW - 8 });
    const rh = Math.max(16, Math.max(hL, hR) + 8);

    drawRect(doc, MARGIN,                 cy, labelW, rh, lk ? C.labelBg : 'white');
    drawRect(doc, MARGIN + labelW,        cy, valW,   rh, 'white');
    drawRect(doc, MARGIN + half,          cy, labelW, rh, rk ? C.labelBg : 'white');
    drawRect(doc, MARGIN + half + labelW, cy, valW,   rh, 'white');

    if (lk) {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.textDark).text(lk, MARGIN + 4, cy + 4, { width: labelW - 8 });
      doc.font('Helvetica').fontSize(8.5).fillColor(C.textDark).text(safe(lv), MARGIN + labelW + 4, cy + 4, { width: valW - 8 });
    }
    if (rk) {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.textDark).text(rk, MARGIN + half + 4, cy + 4, { width: labelW - 8 });
      doc.font('Helvetica').fontSize(8.5).fillColor(C.textDark).text(safe(rv), MARGIN + half + labelW + 4, cy + 4, { width: valW - 8 });
    }
    cy += rh;
  }
  return cy;
}

function colX(cols, key) {
  let x = MARGIN;
  for (const c of cols) { if (c.key === key) return x; x += c.w; }
  return MARGIN;
}

function drawColHeader(doc, cols, y, h = 30) {
  let x = MARGIN;
  for (const c of cols) {
    drawRect(doc, x, y, c.w, h, C.headerFill);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('white');
    const th = doc.heightOfString(c.label, { width: c.w - 4 });
    doc.text(c.label, x + 2, y + Math.max(2, (h - th) / 2), { width: c.w - 4, align: 'center' });
    x += c.w;
  }
  return y + h;
}

const MAX_ROW_H = TABLE_BOTTOM - (HEADER_BOTTOM + 18 + 3 + 30) - 2;

function rowHeight(doc, cols, row) {
  let maxH = MIN_ROW_H;
  for (const c of cols) {
    let h = MIN_ROW_H;
    if (c.kind === 'bullets') {
      h = bulletsHeight(doc, row[c.key], c.w);
    } else if (c.kind === 'text') {
      doc.font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(FS);
      h = doc.heightOfString(safe(row[c.key]), { width: c.w - 4 }) + 8;
    }
    if (h > maxH) maxH = h;
  }
  return Math.min(maxH, MAX_ROW_H);
}

function drawRow(doc, cols, row, y, h, zebra) {
  let x = MARGIN;
  for (const c of cols) {
    let bg = zebra ? C.rowAlt : 'white';
    if (c.bg) bg = c.bg;
    drawRect(doc, x, y, c.w, h, bg);

    if (c.kind === 'bullets') {
      drawBullets(doc, row[c.key], x, y, c.w, h);
    } else if (c.kind === 'ffi') {
      const score = parseFloat(safe(row[c.key], '0'));
      doc.font('Helvetica-Bold').fontSize(9).fillColor(ffiColor(score))
         .text(safe(row[c.key]), x + 2, y + (h - 10) / 2, { width: c.w - 4, align: 'center', lineBreak: false });
    } else {
      doc.font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(FS).fillColor(c.color || C.textDark)
         .text(safe(row[c.key]), x + 2, y + 4, { width: c.w - 4, align: c.align || 'left' });
    }
    x += c.w;
  }
}

function loadSignature(img) {
  try {
    if (!img) return null;
    if (Buffer.isBuffer(img)) return img;
    if (typeof img === 'string') {
      if (img.startsWith('data:')) return Buffer.from(img.split(',')[1] || '', 'base64');
      if (fs.existsSync(img)) return img;
    }
  } catch (_) { /* ignore */ }
  return null;
}

function drawSignatures(doc, y, { hodUser, vcUser, approvedDate, title }) {
  if (y + 12 + SIG_H > TABLE_BOTTOM) {
    y = newPlainPage(doc, title);
  }
  const sigY = Math.max(y + 12, TABLE_BOTTOM - SIG_H);
  const bw = PAGE_W - MARGIN * 2;
  const half = bw / 2;
  const rx = MARGIN + half;
  const lineLen = 200;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.darkBlue)
     .text('HOD Name & Signature', MARGIN, sigY, { width: half });
  doc.moveTo(MARGIN, sigY + 42).lineTo(MARGIN + lineLen, sigY + 42).lineWidth(0.7).stroke(C.textDark);
  doc.font('Helvetica').fontSize(8.5).fillColor(C.textDark)
     .text(safe(hodUser?.name, 'Head of Department'), MARGIN, sigY + 46, { width: half });
  doc.text('Date :  _______________', MARGIN, sigY + 58, { width: half });

  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.darkBlue)
     .text('Pro-Vice Chancellor', rx, sigY, { width: half, align: 'right' });
  const sig = loadSignature(vcUser?.signatureImage);
  if (sig) {
    try {
      doc.image(sig, rx + half - lineLen + 30, sigY + 12, { fit: [140, 28] });
    } catch (_) { /* bad image – skip */ }
  }
  doc.moveTo(rx + half - lineLen, sigY + 42).lineTo(rx + half, sigY + 42).lineWidth(0.7).stroke(C.textDark);
  doc.font('Helvetica').fontSize(8.5).fillColor(C.textDark)
     .text(safe(vcUser?.name, 'Prof. Rajeev K. Singh'), rx, sigY + 46, { width: half, align: 'right' });
  doc.text(`Date :  ${fmtDate(approvedDate)}`, rx, sigY + 58, { width: half, align: 'right' });
}

function drawFooters(doc) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font('Helvetica').fontSize(7).fillColor(C.textGrey)
       .text(`Page ${i + 1} of ${range.count}`, MARGIN, PAGE_H - 14,
             { width: PAGE_W - MARGIN * 2, align: 'right', lineBreak: false });
  }
}

function createDoc(title, subject) {
  return new PDFDocument({
    size        : [PAGE_W, PAGE_H],
    margins     : { top: 0, bottom: 0, left: 0, right: 0 },
    bufferPages : true,
    autoFirstPage: true,
    info: { Title: title, Author: 'MITS Gwalior Feedback System', Subject: subject },
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 1. FACULTY FEEDBACK REPORT (COURSE WISE)
// ══════════════════════════════════════════════════════════════════════════
const FACULTY_TITLE = 'FACULTY FEEDBACK REPORT (COURSE WISE)';

const FAC_COLS = [
  { key: 'sno',     label: 'S.No',                                   w: 24,  kind: 'text',    align: 'center' },
  { key: 'code',    label: 'Course Code\n(Section)',                 w: 62,  kind: 'text',    align: 'center' },
  { key: 'name',    label: 'Course Name',                            w: 95,  kind: 'text',    align: 'left'   },
  { key: 'reg',     label: 'Reg.\nStud.',                            w: 34,  kind: 'text',    align: 'center' },
  { key: 'sent',    label: 'Links\nSent',                            w: 34,  kind: 'text',    align: 'center' },
  { key: 'resp',    label: 'Resp.\nCount',                           w: 36,  kind: 'text',    align: 'center' },
  { key: 'pct',     label: 'Resp.\n%',                               w: 36,  kind: 'text',    align: 'center' },
  { key: 'ffi',     label: 'FFI\nScore',                             w: 34,  kind: 'ffi',     bg: C.rowGold },
  { key: 'student', label: 'Student Comments\n(Key Points)',         w: 155, kind: 'bullets' },
  { key: 'hod',     label: 'HOD Comments\n(Action Taken / Remarks)', w: 155, kind: 'bullets' },
  { key: 'provc',   label: 'Pro-VC Comments',                        w: 140, kind: 'bullets', bg: C.commentBg },
];

async function generateProVCReport({
  faculty, submission, reports, hodUser, vcUser, approvedDate, avgResponse, dfi, programme,
}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = createDoc(
      `Pro-VC Faculty Feedback Report – ${faculty.name}`,
      'Faculty Feedback Report (Course Wise)'
    );
    doc.on('data', ch => chunks.push(ch));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      const getProvc = buildProvcLookup(submission);
      const rows = (reports || []).map((r, i) => buildRow(r, i, getProvc, false));

      drawHeader(doc);
      let y = drawTitleBar(doc, HEADER_BOTTOM, FACULTY_TITLE) + 2;

      y = drawInfoGrid(doc, [
        ['Faculty Name', safe(faculty.name),                  'Academic Session',     sessionLabelOf(submission)],
        ['Designation',  safe(faculty.designation, 'Faculty'), 'Programme',            safe(programme || submission.programme, 'B.Tech.')],
        ['Department',   safe(faculty.department),            'Dept. Avg Response %', avgResponse != null ? Number(avgResponse).toFixed(2) : '—'],
        ['',             '',                                  'DFI (Department)',     dfi != null ? Number(dfi).toFixed(2) : '—'],
      ], y) + 4;

      y = drawColHeader(doc, FAC_COLS, y);

      for (let i = 0; i < rows.length; i++) {
        const rh = rowHeight(doc, FAC_COLS, rows[i]);
        if (y + rh > TABLE_BOTTOM) {
          y = newPlainPage(doc, FACULTY_TITLE) - 1;
          y = drawColHeader(doc, FAC_COLS, y);
        }
        drawRow(doc, FAC_COLS, rows[i], y, rh, i % 2 === 1);
        y += rh;
      }

      if (!rows.length) {
        doc.font('Helvetica').fontSize(10).fillColor(C.textMid)
           .text('No course reports available for this faculty member.', MARGIN, y + 10, { width: PAGE_W - MARGIN * 2 });
        y += 30;
      }

      drawSignatures(doc, y, { hodUser, vcUser, approvedDate, title: FACULTY_TITLE });
      drawFooters(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 2. DEPARTMENT OVERALL PRO-VC COMMENTS REPORT
// ══════════════════════════════════════════════════════════════════════════
const DEPT_TITLE = 'DEPARTMENT OVERALL PRO-VC COMMENTS REPORT';

const DEPT_COLS = [
  { key: 'sno',     label: 'S.No',                                   w: 24,  kind: 'text',    align: 'center' },
  { key: 'faculty', label: 'Faculty Name',                           w: 95,  kind: 'text',    align: 'left',   bold: true, color: '#1B3D7A' },
  { key: 'code',    label: 'Course Code\n(Section)',                 w: 62,  kind: 'text',    align: 'center' },
  { key: 'name',    label: 'Course Name',                            w: 100, kind: 'text',    align: 'left'   },
  { key: 'reg',     label: 'Reg.\nStud.',                            w: 34,  kind: 'text',    align: 'center' },
  { key: 'pct',     label: 'Resp.\n%',                               w: 38,  kind: 'text',    align: 'center' },
  { key: 'ffi',     label: 'FFI\nScore',                             w: 34,  kind: 'ffi' },
  { key: 'student', label: 'Student Comments\n(Key Points)',         w: 140, kind: 'bullets' },
  { key: 'hod',     label: 'HOD Comments\n(Action Taken / Remarks)', w: 140, kind: 'bullets' },
  { key: 'provc',   label: 'Pro-VC Comments',                        w: 138, kind: 'bullets', bg: C.commentBg },
];

function drawOverallComments(doc, vcComment, y, maxBottom) {
  const bw = PAGE_W - MARGIN * 2;
  const TITLE_H = 16;
  doc.rect(MARGIN, y, bw, TITLE_H).fill(C.darkBlue);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('white')
     .text('OVERALL VC COMMENTS (FOR THE DEPARTMENT)', MARGIN, y + 3, { width: bw, align: 'center' });
  y += TITLE_H;

  const items = splitSentences(vcComment);
  doc.font('Helvetica').fontSize(8.5);
  let bodyH = 10;
  for (const it of items) bodyH += doc.heightOfString(it, { width: bw - 28 }) + 5;
  if (!items.length) bodyH = 22;
  bodyH = Math.min(bodyH, Math.max(30, maxBottom - y));

  drawRect(doc, MARGIN, y, bw, bodyH, '#FFFBEA');

  if (!items.length) {
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(C.textGrey)
       .text('No overall VC comments recorded for this department yet.', MARGIN + 14, y + 6, { width: bw - 28 });
  } else {
    let ty = y + 7;
    for (const it of items) {
      doc.font('Helvetica').fontSize(8.5).fillColor(C.textDark);
      const th = doc.heightOfString(it, { width: bw - 28 });
      if (ty + th > y + bodyH - 2) { doc.text('…', MARGIN + 20, ty, { width: 20, lineBreak: false }); break; }
      doc.text('•', MARGIN + 8, ty, { width: 10, lineBreak: false });
      doc.text(it, MARGIN + 20, ty, { width: bw - 28 });
      ty += th + 5;
    }
  }
  return y + bodyH;
}

async function generateDepartmentProVCReport({
  submission, reports, hodUser, vcUser, approvedDate, avgResponse, dfi, programme,
}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = createDoc('Department Overall Pro-VC Comments Report', 'Department Overall Pro-VC Comments Report');
    doc.on('data', ch => chunks.push(ch));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      const getProvc = buildProvcLookup(submission);

      // Rows keep ORIGINAL order; faculty name written on every row
      const rows = (reports || []).map((r, i) => {
        const row = buildRow(r, i, getProvc, true);
        row.faculty = safe(r.facultyName, 'Unknown');
        return row;
      });

      const heights = rows.map(row => rowHeight(doc, DEPT_COLS, row));

      drawHeader(doc);
      let y = drawTitleBar(doc, HEADER_BOTTOM, DEPT_TITLE) + 3;
      y = drawInfoGrid(doc, [
        ['Department', safe(submission.department || hodUser?.department), 'Academic Session',    sessionLabelOf(submission)],
        ['Programme',  safe(programme || submission.programme, 'B.Tech.'),  'Report Generated On', fmtDate()],
      ], y) + 4;
      y = drawColHeader(doc, DEPT_COLS, y);

      const contPage = () => {
        const ny = newPlainPage(doc, DEPT_TITLE) - 1;
        return drawColHeader(doc, DEPT_COLS, ny);
      };

      for (let i = 0; i < rows.length; i++) {
        if (y + heights[i] > TABLE_BOTTOM) y = contPage();
        drawRow(doc, DEPT_COLS, rows[i], y, heights[i], i % 2 === 1);
        y += heights[i];
      }

      if (!rows.length) {
        doc.font('Helvetica').fontSize(10).fillColor(C.textMid)
           .text('No course reports available for this department.', MARGIN, y + 10, { width: PAGE_W - MARGIN * 2 });
        y += 30;
      }

      y += 8;
      const bw = PAGE_W - MARGIN * 2;
      doc.font('Helvetica').fontSize(8.5);
      const items = splitSentences(submission.vcComment);
      let boxH = 16 + 10;
      for (const it of items) boxH += doc.heightOfString(it, { width: bw - 28 }) + 5;
      if (!items.length) boxH = 16 + 22;

      if (y + boxH > TABLE_BOTTOM - SIG_H - 12) {
        if (y + boxH > TABLE_BOTTOM) y = newPlainPage(doc, DEPT_TITLE);
      }
      y = drawOverallComments(doc, submission.vcComment, y, TABLE_BOTTOM - SIG_H - 14);

      drawSignatures(doc, y, { hodUser, vcUser, approvedDate, title: DEPT_TITLE });
      drawFooters(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateProVCReport, generateDepartmentProVCReport };
