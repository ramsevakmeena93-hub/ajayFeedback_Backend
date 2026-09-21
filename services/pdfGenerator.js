// pdfGenerator.js — clean rewrite
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const fs2 = require("fs");
const path = require("path");

const HEADER_PATH = path.join(__dirname, "../assets/mits-header.png");
let _headerBytes = null;
try {
  if (fs2.existsSync(HEADER_PATH)) {
    _headerBytes = fs2.readFileSync(HEADER_PATH);
  }
} catch (e) {}

async function generateFeedbackReportPDF({ submission, reports, hodUser, vcUser, approvedAt, isPreview = false }) {
  const User = require("../models/User");
  const axios = require("axios");

  // ── PDF document & fonts ──────────────────────────────────────────────────
  const pdfDoc = await PDFDocument.create();
  const font          = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont      = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const timesFont     = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const timesBoldFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

  // ── Colours ───────────────────────────────────────────────────────────────
  const black    = rgb(0, 0, 0);
  const white    = rgb(1, 1, 1);
  const gray     = rgb(0.5, 0.5, 0.5);
  const blue     = rgb(0.118, 0.227, 0.541);
  const red      = rgb(0.8, 0.1, 0.1);
  const green    = rgb(0.082, 0.325, 0.173);
  const amber    = rgb(0.7, 0.4, 0);
  const darkBlue = rgb(0.05, 0.15, 0.4);

  // ── Page geometry ─────────────────────────────────────────────────────────
  const PW = 842, PH = 595, ML = 20, MR = 20, CW = 802;

  const today = new Date(approvedAt || Date.now()).toLocaleDateString("en-IN", {
    day: "2-digit", month: "2-digit", year: "numeric"
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
      end:   { x: x2, y: y2 },
      thickness: thickness || 0.5,
      color: color || black
    });
  }

  // Word-wrap text to fit within maxChars per line
  function wrap(text, maxChars) {
    const words = (text || "").split(" ");
    const lines = [];
    let cur = "";
    words.forEach(w => {
      const next = cur ? cur + " " + w : w;
      if (next.length <= maxChars) {
        cur = next;
      } else {
        if (cur) lines.push(cur);
        cur = w.length > maxChars ? w.substring(0, maxChars - 1) + "…" : w;
      }
    });
    if (cur) lines.push(cur);
    return lines;
  }

  // Calculate how many wrapped lines a block of text needs
  function calcLines(text, colW, fontSize) {
    // Use a safer factor (0.62 instead of 0.58) to prevent text overlap
    const maxChars = Math.max(1, Math.floor((colW - 6) / (fontSize * 0.62)));
    if (!text) return 1;
    const segments = text.split("\n");
    let total = 0;
    segments.forEach(seg => {
      const words = seg.split(" ");
      let cur = "";
      words.forEach(w => {
        const next = cur ? cur + " " + w : w;
        if (next.length <= maxChars) {
          cur = next;
        } else {
          total++;
          cur = w.length > maxChars ? w.substring(0, maxChars - 1) + "…" : w;
        }
      });
      if (cur) total++;
    });
    return Math.max(1, total);
  }

  // Embed a base-64 signature image (fallback — no crop)
  async function embedSig(b64) {
    if (!b64) return null;
    try {
      const d = b64.replace(/^data:image\/\w+;base64,/, "");
      const bytes = Buffer.from(d, "base64");
      return b64.includes("image/png")
        ? await pdfDoc.embedPng(bytes)
        : await pdfDoc.embedJpg(bytes);
    } catch {
      return null;
    }
  }

  // Auto-crop whitespace from signature using sharp, then embed
  async function cropAndEmbedSig(b64) {
    if (!b64) return null;
    try {
      const sharp = require("sharp");
      const d = b64.replace(/^data:image\/\w+;base64,/, "");
      const bytes = Buffer.from(d, "base64");
      const cropped = await sharp(bytes).trim({ threshold: 30 }).toBuffer();
      return b64.includes("image/png")
        ? await pdfDoc.embedPng(cropped)
        : await pdfDoc.embedJpg(cropped);
    } catch (e) {
      return embedSig(b64);
    }
  }

  // ── De-duplicate reports ──────────────────────────────────────────────────
  const seenR = new Set();
  const uniqueReports = reports.filter(r => {
    const k = (r.facultyName || "").toLowerCase().trim() + "|" +
              (r.subjectCode  || "").toLowerCase().trim();
    if (seenR.has(k)) return false;
    seenR.add(k);
    return true;
  });

  // ── Collect faculty signatures ────────────────────────────────────────────
  const facultySigMap = {};
  for (const r of uniqueReports) {
    const key = (r.facultyName || "").toLowerCase().trim();
    if (facultySigMap[key]) continue;
    // Try by userId first
    if (r.facultyUserId) {
      try {
        const fu = await User.findById(r.facultyUserId).select("signatureImage");
        if (fu && fu.signatureImage) {
          const img = await cropAndEmbedSig(fu.signatureImage);
          if (img) { facultySigMap[key] = img; continue; }
        }
      } catch (e) {}
    }
    // Fallback: search by name
    try {
      const fu = await User.findOne({
        role: "faculty",
        name: new RegExp((r.facultyName || "").trim(), "i")
      }).select("signatureImage");
      if (fu && fu.signatureImage) {
        const img = await cropAndEmbedSig(fu.signatureImage);
        if (img) facultySigMap[key] = img;
      }
    } catch (e) {}
  }

  const hodSig = await cropAndEmbedSig(hodUser && hodUser.signatureImage);
  const vcSig  = await cropAndEmbedSig(vcUser  && vcUser.signatureImage);
  console.log("[PDF] Sigs — HOD:", !!hodSig, "VC:", !!vcSig,
              "Faculty:", Object.keys(facultySigMap).length);

  // ── Header image (cached) ─────────────────────────────────────────────────
  let _embH = null;
  async function drawHeader(page, y) {
    if (_headerBytes) {
      if (!_embH) {
        try { _embH = await pdfDoc.embedPng(_headerBytes); } catch (e) {}
      }
      if (_embH) {
        const iH = Math.round(CW * _embH.height / _embH.width);
        page.drawImage(_embH, { x: ML, y: y - iH, width: CW, height: iH });
        line(page, ML, y - iH - 4, PW - MR, y - iH - 4, 0.8, black);
        return y - iH - 14;
      }
    }
    // Fallback text header
    line(page, ML, y, PW - MR, y, 1.5, blue);
    txt(page, "MADHAV INSTITUTE OF TECHNOLOGY & SCIENCE, GWALIOR (M.P.), INDIA",
        ML + 42, y - 10, 8.5, boldFont, blue);
    txt(page, "(Deemed University) - NAAC A++ Grade",
        ML + 42, y - 22, 7, font, red);
    line(page, ML, y - 32, PW - MR, y - 32, 0.8, black);
    return y - 36;
  }

  // ── Column definitions ────────────────────────────────────────────────────
  // Total usable width = CW = 802
  // S.No(24) | Faculty Name(90) | Code/Batch(65) | Programme(70) | Sem(24) |
  // FFI(38) | Resp.(40) | Needs Attention(155) | Appreciation(145) |
  // Action Taken(85) | Faculty Signature(66)
  // Sum = 24+90+65+70+24+38+40+155+145+85+66 = 802
  const COLS = [
    { label: "S.No",              x: ML,        w: 24  },
    { label: "Faculty Name",      x: ML + 24,   w: 90  },
    { label: "Code/Batch",        x: ML + 114,  w: 65  },
    { label: "Programme",         x: ML + 179,  w: 70  },
    { label: "Sem",               x: ML + 249,  w: 24  },
    { label: "FFI",               x: ML + 273,  w: 38  },
    { label: "Resp. %",           x: ML + 311,  w: 40  },
    { label: "Needs Attention",   x: ML + 351,  w: 155 },
    { label: "Appreciation",      x: ML + 506,  w: 145 },
    { label: "Action Taken",      x: ML + 651,  w: 85  },
    { label: "Faculty Signature", x: ML + 736,  w: 66  },
  ];

  const TH = 36; // table header height — 2-line for long labels

  // Draw header row — light gray bg, NO border box, 11pt bold centred
  function drawTableHeader(page, y) {
    // Clean black/white professional header
    rect(page, ML, y - TH, CW, TH, { borderColor: black, borderWidth: 1, color: white });
    
    // Draw vertical column dividers for header
    COLS.forEach((col, ci) => {
      if (ci > 0) {
        line(page, col.x, y, col.x, y - TH, 1, black);
      }
    });

    const HFS = 10.5;
    const HLH = 12.5;
    COLS.forEach(col => {
      let hLines;
      if (col.label === "Needs Attention") {
        hLines = ["Needs", "Attention"];
      } else if (col.label === "Action Taken") {
        hLines = ["Action", "Taken"];
      } else if (col.label === "Faculty Signature") {
        hLines = ["Faculty", "Signature"];
      } else {
        const maxChars = Math.floor(col.w / (HFS * 0.55));
        hLines = wrap(col.label, maxChars);
      }
      const totalH = hLines.length * HLH;
      const startY = y - (TH - totalH) / 2 - HLH + 4;
      hLines.forEach((l, li) => {
        const lw = boldFont.widthOfTextAtSize(l, HFS);
        const lx = col.x + Math.max(1, (col.w - lw) / 2);
        txt(page, l, lx, startY - li * HLH, HFS, boldFont, black);
      });
    });
    return y - TH;
  }

  // ── Cover page ────────────────────────────────────────────────────────────
  let coverPage = pdfDoc.addPage([PW, PH]);
  let y = PH - 15;
  y = await drawHeader(coverPage, y);
  y -= 10;

  // Line 1: Action Taken Report
  const atrText = "Action Taken Report";
  txt(coverPage, atrText,
      PW / 2 - timesBoldFont.widthOfTextAtSize(atrText, 14) / 2,
      y, 14, timesBoldFont, black);
  y -= 18;

  // Line 2: Faculty Feedback – I (or form number)
  const formNo  = submission.feedbackFormNo || "I";
  const ffTitle = "Faculty Feedback \u2013 " + formNo;
  txt(coverPage, ffTitle,
      PW / 2 - timesBoldFont.widthOfTextAtSize(ffTitle, 16) / 2,
      y, 16, timesBoldFont, darkBlue);
  y -= 18;

  // Line 3: Department
  const dT = (hodUser && hodUser.department) || "Centre for Computer Science and Technology";
  txt(coverPage, dT,
      PW / 2 - timesFont.widthOfTextAtSize(dT, 12) / 2,
      y, 12, timesFont, black);
  y -= 16;

  // Line 4: Academic Year (left) | Session (right)
  const sessionLabel = submission.session === "jan-may" ? "January \u2013 May" : "July \u2013 December";
  const ayText   = "Academic Year \u2013 " + (submission.academicYear || "2025-26");
  const sessText = "Session: " + sessionLabel;
  txt(coverPage, ayText,   ML, y, 11, timesFont, black);
  txt(coverPage, sessText, PW - MR - timesFont.widthOfTextAtSize(sessText, 11), y, 11, timesFont, black);
  y -= 14;

  // Line 5: Feedback Submitted (left) | Report Generated (right)
  const subDate  = submission.submissionDate
    ? new Date(submission.submissionDate).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" })
    : today;
  const finalDate = submission.finalReportDate
    ? new Date(submission.finalReportDate).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" })
    : today;
  const fbSubText = "Feedback Submitted: " + subDate;
  const repGenText = "Report Generated: " + finalDate;
  txt(coverPage, fbSubText,  ML, y, 11, timesFont, black);
  txt(coverPage, repGenText, PW - MR - timesFont.widthOfTextAtSize(repGenText, 11), y, 11, timesFont, black);
  y -= 15;

  // Line 6: Average FFI (left) | Average Response (right)
  const allFFIs  = uniqueReports.map(r => r.ffiScore).filter(v => v != null);
  const avgFFI   = allFFIs.length
    ? (allFFIs.reduce((s, v) => s + v, 0) / allFFIs.length).toFixed(2)
    : "\u2014";
  const allResp  = uniqueReports.map(r => r.responseCount || r.totalResponses || 0).filter(Boolean);
  const avgResp  = allResp.length
    ? (allResp.reduce((s, v) => Number(s) + Number(v), 0) / allResp.length).toFixed(2)
    : "\u2014";
  const avgFFIText  = "Average FFI \u2013 " + avgFFI;
  const avgRespText = "Average Response \u2013 " + avgResp;
  
  // Removed the line that was cutting through the text
  txt(coverPage, avgFFIText,  ML, y, 11, timesBoldFont, black);
  txt(coverPage, avgRespText, PW - MR - timesBoldFont.widthOfTextAtSize(avgRespText, 11), y, 11, timesBoldFont, black);
  y -= 15;

  // ── Draw initial table header ─────────────────────────────────────────────
  y = drawTableHeader(coverPage, y);

  // ── Data rows ─────────────────────────────────────────────────────────────
  const ROW_GAP    = 0;
  const SIG_RESERVE = 125; // space needed at bottom for signature section
  const FS = 10.5;           // Times New Roman 10.5pt for all cell content
  const LH = 13;       // line height = 13pt
  const CW_CHAR = 0.58;    // Times New Roman char width factor

  for (let i = 0; i < uniqueReports.length; i++) {
    const r = uniqueReports[i];

    // Build cell text values
    const codeParts = (r.subjectCode || "-").split("-");
    const codeBatch = codeParts.length > 1
      ? codeParts[0].trim() + "\n" + codeParts.slice(1).join("-").trim()
      : (r.subjectCode || "-");

    const attText = (r.commentsNeedingAttention || []).length > 0
      ? r.commentsNeedingAttention.map(x => "\u2022 " + x).join("\n")
      : "None";

    const pcts = r.commentPercentages || {};
    const pctLines = Object.entries(pcts)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => "\u2022 " + k + ": " + v + "%")
      .join("\n");
    const longAppreciations = (r.appreciation || [])
      .filter(c => c.trim().split(/\s+/).length > 4)
      .map(x => "\u2022 " + x);
    const appText = [pctLines, ...longAppreciations].filter(Boolean).join("\n") || "-";

    // Calculate dynamic row height — use actual column widths
    const attLines  = calcLines(attText,             155, FS);
    const appLines  = calcLines(appText,             145, FS);
    const nameLines = calcLines(r.facultyName || "-", 90, FS);
    const progLines = calcLines(r.programme   || "-", 70, FS);
    const maxLines  = Math.max(attLines, appLines, nameLines, progLines, 1);
    // Adjusted row padding
    const ROW_H     = Math.min(500, Math.max(60, maxLines * LH + 20));

    // Check if we need a new page
    // Dynamic Page break threshold
    if (y - ROW_H < 20) {
      const contPage = pdfDoc.addPage([PW, PH]);
      let cy = PH - 15;
      // Per user request: Header is NOT repeated on new pages
      // cy = drawTableHeader(contPage, cy); 
      coverPage = contPage;
      y = cy;
    }

    // Draw main row border and white background
    rect(coverPage, ML, y - ROW_H, CW, ROW_H, { 
      borderColor: black, borderWidth: 0.5 
    });

    // Draw vertical cell dividers for each column
    COLS.forEach((col, ci) => {
      if (ci > 0) {
        line(coverPage, col.x, y, col.x, y - ROW_H, 0.5, black);
      }
    });

    // Draw cell content for each column
    const ffi = r.ffiScore;
    const ffiColor = ffi != null ? (ffi >= 4 ? green : ffi >= 3 ? amber : red) : black;

    const cellValues = [
      { v: String(i + 1),                                  bold: true,  center: true },
      { v: r.facultyName || "-" },
      { v: codeBatch },
      { v: r.programme  || "-" },
      { v: r.semester   || "-",                            center: true },
      { v: ffi != null ? ffi.toFixed(2) : "-",            color: ffiColor, bold: true, center: true },
      { v: r.responseCount != null ? String(r.responseCount) : (r.totalResponses != null ? String(r.totalResponses) : "-"), center: true },
      { v: attText },
      { v: appText },
      { v: r.actionTaken || "-" },
      { v: "",                                             sig: true },
    ];

    cellValues.forEach((val, ci) => {
      const col = COLS[ci];

      if (val.sig) {
        // Faculty signature cell — fits within 62pt column
        const sigImg = facultySigMap[(r.facultyName || "").toLowerCase().trim()];
        if (sigImg) {
          const sW = 50, sH = 25;
          const sigX = col.x + (col.w - sW) / 2;
          const sigY = y - ROW_H + 22;
          coverPage.drawImage(sigImg, { x: sigX, y: sigY, width: sW, height: sH });
        } else {
          line(coverPage, col.x + 4, y - ROW_H + 24, col.x + col.w - 4, y - ROW_H + 24, 0.5, gray);
        }
        // Faculty name below signature — small, centred
        const nameStr = r.facultyName || "";
        const nameW   = nameStr.length * 7 * 0.52;
        const nameX   = col.x + Math.max(1, (col.w - nameW) / 2);
        txt(coverPage, nameStr, nameX, y - ROW_H + 8, 7, timesFont, gray);
        return;
      }

      // Regular text cell — Times New Roman 12pt, NO column dividers
      // Safer maxChars with more horizontal padding (10px)
      const maxChars = Math.max(1, Math.floor((col.w - 10) / (FS * 0.62)));
      const allLines = val.v.split("\n").flatMap(seg => wrap(seg, maxChars));
      const visLines = allLines.slice(0, Math.floor((ROW_H - 12) / LH));
      visLines.forEach((l, li) => {
        const fontToUse = val.bold ? boldFont : timesFont;
        const lw = fontToUse.widthOfTextAtSize(l, FS);
        const tX = val.center
          ? col.x + (col.w - lw) / 2
          : col.x + 5; // 5px left padding
        txt(coverPage, l, Math.max(col.x + 1, tX), y - 15 - li * LH,
            FS, fontToUse, val.color || black);
      });
    });

    y -= ROW_H + ROW_GAP;
  }

  // ── Footer note ───────────────────────────────────────────────────────────
  // Final safety check for signatures
  if (y < 80) {
      coverPage = pdfDoc.addPage([PW, PH]);
      y = PH - 25;
  }

  rect(coverPage, ML, y - 18, CW, 18, {
    borderColor: black, borderWidth: 0.5
  });
  txt(coverPage, "FFI & Suggestions are noted for further improvement.",
      ML + 4, y - 13, 9, font, black);
  y -= 18;

  // ── Signature section (HOD | PRO-VC) — 2 columns, no Faculty column ──────
  const sHH = 14;  // label row height
  const sBH = 45;  // body row height
  const sY  = y;
  const c2W = Math.floor(CW / 2);
  const c3W = CW - Math.floor(CW / 2);
  const c2X = ML;
  const c3X = ML + Math.floor(CW / 2);

  // Label row
  rect(coverPage, ML, sY - sHH, CW, sHH, {
    borderColor: black, borderWidth: 0.5
  });
  line(coverPage, c3X, sY, c3X, sY - sHH, 0.5, black);
  txt(coverPage, "HOD",      c2X + 4, sY - 13, 9, boldFont, black);
  txt(coverPage, "PRO - VC", c3X + 4, sY - 13, 9, boldFont, black);

  // Body row
  const bY = sY - sHH;
  rect(coverPage, ML, bY - sBH, CW, sBH, {
    borderColor: black, borderWidth: 0.5
  });
  line(coverPage, c3X, bY, c3X, bY - sBH, 0.5, black);

  // HOD name + signature
  txt(coverPage, (hodUser && hodUser.name) || "Head of Department",
      c2X + 4, bY - 12, 9, boldFont, black);
  if (hodSig) {
    const sc = Math.min((c2W - 10) / hodSig.width, (sBH - 22) / hodSig.height, 1);
    coverPage.drawImage(hodSig, {
      x: c2X + 4, y: bY - sBH + 8,
      width: hodSig.width * sc, height: hodSig.height * sc
    });
  } else {
    line(coverPage, c2X + 4, bY - sBH + 18, c2X + c2W - 8, bY - sBH + 18, 0.5, gray);
  }

  // VC name + signature
  txt(coverPage, (vcUser && vcUser.name) || "Pro Vice-Chancellor",
      c3X + 4, bY - 12, 9, boldFont, black);
  if (vcSig) {
    const sc = Math.min((c3W - 10) / vcSig.width, (sBH - 22) / vcSig.height, 1);
    coverPage.drawImage(vcSig, {
      x: c3X + 4, y: bY - sBH + 8,
      width: vcSig.width * sc, height: vcSig.height * sc
    });
  } else {
    line(coverPage, c3X + 4, bY - sBH + 18, c3X + c3W - 8, bY - sBH + 18, 0.5, gray);
  }

  // ── Append CSV PDFs with HOD + VC signature stamps ────────────────────────
  function convertDriveLink(url) {
    if (!url) return null;
    const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
    if (m) return "https://drive.google.com/uc?export=download&id=" + m[1];
    return url;
  }

  async function downloadWithRetry(url, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await axios.get(url, {
          responseType: "arraybuffer",
          timeout: 30000,
          headers: { "User-Agent": "Mozilla/5.0" },
          maxRedirects: 10
        });
        const buf = Buffer.from(res.data);
        if (buf.subarray(0, 4).toString() !== "%PDF") throw new Error("Not a PDF");
        return res.data;
      } catch (err) {
        console.warn("[PDF] Attempt " + attempt + ": " + err.message);
        if (attempt < retries) await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
    return null;
  }

  const seenLinks = new Set();
  if (!isPreview) {
  for (let ri = 0; ri < uniqueReports.length; ri++) {
    const rp  = uniqueReports[ri];
    const raw = rp.driveLink || rp.pdfLink;
    if (!raw || raw.startsWith("uploaded:")) continue;

    const lk = convertDriveLink(raw);
    if (!lk || seenLinks.has(lk)) continue;
    seenLinks.add(lk);

    console.log("[PDF] Downloading CSV PDF for " + rp.facultyName + "...");
    const data = await downloadWithRetry(lk);
    if (!data) { console.warn("[PDF] Skipped " + rp.facultyName); continue; }

    try {
      const srcDoc = await PDFDocument.load(data);
      const copied = await pdfDoc.copyPages(srcDoc, srcDoc.getPageIndices());
      const pagesBefore = pdfDoc.getPageCount();
      copied.forEach(p => pdfDoc.addPage(p));

      // Stamp HOD + VC signatures on the signature row of the appended CSV PDF
      const fSig = facultySigMap[(rp.facultyName || "").toLowerCase().trim()];
      try {
        const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
        const rawUint8 = new Uint8Array(data);
        const pdfJsDoc = await pdfjsLib.getDocument({ data: rawUint8 }).promise;

        let sigPageIdx = null;
        let facItem = null;
        let hodItem = null;
        let vcItem = null;

        for (let pi = 1; pi <= pdfJsDoc.numPages; pi++) {
          const pg = await pdfJsDoc.getPage(pi);
          const tc = await pg.getTextContent();
          
          const foundHod = tc.items.find(item => item.str.trim() === "HOD");
          if (foundHod) {
            sigPageIdx = pi - 1;
            hodItem = foundHod;
            // The PDF often splits "Faculty Name" and "Signature" into separate items.
            // Look for the "Signature" item itself.
            facItem = tc.items.find(item => item.str.trim().includes("Signature") && !item.str.trim().includes("Faculty Name & Signature"));
            if (!facItem) facItem = tc.items.find(item => item.str.trim().includes("Faculty"));
            
            vcItem = tc.items.find(item => item.str.trim() === "PRO - VC" || item.str.trim() === "PRO-VC" || item.str.trim() === "PRO - VC ");
            break;
          }
        }

        if (sigPageIdx !== null) {
          const targetPage = pdfDoc.getPage(pagesBefore + sigPageIdx);
          const SIG_W = 75; // Adjust width to fit nicely in the cell

          // Fallback baseline Y if we only found HOD
          const baseY = hodItem ? hodItem.transform[5] : 100;
          
          // Image drawing helper to position signatures
          const drawSig = (sigImg, labelItem, defaultX, paddingX = 10, sigW = SIG_W) => {
            if (!sigImg) return;
            const itemX = labelItem ? labelItem.transform[4] : null;
            const itemW = labelItem ? (labelItem.width || 0) : null;
            const itemY = labelItem ? labelItem.transform[5] : baseY;
            
            // X: paddingX points to the right of the text label
            const x = (itemX !== null && itemW !== null) ? itemX + itemW + paddingX : defaultX;
            // Y: Text baseline is usually bottom of text. Center image vertically around baseline + 5.
            const h = Math.min(sigW * (sigImg.height / sigImg.width), 22);
            const y = itemY - 6; 
            
            targetPage.drawImage(sigImg, { x, y, width: sigW, height: h });
          };

          drawSig(fSig, facItem, 250, 10); 
          drawSig(hodSig, hodItem, 380, 10); 
          drawSig(vcSig, vcItem, 545, 10, 45); // Reduced width to 45 and tweaked defaultX so it fits inside the cell boundary

          console.log(`[PDF] Stamped sigs inline on page ${sigPageIdx+1}`);
        } else {
          console.warn("[PDF] HOD label not found for " + rp.facultyName);
        }
      } catch (e) {
        console.warn("[PDF] Stamp error:", e.message);
      }

      console.log("[PDF] Added " + copied.length + " pages for " + rp.facultyName);
    } catch (err) {
      console.warn("[PDF] Parse error: " + err.message);
    }
  }
  } // end if (!isPreview)

  // ── Page numbers ──────────────────────────────────────────────────────────
  const total = pdfDoc.getPageCount();
  for (let pi = 0; pi < total; pi++) {
    try {
      pdfDoc.getPage(pi).drawText(String(pi + 1) + " / " + String(total), {
        x: PW - 50, y: 8, size: 9, font, color: gray
      });
    } catch (e) {}
  }

  return Buffer.from(await pdfDoc.save());
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE INDIVIDUAL FACULTY FEEDBACK REPORT PDF
// ─────────────────────────────────────────────────────────────────────────────
async function generateIndividualFacultyPDF(report) {
  const pdfDoc = await PDFDocument.create();
  const font          = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont      = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const timesFont     = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const timesBoldFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

  const black     = rgb(0.1, 0.1, 0.1);
  const white     = rgb(1, 1, 1);
  const gray      = rgb(0.45, 0.45, 0.45);
  const lightGray = rgb(0.95, 0.96, 0.98);
  const borderCol = rgb(0.82, 0.85, 0.9);
  const navy      = rgb(0.08, 0.18, 0.38);
  const green     = rgb(0.08, 0.52, 0.28);
  const greenBg   = rgb(0.93, 0.98, 0.94);
  const greenBdr  = rgb(0.68, 0.88, 0.72);
  const amber     = rgb(0.72, 0.42, 0.05);
  const amberBg   = rgb(0.99, 0.97, 0.91);
  const amberBdr  = rgb(0.95, 0.82, 0.58);

  const PW = 595.28; // A4 Portrait
  const PH = 841.89;
  const ML = 36;
  const MR = 36;
  const CW = PW - ML - MR; // ~523 pt

  let page = pdfDoc.addPage([PW, PH]);
  let curY = PH - 30;

  function wrapText(text, maxChars) {
    const words = (text || "").split(" ");
    const lines = [];
    let cur = "";
    words.forEach(w => {
      const next = cur ? cur + " " + w : w;
      if (next.length <= maxChars) {
        cur = next;
      } else {
        if (cur) lines.push(cur);
        cur = w.length > maxChars ? w.substring(0, maxChars - 1) + "…" : w;
      }
    });
    if (cur) lines.push(cur);
    return lines;
  }

  function checkPageSpace(requiredSpace) {
    if (curY - requiredSpace < 40) {
      page = pdfDoc.addPage([PW, PH]);
      curY = PH - 40;
      return true;
    }
    return false;
  }

  // 1. Header Banner Image or Typography Header
  let headerDrawn = false;
  if (_headerBytes) {
    try {
      const headerImg = await pdfDoc.embedPng(_headerBytes);
      const imgH = 54;
      const imgW = CW;
      page.drawImage(headerImg, { x: ML, y: curY - imgH, width: imgW, height: imgH });
      curY -= (imgH + 12);
      headerDrawn = true;
    } catch (_) {}
  }

  if (!headerDrawn) {
    page.drawRectangle({ x: ML, y: curY - 50, width: CW, height: 50, color: navy });
    page.drawText("MADHAV INSTITUTE OF TECHNOLOGY & SCIENCE, GWALIOR", {
      x: ML + 20, y: curY - 22, size: 12, font: boldFont, color: white
    });
    page.drawText("A Grant-in-Aid Autonomous Institute Under Govt. of M.P.", {
      x: ML + 20, y: curY - 38, size: 9, font, color: white
    });
    curY -= 62;
  }

  // Document Title Bar
  page.drawRectangle({ x: ML, y: curY - 24, width: CW, height: 24, color: lightGray, borderColor: borderCol, borderWidth: 1 });
  page.drawText("FACULTY STUDENT FEEDBACK & AI ANALYSIS REPORT", {
    x: ML + 12, y: curY - 16, size: 10, font: boldFont, color: navy
  });
  const dateStr = new Date(report.analyzedAt || report.createdAt || Date.now()).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric"
  });
  page.drawText(`Date: ${dateStr}`, {
    x: PW - MR - 100, y: curY - 16, size: 9, font, color: gray
  });
  curY -= 32;

  // 2. Faculty & Course Details Card + FFI Score Badge
  const infoH = 88;
  page.drawRectangle({ x: ML, y: curY - infoH, width: CW, height: infoH, color: white, borderColor: borderCol, borderWidth: 1 });

  // Left Column - Details
  const leftX = ML + 14;
  let lineY = curY - 18;
  page.drawText("Faculty Name:", { x: leftX, y: lineY, size: 9, font: boldFont, color: gray });
  page.drawText(report.facultyName || "—", { x: leftX + 85, y: lineY, size: 11, font: boldFont, color: black });

  lineY -= 18;
  page.drawText("Course / Code:", { x: leftX, y: lineY, size: 9, font: boldFont, color: gray });
  page.drawText(report.subjectCode || "—", { x: leftX + 85, y: lineY, size: 10, font: boldFont, color: navy });

  lineY -= 18;
  page.drawText("Programme / Sem:", { x: leftX, y: lineY, size: 9, font: boldFont, color: gray });
  const progSem = [report.programme, report.semester ? `Semester ${report.semester}` : "", report.branch ? `(${report.branch})` : ""].filter(Boolean).join(" · ") || "—";
  page.drawText(progSem, { x: leftX + 85, y: lineY, size: 9, font, color: black });

  lineY -= 18;
  page.drawText("Academic Year:", { x: leftX, y: lineY, size: 9, font: boldFont, color: gray });
  const responsesText = report.responseCount != null ? ` · Total Responses: ${report.responseCount}` : "";
  page.drawText((report.academicYear || "2025-2026") + responsesText, { x: leftX + 85, y: lineY, size: 9, font, color: black });

  // Right Column - FFI Score Box
  const badgeW = 120;
  const badgeH = 68;
  const badgeX = PW - MR - badgeW - 10;
  const badgeY = curY - infoH + 10;
  const ffi = report.ffiScore != null ? Number(report.ffiScore) : null;
  const isHighFFI = ffi != null && ffi >= 3.5;
  const scoreBg = isHighFFI ? greenBg : amberBg;
  const scoreBdr = isHighFFI ? greenBdr : amberBdr;
  const scoreCol = isHighFFI ? green : amber;

  page.drawRectangle({ x: badgeX, y: badgeY, width: badgeW, height: badgeH, color: scoreBg, borderColor: scoreBdr, borderWidth: 1 });
  page.drawText("FFI SCORE", { x: badgeX + 28, y: badgeY + badgeH - 14, size: 8, font: boldFont, color: scoreCol });
  page.drawText(ffi != null ? ffi.toFixed(2) : "—", { x: badgeX + 24, y: badgeY + badgeH - 42, size: 24, font: boldFont, color: scoreCol });
  page.drawText("Scale: 1.00 - 5.00", { x: badgeX + 22, y: badgeY + 10, size: 7.5, font, color: gray });

  curY -= (infoH + 16);

  // Helper to draw a comments section
  function drawSection(title, items, isAppreciation) {
    const list = Array.isArray(items) && items.length > 0 ? items : [];
    checkPageSpace(60);

    // Section Header
    const secBg = isAppreciation ? greenBg : amberBg;
    const secBdr = isAppreciation ? greenBdr : amberBdr;
    const secTxt = isAppreciation ? green : amber;
    const countTxt = `(${list.length} comments identified)`;

    page.drawRectangle({ x: ML, y: curY - 22, width: CW, height: 22, color: secBg, borderColor: secBdr, borderWidth: 1 });
    page.drawText(title, { x: ML + 10, y: curY - 15, size: 9.5, font: boldFont, color: secTxt });
    page.drawText(countTxt, { x: ML + 240, y: curY - 15, size: 8.5, font, color: gray });
    curY -= 28;

    if (list.length === 0) {
      page.drawText(isAppreciation ? "No specific student appreciation comments recorded." : "No critical student feedback comments needing attention.", {
        x: ML + 14, y: curY - 10, size: 8.5, font, color: gray
      });
      curY -= 22;
      return;
    }

    // List items with bullet points
    list.forEach((comment, idx) => {
      const wrapped = wrapText(comment, 95);
      const itemH = (wrapped.length * 13) + 6;
      checkPageSpace(itemH + 10);

      // Bullet dot
      page.drawCircle({ x: ML + 12, y: curY - 6, size: 2.2, color: secTxt });

      wrapped.forEach((lineText, li) => {
        page.drawText(lineText, {
          x: ML + 22, y: curY - 9 - (li * 13), size: 8.5, font, color: black
        });
      });

      curY -= itemH;
    });

    curY -= 8;
  }

  // 3. Positive Feedback (Appreciation)
  drawSection("STUDENT APPRECIATION & POSITIVE FEEDBACK", report.appreciation || report.goodComments, true);

  // 4. Feedback Needing Attention
  drawSection("AREAS FOR IMPROVEMENT / FEEDBACK NEEDING ATTENTION", report.commentsNeedingAttention || report.badComments, false);

  // 5. HOD Remarks & Action Taken (if any)
  if (report.hodRemarks || report.actionTaken) {
    checkPageSpace(60);
    page.drawRectangle({ x: ML, y: curY - 20, width: CW, height: 20, color: lightGray, borderColor: borderCol, borderWidth: 1 });
    page.drawText("HOD REMARKS & ACTION TAKEN", { x: ML + 10, y: curY - 14, size: 9, font: boldFont, color: navy });
    curY -= 26;

    const remarksText = [report.actionTaken ? `Action Taken: ${report.actionTaken}` : "", report.hodRemarks ? `Remarks: ${report.hodRemarks}` : ""].filter(Boolean).join("\n");
    const wrappedRemarks = wrapText(remarksText, 95);
    wrappedRemarks.forEach(lineText => {
      checkPageSpace(15);
      page.drawText(lineText, { x: ML + 14, y: curY - 9, size: 8.5, font, color: black });
      curY -= 13;
    });
    curY -= 10;
  }

  // 6. Signatures & Verification Stamp Footer
  checkPageSpace(70);
  const footerY = curY - 50;
  page.drawLine({ start: { x: ML, y: curY - 8 }, end: { x: PW - MR, y: curY - 8 }, thickness: 0.5, color: borderCol });

  // Faculty Signature / Acknowledgment Box
  page.drawText("Faculty Acknowledgment:", { x: ML + 10, y: footerY + 30, size: 8, font: boldFont, color: gray });
  if (report.facultyAcknowledged) {
    const ackDate = report.facultyAcknowledgedAt ? new Date(report.facultyAcknowledgedAt).toLocaleDateString("en-IN") : "Verified";
    page.drawText(`[Digitally Acknowledged - ${ackDate}]`, { x: ML + 10, y: footerY + 16, size: 8.5, font: boldFont, color: green });
  } else {
    page.drawText("[Pending Review]", { x: ML + 10, y: footerY + 16, size: 8.5, font, color: gray });
  }

  // HOD Signature Box
  page.drawText("Head of Department (HOD):", { x: PW - MR - 160, y: footerY + 30, size: 8, font: boldFont, color: gray });
  page.drawText("Verified & Submitted", { x: PW - MR - 160, y: footerY + 16, size: 8.5, font: boldFont, color: navy });

  // Page Numbers
  const totalPages = pdfDoc.getPageCount();
  for (let pi = 0; pi < totalPages; pi++) {
    pdfDoc.getPage(pi).drawText(`Page ${pi + 1} of ${totalPages} · Confidential MITS Feedback System`, {
      x: PW / 2 - 100, y: 15, size: 7.5, font, color: gray
    });
  }

  return Buffer.from(await pdfDoc.save());
}

module.exports = { generateFeedbackReportPDF, generateIndividualFacultyPDF };
