// pdfGenerator.js — rewrite: exact text measurement, tight row heights,
// clean page splitting, signature names that always stay inside the cell.
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

  // ── HOD department-level comment ──────────────────────────────────────────
  let hodCommentText = null;
  try {
    if (hodUser?.department) {
      const queryParams = {
        department: hodUser.department,
        academicYear: submission?.academicYear || "2026-2027",
        session: submission?.session || "",
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
    if (r.hodRemarks && r.hodRemarks.trim()) {
      individualComments.push({
        facultyName: r.facultyName || "Unknown",
        subjectCode: r.subjectCode || "",
        remark: r.hodRemarks.trim(),
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
  const gray = rgb(0.5, 0.5, 0.5);
  const blue = rgb(0.118, 0.227, 0.541);
  const red = rgb(0.8, 0.1, 0.1);
  const green = rgb(0.082, 0.325, 0.173);
  const amber = rgb(0.7, 0.4, 0);
  const darkBlue = rgb(0.05, 0.15, 0.4);
  const headerFill = rgb(0.118, 0.227, 0.541);

  // ── Page geometry ─────────────────────────────────────────────────────────
  const PW = 842, PH = 595, ML = 20, MR = 20, CW = 802;
  const TOP_MARGIN = 30;
  const BOTTOM_MARGIN = 30;

  const today = new Date(approvedAt || Date.now()).toLocaleDateString("en-IN", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });

  // ── Drawing helpers ───────────────────────────────────────────────────────
  function txt(page, text, x, y, size, f, color) {
    if (!text) return;
    try {
      page.drawText(String(text), { x, y, size, font: f || font, color: color || black });
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

  // Keep only characters the standard PDF fonts can encode (prevents crashes
  // inside widthOfTextAtSize / drawText).
  function sanitize(s) {
    return String(s == null ? "" : s)
      .replace(/\r/g, "")
      .replace(/\t/g, " ")
      .replace(/[^\n\x20-\x7E\u00A0-\u00FF\u2022\u2013\u2014\u2018\u2019\u201C\u201D\u2026]/g, "?");
  }

  // ── Text layout constants (table body) ────────────────────────────────────
  const MIN_COMMENT_WORDS = 0; // show ALL comments regardless of length
  const FS = 8;            // body font size
  const LH = 10;           // line height
  const SPACER_H = 3;      // blank line between paragraphs
  const PAD_TOP = 4;
  const PAD_BOT = 4;
  const CELL_PAD_X = 6;    // left & right padding inside a cell

  // Wrap text using REAL font metrics -> returns [{text, indent, spacer, h}]
  // The same lines are used to measure AND to draw, so the row height is exact.
  function wrapCell(text, maxW, f, size, lh = LH, spacerH = SPACER_H, bulletIndent = 8) {
    const out = [];
    sanitize(text).split("\n").forEach((seg) => {
      if (!seg.trim()) {
        out.push({ text: "", indent: 0, spacer: true, h: spacerH });
        return;
      }
      const ind = seg.startsWith("\u2022 ") ? bulletIndent : 0;
      const words = seg.split(/\s+/).filter(Boolean);
      let cur = "";
      let first = true;
      const widthNow = () => maxW - (first ? 0 : ind);
      const push = () => {
        out.push({ text: cur, indent: first ? 0 : ind, spacer: false, h: lh });
        first = false;
        cur = "";
      };
      words.forEach((word0) => {
        let word = word0;
        const test = cur ? cur + " " + word : word;
        if (f.widthOfTextAtSize(test, size) <= widthNow()) {
          cur = test;
          return;
        }
        if (cur) push();
        // a single word wider than the cell is broken with a hyphen
        while (word.length > 1 && f.widthOfTextAtSize(word, size) > widthNow()) {
          let n = word.length;
          while (n > 1 && f.widthOfTextAtSize(word.slice(0, n) + "-", size) > widthNow()) n--;
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

  // Wrap a person's name so it NEVER leaves its box: break on spaces
  // (first / middle / last name), and only break inside a word as last resort.
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
      const cropped = await sharp(bytes).trim({ threshold: 30 }).toBuffer();
      return b64.includes("image/png") ? await pdfDoc.embedPng(cropped) : await pdfDoc.embedJpg(cropped);
    } catch (e) {
      return embedSig(b64);
    }
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

  const hodSig = await cropAndEmbedSig(hodUser && hodUser.signatureImage);
  const vcSig = await cropAndEmbedSig(vcUser && vcUser.signatureImage);
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
    { label: "S.No",              w: 24,  hdr: ["S.No"] },
    { label: "Faculty Name",      w: 76,  hdr: ["Faculty", "Name"] },
    { label: "Code/Batch",        w: 56,  hdr: ["Code /", "Batch"] },
    { label: "Course Name",       w: 80,  hdr: ["Course", "Name"] },
    { label: "Sem",               w: 22,  hdr: ["Sem"] },
    { label: "FFI",               w: 34,  hdr: ["FFI"] },
    { label: "Resp. %",           w: 46,  hdr: ["Resp.", "%"] },
    { label: "Needs Attention",   w: 142, hdr: ["Needs", "Attention"] },
    { label: "Appreciation",      w: 156, hdr: ["Appreciation"] },
    { label: "Action Taken",      w: 100, hdr: ["Action", "Taken"] },
    { label: "Faculty Signature", w: 66,  hdr: ["Faculty", "Signature"] },
  ];
  let _cx = ML;
  const COLS = COL_DEFS.map((c) => {
    const o = { ...c, x: _cx };
    _cx += c.w;
    return o;
  });
  const sigCol = COLS[COLS.length - 1];

  const TH = 30; // table header height

  function drawTableHeader(page, y) {
    // Highlighted header: dark-blue fill, white bold text, white dividers
    rect(page, ML, y - TH, CW, TH, { color: headerFill, borderColor: headerFill, borderWidth: 0.5 });
    COLS.forEach((col, ci) => {
      if (ci > 0) line(page, col.x, y, col.x, y - TH, 0.8, white);
    });
    const HFS = 9;
    const HLH = 11;
    COLS.forEach((col) => {
      const hLines = col.hdr;
      const totalH = hLines.length * HLH;
      const startY = y - (TH - totalH) / 2 - HFS;
      hLines.forEach((l, li) => {
        const lw = boldFont.widthOfTextAtSize(l, HFS);
        const lx = col.x + Math.max(1, (col.w - lw) / 2);
        txt(page, l, lx, startY - li * HLH, HFS, boldFont, white);
      });
    });
    return y - TH;
  }

  // ── Page state ────────────────────────────────────────────────────────────
  let page = pdfDoc.addPage([PW, PH]);
  let pageNumber = 1;
  let y = PH - 15;

  function newPlainPage() {
    page = pdfDoc.addPage([PW, PH]);
    pageNumber++;
    y = PH - TOP_MARGIN;
  }
  async function newTablePage() {
    page = pdfDoc.addPage([PW, PH]);
    pageNumber++;
    y = PH - 15;
    y = await drawHeader(page, y);  // draw MITS header on every continuation page
    y = drawTableHeader(page, y);
  }

  // ── Cover page ────────────────────────────────────────────────────────────
  y = await drawHeader(page, y);
  y -= 10;

  const atrText = "Action Taken Report";
  txt(page, atrText, PW / 2 - timesBoldFont.widthOfTextAtSize(atrText, 16) / 2, y, 16, timesBoldFont, black);
  y -= 18;

  const formNo = submission.feedbackFormNo || "I";
  const ffTitle = "Faculty Feedback \u2013 " + formNo;
  txt(page, ffTitle, PW / 2 - timesBoldFont.widthOfTextAtSize(ffTitle, 18) / 2, y, 18, timesBoldFont, darkBlue);
  y -= 18;

  const dT = (hodUser && hodUser.department) || "Centre for Computer Science and Technology";
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
  const avgFFI = allFFIs.length ? (allFFIs.reduce((s, v) => s + v, 0) / allFFIs.length).toFixed(2) : "\u2014";
  const allRespPcts = uniqueReports.map((r) => r.responsePercent).filter((v) => v != null);
  const allResp = uniqueReports.map((r) => r.responseCount || r.totalResponses || 0).filter(Boolean);
  const avgResp = allRespPcts.length
    ? (allRespPcts.reduce((s, v) => Number(s) + Number(v), 0) / allRespPcts.length).toFixed(2) + "%"
    : allResp.length
    ? (allResp.reduce((s, v) => Number(s) + Number(v), 0) / allResp.length).toFixed(2)
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
    const cLines = []; // {text, bold, indent, h}

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
      // keep room for at least the table header + a little content
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
  const SIG_IMG_H = 16;
  const SIG_NAME_FS = 6;
  const SIG_NAME_LH = 7;
  const MIN_SPLIT = 45; // minimum free space needed to START a row on this page

  const toBullets = (arr) =>
    (Array.isArray(arr) ? arr : arr ? [arr] : [])
      .filter((c) => typeof c === "string" && c.trim())
      .map((x) => "\u2022 " + x.trim());

  for (let i = 0; i < uniqueReports.length; i++) {
    const r = uniqueReports[i];

    // ---- cell texts ----
    // Split subjectCode on dash to put batch on second line e.g. "30261101\nBatch-A"
    const rawCode = r.subjectCode || "-";
    const dashIdx = rawCode.indexOf("-");
    const codeBatch = dashIdx > 0
      ? rawCode.slice(0, dashIdx).trim() + "\n" + rawCode.slice(dashIdx + 1).trim()
      : (r.batch ? rawCode + "\n" + r.batch : rawCode);

    const attList = r.commentsNeedingAttention || r.needsAttention || r.needs_attention || r.attention || r.improvements || [];
    const attText = toBullets(attList).join("\n") || "-";

    const pcts = r.commentPercentages || {};
    const pctLines = Object.entries(pcts)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => "\u2022 " + k + ": " + v + "%")
      .join("\n");
    const allAppreciations = (r.appreciation || [])
      .filter((c) => typeof c === "string" && c.trim())
      .map((x) => "\u2022 " + x.trim());
    const appText = [pctLines, ...allAppreciations].filter(Boolean).join("\n") || "-";

    console.log(`[PDF] #${i + 1} ${r.facultyName}: appreciation in=${(r.appreciation || []).length} shown=${allAppreciations.length}, needsAttention shown=${attList.length}, keys=${Object.keys(r).join(",")}`);

    const actionText = r.actionTaken || r.action_taken || r.hodAction || r.hodActionTaken || "-";

    const ffi = r.ffiScore;
    const ffiColor = ffi != null ? (ffi >= 4 ? green : ffi >= 3 ? amber : red) : black;
    const respDisplay =
      r.responsePercent != null
        ? typeof r.responsePercent === "number"
          ? r.responsePercent.toFixed(2) + "%"
          : r.responsePercent + "%"
        : "%";

    // ---- build cells: wrapped with real metrics ----
    const single = (t, f) => [{ text: sanitize(t), indent: 0, spacer: false, h: LH }];
    const wrapIn = (t, ci) => wrapCell(t, COLS[ci].w - CELL_PAD_X * 2, timesFont, FS);

    const cells = [
      { lines: single(String(i + 1)), font: timesBoldFont, center: true },
      { lines: wrapIn(r.facultyName || "-", 1), font: timesFont },
      { lines: wrapIn(codeBatch, 2), font: timesFont },
      { lines: wrapIn(cleanCourseName(r.programme) || "-", 3), font: timesFont },
      { lines: single(String(r.semester || "-")), font: timesFont, center: true },
      { lines: single(ffi != null ? ffi.toFixed(2) : "-"), font: timesBoldFont, center: true, color: ffiColor },
      { lines: single(respDisplay), font: timesFont, center: true },
      { lines: wrapIn(attText, 7), font: timesFont },
      { lines: wrapIn(appText, 8), font: timesFont },
      { lines: wrapIn(String(actionText), 9), font: timesFont },
      { lines: [], font: timesFont, sig: true },
    ];

    // ---- signature block size (name wrapped inside the column) ----
    const sigNameLines = withoutSignatures
      ? []
      : wrapName(r.facultyName || "", sigCol.w - 6, timesFont, SIG_NAME_FS);
    const sigBlockH = withoutSignatures
      ? 0
      : 4 + SIG_IMG_H + 3 + Math.max(1, sigNameLines.length) * SIG_NAME_LH + 3;

    // ---- exact content height of the row ----
    const sumH = (lines) => lines.reduce((s, l) => s + l.h, 0);
    const contentH = Math.max(...cells.map((c) => sumH(c.lines)), LH);
    const rowNeed = Math.max(contentH + PAD_TOP + PAD_BOT, sigBlockH);

    // ---- decide: fits / split / move to next page ----
    let avail = y - BOTTOM_MARGIN;
    if (rowNeed > avail && avail < Math.max(MIN_SPLIT, sigBlockH)) {
      await newTablePage();
    }

    const pos = cells.map(() => 0);
    while (true) {
      avail = y - BOTTOM_MARGIN;
      const limit = avail - PAD_TOP - PAD_BOT;

      // how many lines of each cell fit on this page
      const take = cells.map((c, ci) => {
        let h = 0, n = 0;
        while (pos[ci] + n < c.lines.length && h + c.lines[pos[ci] + n].h <= limit) {
          h += c.lines[pos[ci] + n].h;
          n++;
        }
        return { n, h };
      });
      const finished = cells.every((c, ci) => pos[ci] + take[ci].n >= c.lines.length);
      const usedH = Math.max(...take.map((t) => t.h), 0);

      if (!finished && usedH === 0) {
        await newTablePage();
        continue;
      }

      // the row box is exactly as tall as its text (plus padding)
      let chunkH = Math.max(usedH, finished ? LH : 0) + PAD_TOP + PAD_BOT;
      if (finished) chunkH = Math.max(chunkH, sigBlockH);

      rect(page, ML, y - chunkH, CW, chunkH, { borderColor: black, borderWidth: 0.5 });
      COLS.forEach((col, ci) => {
        if (ci > 0) line(page, col.x, y, col.x, y - chunkH, 0.5, black);
      });

      cells.forEach((c, ci) => {
        if (c.sig) return;
        const col = COLS[ci];
        let ly = y - PAD_TOP;
        for (let k = 0; k < take[ci].n; k++) {
          const L = c.lines[pos[ci] + k];
          if (!L.spacer && L.text) {
            const lw = c.font.widthOfTextAtSize(L.text, FS);
            const tx = c.center
              ? col.x + Math.max(1, (col.w - lw) / 2)
              : col.x + CELL_PAD_X + L.indent;
            txt(page, L.text, tx, ly - FS, FS, c.font, c.color || black);
          }
          ly -= L.h;
        }
        pos[ci] += take[ci].n;
      });

      // signature goes in the LAST chunk of the row
      if (finished && !withoutSignatures) {
        const topY = y - 4;
        const sigImg = facultySigMap[(r.facultyName || "").toLowerCase().trim()];
        if (sigImg) {
          const s = Math.min((sigCol.w - 12) / sigImg.width, SIG_IMG_H / sigImg.height, 1);
          const w = sigImg.width * s;
          const h = sigImg.height * s;
          page.drawImage(sigImg, {
            x: sigCol.x + (sigCol.w - w) / 2,
            y: topY - SIG_IMG_H + (SIG_IMG_H - h) / 2,
            width: w,
            height: h,
          });
        } else {
          line(page, sigCol.x + 4, topY - SIG_IMG_H + 4, sigCol.x + sigCol.w - 4, topY - SIG_IMG_H + 4, 0.5, gray);
        }
        const nameTop = topY - SIG_IMG_H - 3;
        sigNameLines.forEach((l, k) => {
          const lw = timesFont.widthOfTextAtSize(l, SIG_NAME_FS);
          const lx = sigCol.x + Math.max(1, (sigCol.w - lw) / 2);
          txt(page, l, lx, nameTop - 6 - k * SIG_NAME_LH, SIG_NAME_FS, timesFont, gray);
        });
      }

      y -= chunkH;
      if (finished) break;
      await newTablePage(); // row continues on the next page (with table header repeated)
    }
  }

  console.log(`[PDF] Table done. Pages: ${pageNumber}, final Y: ${y.toFixed(1)}`);

  // ── Footer note + HOD / Pro-VC signatures ─────────────────────────────────
  const SIGNATURE_HEIGHT = 80;
  if (y - BOTTOM_MARGIN < SIGNATURE_HEIGHT) {
    newPlainPage();
  }
  y -= 5;

  rect(page, ML, y - 18, CW, 18, { borderColor: black, borderWidth: 0.5 });
  txt(page, "FFI & Suggestions are noted for further improvement.", ML + 4, y - 13, 9, font, black);
  y -= 18;

  const sBH = 50;
  const sY = y;
  const c2W = Math.floor(CW / 2);
  const c3W = CW - c2W;
  const c2X = ML;
  const c3X = ML + c2W;

  rect(page, ML, sY - sBH, CW, sBH, { borderColor: black, borderWidth: 0.5 });
  line(page, c3X, sY, c3X, sY - sBH, 0.5, black);

  // HOD
  if (hodSig && !withoutSignatures) {
    const sc = Math.min((c2W - 10) / hodSig.width, 25 / hodSig.height, 1);
    page.drawImage(hodSig, { x: c2X + 4, y: sY - 28, width: hodSig.width * sc, height: hodSig.height * sc });
  } else {
    line(page, c2X + 4, sY - 20, c2X + c2W - 8, sY - 20, 0.5, gray);
  }
  txt(page, (hodUser && hodUser.name) || "Abhishek Dixit", c2X + 4, sY - 36, 9, boldFont, black);
  txt(page, "HOD/Dean", c2X + 4, sY - 48, 7, timesFont, gray);

  // Pro-VC
  if (vcSig && !withoutSignatures && !hideVCSignature) {
    const sc = Math.min((c3W - 10) / vcSig.width, 25 / vcSig.height, 1);
    page.drawImage(vcSig, { x: c3X + 4, y: sY - 28, width: vcSig.width * sc, height: vcSig.height * sc });
  } else {
    line(page, c3X + 4, sY - 20, c3X + c3W - 8, sY - 20, 0.5, gray);
  }
  txt(page, (vcUser && vcUser.name) || "", c3X + 4, sY - 36, 9, boldFont, black);
  txt(page, "Pro-VC", c3X + 4, sY - 48, 7, timesFont, gray);

  // ── Preview watermark ─────────────────────────────────────────────────────
  if (isPreview) {
    pdfDoc.getPages().forEach((p) => {
      p.drawText("PREVIEW", {
        x: 230, y: 180, size: 90, font: boldFont,
        color: rgb(0.85, 0.85, 0.85), rotate: degrees(30), opacity: 0.35,
      });
    });
  }

  // ── Append original faculty PDFs with signature stamps ─────────────────────
  // These are the source PDFs uploaded via Google Drive links in the CSV.
  // Appended after the summary table; HOD/faculty/ProVC signatures are stamped
  // on the signature page of each appended PDF (when withoutSignatures=false).

  function convertDriveLink(url) {
    if (!url) return null;
    const m1 = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (m1) return "https://drive.google.com/uc?export=download&id=" + m1[1];
    const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (m2) return "https://drive.google.com/uc?export=download&id=" + m2[1];
    return url;
  }

  async function downloadPdfBuffer(url, retries = 3) {
    const axios = require("axios");
    // Try service account for Google Drive links
    const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)|[?&]id=([a-zA-Z0-9_-]+)/);
    if (fileIdMatch) {
      const fileId = fileIdMatch[1] || fileIdMatch[2];
      try {
        const { google } = require("googleapis");
        const clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
        const privateKey  = process.env.GOOGLE_DRIVE_PRIVATE_KEY;
        if (clientEmail && privateKey) {
          const auth = new google.auth.GoogleAuth({
            credentials: { client_email: clientEmail, private_key: privateKey.replace(/\\n/g, "\n") },
            scopes: ["https://www.googleapis.com/auth/drive.readonly"],
          });
          const drive = google.drive({ version: "v3", auth });
          const resp = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
          const buf = Buffer.from(resp.data);
          if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return buf;
          throw new Error("Service account response is not a PDF");
        }
      } catch (e) {
        console.warn("[PDF] Service account failed, falling back:", e.message);
      }
    }
    // Public download fallback
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await axios.get(url, {
          responseType: "arraybuffer", timeout: 40000,
          headers: { "User-Agent": "Mozilla/5.0", Accept: "application/pdf,*/*" },
          maxRedirects: 10,
        });
        const buf = Buffer.from(res.data);
        if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("Response is not a PDF");
        if (buf.length < 1000) throw new Error("PDF too small");
        return buf;
      } catch (err) {
        console.warn(`[PDF] Download attempt ${attempt}/${retries}: ${err.message}`);
        if (attempt < retries) await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }
    return null;
  }

  if (!isPreview) {
    try {
      // Build unique download queue from driveLink / pdfLink fields
      const seenLinks = new Set();
      const queue = [];
      for (const rp of uniqueReports) {
        const raw = rp.driveLink || rp.pdfLink;
        if (!raw || String(raw).startsWith("uploaded:")) continue;
        const lk = convertDriveLink(raw);
        if (!lk || seenLinks.has(lk)) continue;
        seenLinks.add(lk);
        queue.push({ rp, lk });
      }
      console.log(`[PDF] Appending ${queue.length} original faculty PDF(s)`);

      // Download in parallel (max 3 at once)
      let pLimit;
      try { pLimit = require("p-limit"); } catch (e) { pLimit = () => (fn) => fn(); }
      const limiter = pLimit(3);
      const results = await Promise.all(
        queue.map(({ rp, lk }) =>
          limiter(async () => {
            const data = await downloadPdfBuffer(lk, 3);
            return { rp, data };
          })
        )
      );

      // Append each downloaded PDF and stamp signatures
      for (const { rp, data } of results) {
        if (!data) {
          console.warn("[PDF] Skipped (download failed):", rp.facultyName);
          continue;
        }
        try {
          const srcDoc = await PDFDocument.load(data);
          const indices = srcDoc.getPageIndices();
          if (!indices.length) continue;

          const pagesBefore = pdfDoc.getPageCount();
          const copied = await pdfDoc.copyPages(srcDoc, indices);
          for (const pg of copied) pdfDoc.addPage(pg);
          console.log(`[PDF] Appended ${copied.length} page(s) for ${rp.facultyName}`);

          // ── Stamp signatures on the signature page ──────────────────────
          if (!withoutSignatures) {
            try {
              const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
              const pdfJsDoc = await pdfjsLib.getDocument({
                data: new Uint8Array(data),
                useWorkerFetch: false,
                isEvalSupported: false,
              }).promise;

              let sigPageIdx = null;
              let facItem = null, hodItem = null, vcItem = null;

              for (let pi = 1; pi <= pdfJsDoc.numPages; pi++) {
                const pg  = await pdfJsDoc.getPage(pi);
                const tc  = await pg.getTextContent();
                const items = tc.items || [];
                // Find HOD label — marks the signature row
                const foundHod = items.find(it =>
                  /^HOD$|Head of Department/i.test(String(it.str || "").trim())
                );
                if (!foundHod) continue;
                sigPageIdx = pi - 1;
                const hodY = Number(foundHod.transform?.[5]) || 0;
                const near = items.filter(it => Math.abs((Number(it.transform?.[5]) || 0) - hodY) < 100);
                facItem = near.find(it => String(it.str || "").includes("Faculty Name"));
                hodItem = foundHod;
                vcItem  = near.find(it => /PRO\s*-?\s*VC/i.test(String(it.str || "")));
                break;
              }

              if (sigPageIdx !== null) {
                const targetPage = pdfDoc.getPage(pagesBefore + sigPageIdx);
                const SIG_W = 75;

                const drawStamp = (sigImg, labelItem, defaultX) => {
                  if (!sigImg) return;
                  const ix = labelItem ? (Number(labelItem.transform?.[4]) || defaultX) : defaultX;
                  const iy = labelItem ? (Number(labelItem.transform?.[5]) || 100) : 100;
                  const scale = sigImg.width > 0
                    ? Math.min(SIG_W / sigImg.width, 30 / sigImg.height)
                    : 1;
                  targetPage.drawImage(sigImg, {
                    x: ix,
                    y: iy - 6,
                    width:  sigImg.width  * scale,
                    height: sigImg.height * scale,
                  });
                };

                // Faculty signature
                const fSig = facultySigMap[(rp.facultyName || "").toLowerCase().trim()];
                if (fSig)   drawStamp(fSig,   facItem, 80);
                // HOD signature
                if (hodSig) drawStamp(hodSig, hodItem, 300);
                // Pro-VC signature (only if not hidden)
                if (vcSig && !hideVCSignature) drawStamp(vcSig, vcItem, 520);
              }
            } catch (sigErr) {
              console.warn("[PDF] Signature stamp failed for", rp.facultyName, ":", sigErr.message);
            }
          }
        } catch (appendErr) {
          console.error("[PDF] Append failed for", rp.facultyName, ":", appendErr.message);
        }
      }
    } catch (outerErr) {
      console.error("[PDF] Append section error:", outerErr.message);
    }
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = { generateFeedbackReportPDF };
