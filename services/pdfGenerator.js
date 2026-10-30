// pdfGenerator.js
// Action Taken Report PDF.
// - White table header with black text
// - Code and Batch always on separate lines (never split mid-word)
// - Every comment line starts at the same x position
// - ALL comments are printed (no word-count filter), including object-style comments
// - Signatures are scaled to fit inside their cell (never overlap other text)
const { PDFDocument, rgb, StandardFonts, degrees } = require("pdf-lib");
const fs2 = require("fs");
const path = require("path");

const HEADER_PATH = path.join(__dirname, "../assets/mits-header.png");
let _headerBytes = null;
try {
  if (fs2.existsSync(HEADER_PATH)) {
    _headerBytes = fs2.readFileSync(HEADER_PATH);
  }
} catch (e) {}

function escapeRegExp(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function generateFeedbackReportPDF({
  submission,
  reports,
  hodUser,
  vcUser,
  approvedAt,
  isPreview = false,
  withoutSignatures = false,
  hideVCSignature = false,
}) {
  const User = require("../models/User");
  const HODComment = require("../models/HODComment");

  submission = submission || {};
  reports = Array.isArray(reports) ? reports : [];

  // ── HOD department-level comment ──────────────────────────────────────────
  let hodCommentText = null;
  try {
    if (hodUser?.department) {
      const queryParams = {
        department: hodUser.department,
        academicYear: submission.academicYear || "2026-2027",
        session: submission.session || "",
      };
      const commentDoc = await HODComment.findOne(queryParams).lean();
      console.log("[PDF] Department-level HOD comment found:", commentDoc ? "YES" : "NO");
      hodCommentText = commentDoc?.comment || null;
    }
  } catch (err) {
    console.error("[PDF] Failed to fetch HOD comment:", err.message);
    hodCommentText = null;
  }

  // ── Individual report remarks (hodRemarks) ────────────────────────────────
  const individualComments = [];
  reports.forEach((r) => {
    if (r.hodRemarks && String(r.hodRemarks).trim()) {
      individualComments.push({
        facultyName: r.facultyName || "Unknown",
        subjectCode: r.subjectCode || "",
        remark: String(r.hodRemarks).trim(),
      });
    }
  });
  console.log("[PDF] Individual report comments found:", individualComments.length);

  // ── PDF document & fonts ──────────────────────────────────────────────────
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const timesFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const timesBoldFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

  // ── Colours ───────────────────────────────────────────────────────────────
  const black = rgb(0, 0, 0);
  const white = rgb(1, 1, 1);
  const blue = rgb(0.118, 0.227, 0.541);
  const red = rgb(0.8, 0.1, 0.1);
  const green = rgb(0.082, 0.325, 0.173);
  const amber = rgb(0.7, 0.4, 0);
  const darkBlue = rgb(0.05, 0.15, 0.4);

  // ── Page geometry ─────────────────────────────────────────────────────────
  const PW = 842, PH = 595, ML = 20, MR = 20, CW = 802;
  const TOP_MARGIN = 30;
  const BOTTOM_MARGIN = 30;

  const today = new Date(approvedAt || Date.now()).toLocaleDateString("en-IN", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });

  // ── Text helpers ──────────────────────────────────────────────────────────
  // Keep only characters the standard PDF fonts can encode.
  function sanitize(s) {
    return String(s == null ? "" : s)
      .replace(/\r/g, "")
      .replace(/\t/g, " ")
      .replace(/[^\n\x20-\x7E\u00A0-\u00FF\u2022\u2013\u2014\u2018\u2019\u201C\u201D\u2026]/g, "?");
  }

  function txt(page, text, x, y, size, f, color) {
    if (!text) return;
    try {
      page.drawText(sanitize(text), { x, y, size, font: f || font, color: color || black });
    } catch (e) {}
  }
  function rect(page, x, y, w, h, opts) {
    page.drawRectangle({ x, y, width: w, height: h, ...opts });
  }
  function line(page, x1, y1, x2, y2, thickness, color) {
    page.drawLine({
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      thickness: thickness || 0.5,
      color: color || black,
    });
  }

  // ── Text layout constants (table body) ────────────────────────────────────
  const FS = 8;            // body font size
  const LH = 10;           // line height
  const SPACER_H = 3;
  const PAD_TOP = 4;
  const PAD_BOT = 4;
  const CELL_PAD_X = 5;

  // Wrap text using REAL font metrics -> [{text, indent, spacer, h}].
  // Same lines are used to measure AND draw. All lines start at the same x
  // (bulletIndent = 0), so comments line up vertically.
  function wrapCell(text, maxW, f, size, lh = LH, spacerH = SPACER_H, bulletIndent = 0) {
    const out = [];
    sanitize(text).split("\n").forEach((seg) => {
      if (!seg.trim()) {
        out.push({ text: "", indent: 0, spacer: true, h: spacerH });
        return;
      }
      const words = seg.split(/\s+/).filter(Boolean);
      let cur = "";
      const push = () => {
        out.push({ text: cur, indent: bulletIndent, spacer: false, h: lh });
        cur = "";
      };
      words.forEach((word0) => {
        let word = word0;
        const test = cur ? cur + " " + word : word;
        if (f.widthOfTextAtSize(test, size) <= maxW) {
          cur = test;
          return;
        }
        if (cur) push();
        // a single word wider than the cell is broken with a hyphen
        while (word.length > 1 && f.widthOfTextAtSize(word, size) > maxW) {
          let n = word.length;
          while (n > 1 && f.widthOfTextAtSize(word.slice(0, n) + "-", size) > maxW) n--;
          cur = word.slice(0, n) + "-";
          push();
          word = word.slice(n);
        }
        cur = word;
      });
      if (cur) push();
    });
    while (out.length && out[out.length - 1].spacer) out.pop();
    while (out.length && out[0].spacer) out.shift();
    return out.length ? out : [{ text: "", indent: 0, spacer: false, h: lh }];
  }

  // Wrap a person's name so it never leaves its box.
  function wrapName(name, maxW, f, size) {
    const words = sanitize(name).split(/\s+/).filter(Boolean);
    const out = [];
    let cur = "";
    words.forEach((w0) => {
      let w = w0;
      const t = cur ? cur + " " + w : w;
      if (f.widthOfTextAtSize(t, size) <= maxW) {
        cur = t;
        return;
      }
      if (cur) out.push(cur);
      cur = "";
      while (w.length > 1 && f.widthOfTextAtSize(w, size) > maxW) {
        let n = w.length;
        while (n > 1 && f.widthOfTextAtSize(w.slice(0, n), size) > maxW) n--;
        out.push(w.slice(0, n));
        w = w.slice(n);
      }
      cur = w;
    });
    if (cur) out.push(cur);
    return out;
  }

  // ── Signature embedding ───────────────────────────────────────────────────
  async function embedSig(b64) {
    if (!b64) return null;
    try {
      const d = b64.replace(/^data:image\/\w+;base64,/, "");
      const bytes = Buffer.from(d, "base64");
      return b64.includes("image/png") ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
    } catch {
      return null;
    }
  }
  async function cropAndEmbedSig(b64) {
    if (!b64) return null;
    try {
      const sharp = require("sharp");
      const d = b64.replace(/^data:image\/\w+;base64,/, "");
      const bytes = Buffer.from(d, "base64");
      const cropped = await sharp(bytes).trim({ threshold: 30 }).png().toBuffer();
      return await pdfDoc.embedPng(cropped);
    } catch (e) {
      return embedSig(b64);
    }
  }

  // Draw an image scaled to fit INSIDE a box (never overflows), centred.
  function drawFitted(page, img, bx, by, bw, bh, align = "center") {
    if (!img || bw <= 0 || bh <= 0) return;
    const s = Math.min(bw / img.width, bh / img.height, 1);
    const iw = img.width * s;
    const ih = img.height * s;
    const ix = align === "center" ? bx + (bw - iw) / 2 : bx;
    page.drawImage(img, { x: ix, y: by + (bh - ih) / 2, width: iw, height: ih });
  }

  // ── Clean course name ─────────────────────────────────────────────────────
  function cleanCourseName(name) {
    if (!name) return "";
    return String(name)
      .replace(/\bsubmitted\s+answers?\s*:?\s*-?\s*/gi, "")
      .replace(/\bsubmitted\s+responses?\s*:?\s*-?\s*/gi, "")
      .replace(/\bstudent\s+feedback\s*:?\s*-?\s*/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Comment -> text. Handles strings AND objects saved in the database.
  const toText = (c) => {
    if (c == null) return "";
    if (typeof c === "string") return c;
    if (typeof c === "number") return String(c);
    return c.text || c.comment || c.remark || c.response || c.answer || c.value || "";
  };
  // Every non-empty comment is kept (no minimum word count).
  const toBullets = (arr) =>
    (Array.isArray(arr) ? arr : arr ? [arr] : [])
      .map((c) => String(toText(c)).trim())
      .filter(Boolean)
      .map((x) => "\u2022 " + x);
  // First key that actually has data (an empty [] does not win).
  const pick = (...c) => c.find((v) => (Array.isArray(v) ? v.length : v)) || [];

  // ── Reports: keep all, sort by faculty then subject code ──────────────────
  console.log(`[PDF] Total reports received: ${reports.length}`);
  const uniqueReports = [...reports];
  uniqueReports.sort((a, b) => {
    const nameA = (a.facultyName || "").toLowerCase();
    const nameB = (b.facultyName || "").toLowerCase();
    if (nameA !== nameB) return nameA.localeCompare(nameB);
    return (a.subjectCode || "").toLowerCase().localeCompare((b.subjectCode || "").toLowerCase());
  });

  // ── Faculty signatures ────────────────────────────────────────────────────
  const facultySigMap = {};
  if (!withoutSignatures) {
    for (const r of uniqueReports) {
      const key = (r.facultyName || "").toLowerCase().trim();
      if (facultySigMap[key]) continue;
      if (r.facultyUserId) {
        try {
          const fu = await User.findById(r.facultyUserId).select("signatureImage");
          if (fu && fu.signatureImage) {
            const img = await cropAndEmbedSig(fu.signatureImage);
            if (img) { facultySigMap[key] = img; continue; }
          }
        } catch (e) {}
      }
      try {
        const fu = await User.findOne({
          role: "faculty",
          name: new RegExp(escapeRegExp((r.facultyName || "").trim()), "i"),
        }).select("signatureImage");
        if (fu && fu.signatureImage) {
          const img = await cropAndEmbedSig(fu.signatureImage);
          if (img) facultySigMap[key] = img;
        }
      } catch (e) {}
    }
  }

  const hodSig = withoutSignatures ? null : await cropAndEmbedSig(hodUser && hodUser.signatureImage);
  const vcSig = withoutSignatures || hideVCSignature ? null : await cropAndEmbedSig(vcUser && vcUser.signatureImage);
  console.log("[PDF] Sigs — HOD:", !!hodSig, "VC:", !!vcSig, "Faculty:", Object.keys(facultySigMap).length);

  // ── Header image (cached) ─────────────────────────────────────────────────
  let _embH = null;
  async function drawHeader(page, y) {
    if (_headerBytes) {
      if (!_embH) {
        try { _embH = await pdfDoc.embedPng(_headerBytes); } catch (e) {}
      }
      if (_embH) {
        const iH = Math.round((CW * _embH.height) / _embH.width);
        page.drawImage(_embH, { x: ML, y: y - iH, width: CW, height: iH });
        line(page, ML, y - iH - 4, PW - MR, y - iH - 4, 0.8, black);
        return y - iH - 14;
      }
    }
    line(page, ML, y, PW - MR, y, 1.5, blue);
    txt(page, "MADHAV INSTITUTE OF TECHNOLOGY & SCIENCE, GWALIOR (M.P.), INDIA", ML + 42, y - 10, 8.5, boldFont, blue);
    txt(page, "(Deemed University) - NAAC A++ Grade", ML + 42, y - 22, 7, font, red);
    line(page, ML, y - 32, PW - MR, y - 32, 0.8, black);
    return y - 36;
  }

  // ── Column definitions (widths add up to exactly CW = 802) ────────────────
  const COL_DEFS = [
    { key: "sno",     w: 24,  hdr: ["S.No"] },
    { key: "faculty", w: 76,  hdr: ["Faculty", "Name"] },
    { key: "code",    w: 70,  hdr: ["Code /", "Batch"] },
    { key: "course",  w: 90,  hdr: ["Course", "Name"] },
    { key: "sem",     w: 24,  hdr: ["Sem"] },
    { key: "ffi",     w: 34,  hdr: ["FFI"] },
    { key: "resp",    w: 46,  hdr: ["Resp.", "%"] },
    { key: "attn",    w: 132, hdr: ["Needs", "Attention"] },
    { key: "appr",    w: 146, hdr: ["Appreciation"] },
    { key: "action",  w: 96,  hdr: ["Action", "Taken"] },
    { key: "sig",     w: 64,  hdr: ["Faculty", "Signature"] },
  ];
  let _cx = ML;
  const COLS = COL_DEFS.map((c) => {
    const o = { ...c, x: _cx };
    _cx += c.w;
    return o;
  });
  const sigColIdx = COLS.length - 1;

  const TH = 30; // table header height

  // Header: WHITE background, BLACK text and borders.
  function drawTableHeader(page, y) {
    rect(page, ML, y - TH, CW, TH, { color: white, borderColor: black, borderWidth: 0.8 });
    COLS.forEach((col, ci) => {
      if (ci > 0) line(page, col.x, y, col.x, y - TH, 0.8, black);
    });
    const HFS = 9;
    const HLH = 11;
    COLS.forEach((col) => {
      const totalH = col.hdr.length * HLH;
      const startY = y - (TH - totalH) / 2 - HFS;
      col.hdr.forEach((l, li) => {
        const lw = boldFont.widthOfTextAtSize(l, HFS);
        const lx = col.x + Math.max(1, (col.w - lw) / 2);
        txt(page, l, lx, startY - li * HLH, HFS, boldFont, black);
      });
    });
    return y - TH;
  }

  // ── Page state ────────────────────────────────────────────────────────────
  let page = pdfDoc.addPage([PW, PH]);
  let y = PH - 15;

  function newPlainPage() {
    page = pdfDoc.addPage([PW, PH]);
    y = PH - TOP_MARGIN;
  }
  async function newTablePage() {
    page = pdfDoc.addPage([PW, PH]);
    y = PH - 15;
    y = await drawHeader(page, y);
    y = drawTableHeader(page, y);
  }

  // ── Cover section ─────────────────────────────────────────────────────────
  y = await drawHeader(page, y);
  y -= 10;

  const atrText = "Action Taken Report";
  txt(page, atrText, PW / 2 - timesBoldFont.widthOfTextAtSize(atrText, 16) / 2, y, 16, timesBoldFont, black);
  y -= 18;

  const formNo = submission.feedbackFormNo || "I";
  const ffTitle = "Faculty Feedback \u2013 " + formNo;
  txt(page, ffTitle, PW / 2 - timesBoldFont.widthOfTextAtSize(ffTitle, 18) / 2, y, 18, timesBoldFont, darkBlue);
  y -= 18;

  const dT = sanitize((hodUser && hodUser.department) || "Centre for Computer Science and Technology");
  txt(page, dT, PW / 2 - timesFont.widthOfTextAtSize(dT, 14) / 2, y, 14, timesFont, black);
  y -= 16;

  const sessionLabel = submission.session === "jan-may" ? "January \u2013 May" : "July \u2013 December";
  const ayText = "Academic Year \u2013 " + (submission.academicYear || "2025-26");
  const sessText = "Session: " + sessionLabel;
  txt(page, ayText, ML, y, 11, timesFont, black);
  txt(page, sessText, PW - MR - timesFont.widthOfTextAtSize(sessText, 11), y, 11, timesFont, black);
  y -= 14;

  const fmt = (d) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
  const subDate = submission.submissionDate ? fmt(submission.submissionDate) : today;
  const finalDate = submission.finalReportDate ? fmt(submission.finalReportDate) : today;
  const fbSubText = "Feedback Submitted: " + subDate;
  const repGenText = "Report Generated: " + finalDate;
  txt(page, fbSubText, ML, y, 11, timesFont, black);
  txt(page, repGenText, PW - MR - timesFont.widthOfTextAtSize(repGenText, 11), y, 11, timesFont, black);
  y -= 15;

  const allFFIs = uniqueReports.map((r) => r.ffiScore).filter((v) => v != null);
  const avgFFI = allFFIs.length ? (allFFIs.reduce((s, v) => s + Number(v), 0) / allFFIs.length).toFixed(2) : "\u2014";
  const allRespPcts = uniqueReports.map((r) => r.responsePercent).filter((v) => v != null);
  const allResp = uniqueReports.map((r) => r.responseCount || r.totalResponses || 0).filter(Boolean);
  const avgResp = allRespPcts.length
    ? (allRespPcts.reduce((s, v) => s + Number(v), 0) / allRespPcts.length).toFixed(2) + "%"
    : allResp.length
    ? (allResp.reduce((s, v) => s + Number(v), 0) / allResp.length).toFixed(2)
    : "\u2014";
  const avgFFIText = "Average FFI \u2013 " + avgFFI;
  const avgRespText = "Average Response \u2013 " + avgResp;
  txt(page, avgFFIText, ML, y, 11, timesBoldFont, black);
  txt(page, avgRespText, PW - MR - timesBoldFont.widthOfTextAtSize(avgRespText, 11), y, 11, timesBoldFont, black);
  y -= 18;

  // ── HOD comments (department-level + individual remarks) ──────────────────
  const hasComments = (hodCommentText && hodCommentText.trim()) || individualComments.length > 0;
  if (hasComments) {
    const CFS = 9;
    const CLH = 11;
    const maxW = CW - 8;
    const cLines = [];

    if (hodCommentText && hodCommentText.trim()) {
      cLines.push({ text: "Department-level Remarks:", bold: true, indent: 0, h: CLH });
      wrapCell(hodCommentText.trim(), maxW, timesFont, CFS, CLH, 4).forEach((l) =>
        cLines.push({ ...l, bold: false })
      );
      if (individualComments.length > 0) cLines.push({ text: "", bold: false, indent: 0, spacer: true, h: 5 });
    }
    if (individualComments.length > 0) {
      cLines.push({ text: "Remarks on individual reports:", bold: true, indent: 0, h: CLH });
      individualComments.forEach((c) => {
        const label = c.facultyName + (c.subjectCode ? " (" + c.subjectCode + ")" : "") + ": " + c.remark;
        wrapCell("\u2022 " + label, maxW, timesFont, CFS, CLH, 4).forEach((l) =>
          cLines.push({ ...l, bold: false })
        );
      });
    }

    cLines.forEach((l) => {
      if (y - l.h < BOTTOM_MARGIN + TH + 40) newPlainPage();
      if (!l.spacer && l.text) {
        txt(page, l.text, ML + 4 + (l.indent || 0), y - CFS, CFS, l.bold ? timesBoldFont : timesFont, black);
      }
      y -= l.h;
    });
    y -= 8;
  }

  // ── Table start ───────────────────────────────────────────────────────────
  if (y - BOTTOM_MARGIN < TH + 60) newPlainPage();
  y = drawTableHeader(page, y);

  // ── Table rows ────────────────────────────────────────────────────────────
  const SIG_IMG_H = 22;   // max signature image height inside the row cell
  const SIG_NAME_FS = 6;
  const SIG_NAME_LH = 7;
  const MIN_SPLIT = 45;   // min free space needed to START a row on this page

  const single = (t) => [{ text: sanitize(t), indent: 0, spacer: false, h: LH }];
  const wrapIn = (t, ci) => wrapCell(t, COLS[ci].w - CELL_PAD_X * 2, timesFont, FS);
  const sumH = (lines) => lines.reduce((s, l) => s + l.h, 0);

  for (let i = 0; i < uniqueReports.length; i++) {
    const r = uniqueReports[i];

    // ---- cell texts ----
    // Code on line 1, Batch on line 2 (always separate lines).
    const rawCode = String(r.subjectCode || "-").trim();
    let codeBatch;
    if (r.batch) {
      codeBatch = rawCode + "\n" + String(r.batch).trim();
    } else {
      const cut = rawCode.lastIndexOf("-");
      codeBatch = cut > 0 ? rawCode.slice(0, cut).trim() + "\n" + rawCode.slice(cut + 1).trim() : rawCode;
    }

    const attList = pick(
      r.commentsNeedingAttention, r.needsAttention, r.needs_attention, r.attention, r.improvements
    );
    const attText = toBullets(attList).join("\n") || "-";

    const pcts = r.commentPercentages || {};
    const pctLines = Object.entries(pcts)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => "\u2022 " + k + ": " + v + "%")
      .join("\n");
    const allAppreciations = toBullets(r.appreciation);
    const appText = [pctLines, ...allAppreciations].filter(Boolean).join("\n") || "-";

    console.log(
      `[PDF] #${i + 1} ${r.facultyName}: appreciation=${allAppreciations.length}, needsAttention=${toBullets(attList).length}`
    );

    const actionText = String(
      toText(r.actionTaken || r.action_taken || r.hodAction || r.hodActionTaken) || "-"
    );

    const ffi = r.ffiScore;
    const ffiNum = ffi != null ? Number(ffi) : null;
    const ffiColor = ffiNum != null && !isNaN(ffiNum) ? (ffiNum >= 4 ? green : ffiNum >= 3 ? amber : red) : black;
    const ffiDisplay = ffiNum != null && !isNaN(ffiNum) ? ffiNum.toFixed(2) : "-";
    const respDisplay =
      r.responsePercent != null && r.responsePercent !== ""
        ? (isNaN(Number(r.responsePercent)) ? String(r.responsePercent) : Number(r.responsePercent).toFixed(2)) + "%"
        : "-";
    const courseName = cleanCourseName(r.courseName || r.subjectName || r.course || r.subject) || "-";
    const sem = r.semester != null && r.semester !== "" ? String(r.semester) : r.sem != null ? String(r.sem) : "-";

    const facKey = (r.facultyName || "").toLowerCase().trim();
    const sigImg = facultySigMap[facKey] || null;

    // ---- build cells with real-metric wrapping ----
    const cells = [
      { lines: single(String(i + 1)), font: timesBoldFont, center: true },
      { lines: wrapIn(r.facultyName || "-", 1), font: timesFont },
      { lines: wrapIn(codeBatch, 2), font: timesFont },
      { lines: wrapIn(courseName, 3), font: timesFont },
      { lines: single(sem), font: timesFont, center: true },
      { lines: single(ffiDisplay), font: timesBoldFont, center: true, color: ffiColor },
      { lines: single(respDisplay), font: timesFont, center: true },
      { lines: wrapIn(attText, 7), font: timesFont },
      { lines: wrapIn(appText, 8), font: timesFont },
      { lines: wrapIn(actionText, 9), font: timesFont },
      { lines: [], font: timesFont }, // signature column: drawn separately
    ];

    // Signature cell: image on top, name underneath (name always stays inside).
    const sigCol = COLS[sigColIdx];
    const sigNameLines = wrapName(r.facultyName || "", sigCol.w - 6, font, SIG_NAME_FS);
    const sigImgH = sigImg ? SIG_IMG_H : 0;
    const sigNeeded = PAD_TOP + sigImgH + (sigImg ? 2 : 0) + sigNameLines.length * SIG_NAME_LH + PAD_BOT;

    // ---- draw (splitting across pages when needed) ----
    let pending = cells.map((c) => c.lines.slice());
    let guard = 0;
    while (guard++ < 200) {
      const avail = y - BOTTOM_MARGIN;
      const contentNeeded = Math.max(...pending.map((l) => (l.length ? sumH(l) : 0))) + PAD_TOP + PAD_BOT;
      const needed = Math.max(contentNeeded, sigNeeded);

      let isLast = needed <= avail;
      if (!isLast && avail < MIN_SPLIT) {
        await newTablePage();
        continue;
      }

      // decide which lines go in this chunk
      const take = pending.map(() => []);
      if (isLast) {
        pending.forEach((l, ci) => { take[ci] = l; });
      } else {
        const room = avail - PAD_TOP - PAD_BOT;
        pending.forEach((l, ci) => {
          let used = 0;
          let n = 0;
          while (n < l.length && used + l[n].h <= room) { used += l[n].h; n++; }
          take[ci] = l.slice(0, n);
        });
        if (take.every((t) => t.length === 0)) {
          // safety: force progress
          const ci = pending.findIndex((l) => l.length);
          if (ci >= 0) take[ci] = pending[ci].slice(0, 1);
        }
      }

      const usedH = Math.max(...take.map((t) => sumH(t)), 0);
      let rowH = isLast ? needed : Math.min(avail, usedH + PAD_TOP + PAD_BOT);
      if (!isLast) rowH = Math.max(rowH, usedH + PAD_TOP + PAD_BOT);

      // row border + column dividers
      rect(page, ML, y - rowH, CW, rowH, { borderColor: black, borderWidth: 0.5 });
      COLS.forEach((col, ci) => {
        if (ci > 0) line(page, col.x, y, col.x, y - rowH, 0.5, black);
      });

      // cell text — every line starts at the same x for its column
      take.forEach((lines, ci) => {
        const col = COLS[ci];
        const c = cells[ci];
        let ly = y - PAD_TOP;
        lines.forEach((l) => {
          if (!l.spacer && l.text) {
            let lx = col.x + CELL_PAD_X + (l.indent || 0);
            if (c.center) {
              const lw = c.font.widthOfTextAtSize(l.text, FS);
              lx = col.x + Math.max(1, (col.w - lw) / 2);
            }
            txt(page, l.text, lx, ly - FS, FS, c.font, c.color || black);
          }
          ly -= l.h;
        });
      });

      // signature cell (on the last chunk of the row)
      if (isLast) {
        let sy = y - PAD_TOP;
        if (sigImg) {
          drawFitted(page, sigImg, sigCol.x + 3, sy - SIG_IMG_H, sigCol.w - 6, SIG_IMG_H);
          sy -= SIG_IMG_H + 2;
        }
        sigNameLines.forEach((nl) => {
          const lw = font.widthOfTextAtSize(nl, SIG_NAME_FS);
          txt(page, nl, sigCol.x + Math.max(1, (sigCol.w - lw) / 2), sy - SIG_NAME_FS, SIG_NAME_FS, font, black);
          sy -= SIG_NAME_LH;
        });
      }

      y -= rowH;

      if (isLast) break;
      pending = pending.map((l, ci) => l.slice(take[ci].length));
      await newTablePage();
    }
  }

  // ── Footer: HOD / Pro-VC signatures ───────────────────────────────────────
  const FOOT_H = 52;
  const NOTE_H = 16;
  if (y - BOTTOM_MARGIN < FOOT_H + NOTE_H + 10) await newTablePage();
  y -= 6;

  txt(page, "FFI & Suggestions are noted for further improvement.", ML, y - 9, 9, timesBoldFont, black);
  y -= NOTE_H;

  function drawSigCell(pg, { x, w, h, label, name, img }) {
    const yBot = y - h;
    rect(pg, x, yBot, w, h, { borderColor: black, borderWidth: 0.6 });
    const labelW = 110;
    // label + name on the left (wrapped, always inside)
    const lbl = wrapName(label, labelW - 8, boldFont, 8);
    const nm = name ? wrapName(name, labelW - 8, font, 7) : [];
    const totalH = lbl.length * 10 + nm.length * 8;
    let ty = y - (h - totalH) / 2;
    lbl.forEach((l) => { txt(pg, l, x + 5, ty - 8, 8, boldFont, black); ty -= 10; });
    nm.forEach((l) => { txt(pg, l, x + 5, ty - 7, 7, font, black); ty -= 8; });
    // signature fitted into the remaining area on the right
    if (img) drawFitted(pg, img, x + labelW, yBot + 3, w - labelW - 5, h - 6);
  }

  const halfW = CW / 2;
  drawSigCell(page, { x: ML, w: halfW, h: FOOT_H, label: "HOD", name: hodUser && hodUser.name, img: hodSig });
  drawSigCell(page, { x: ML + halfW, w: halfW, h: FOOT_H, label: "PRO - VC", name: vcUser && vcUser.name, img: vcSig });
  y -= FOOT_H;

  // ── Preview watermark + page numbers ──────────────────────────────────────
  const pages = pdfDoc.getPages();
  pages.forEach((pg, idx) => {
    if (isPreview) {
      try {
        pg.drawText("PREVIEW", {
          x: 190, y: 170, size: 110, font: boldFont,
          color: rgb(0.85, 0.85, 0.85), rotate: degrees(30), opacity: 0.45,
        });
      } catch (e) {}
    }
    const label = `Page ${idx + 1} of ${pages.length}`;
    txt(pg, label, PW - MR - font.widthOfTextAtSize(label, 7), 14, 7, font, black);
  });

  return Buffer.from(await pdfDoc.save());
}

module.exports = { generateFeedbackReportPDF };
