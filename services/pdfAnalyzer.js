const axios = require('axios');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = false;

// ─────────────────────────────────────────────────────────────────
// COLOR DETECTION  (values are 0-255 integers in this PDF)
// ─────────────────────────────────────────────────────────────────
function detectColor(r, g, b) {
  // Normalize to 0-255 if 0-1 floats
  if (r <= 1 && g <= 1 && b <= 1 && (r > 0 || g > 0 || b > 0)) {
    r = Math.round(r * 255); g = Math.round(g * 255); b = Math.round(b * 255);
  }
  if (r >= 200 && g <= 80  && b <= 80)  return 'red';    // #FF0000
  if (r >= 200 && g >= 180 && b <= 80)  return 'yellow'; // #FFFF00
  return null;
}

// ─────────────────────────────────────────────────────────────────
// PARSE constructPath args to get bounding rect
// constructPath args[1] = [x, y, w, h]  (rectangle variant)
// args[2] = [x1, y1, x2, y2]            (bounds)
// ─────────────────────────────────────────────────────────────────
function parseBoundsFromConstructPath(args) {
  if (!args || !Array.isArray(args)) return null;

  // args[1] = [x, y, w, h] — the actual rect parameters (most reliable)
  if (args[1] && args[1].length === 4) {
    const [x, y, w, h] = args[1];
    const absW = Math.abs(w), absH = Math.abs(h);
    return { x1: x, y1: y, x2: x + absW, y2: y + absH };
  }
  // Fallback: args[2] = [x1, y1, x2, y2]
  if (args[2] && args[2].length === 4) {
    const [x1, y1, x2, y2] = args[2];
    return { x1: Math.min(x1,x2), y1: Math.min(y1,y2), x2: Math.max(x1,x2), y2: Math.max(y1,y2) };
  }
  return null;
}

function pushUnique(arr, value) {
  const clean = (value || '').trim().replace(/\s+/g, ' ');
  if (clean.length > 2 && !arr.includes(clean)) arr.push(clean);
}

// ─────────────────────────────────────────────────────────────────
// CORE: Find colored background rects, then collect text inside them
// Pattern in this PDF:
//   setFillRGBColor(R,G,B)  ← colored background
//   constructPath(...)       ← rect bounds
//   eoFill                   ← draw the rect
//   ... (save/restore/clip)
//   beginText → showText(black text on top) → endText
// ─────────────────────────────────────────────────────────────────
async function extractHighlightedText(buffer) {
  const appreciation = [];
  const commentsNeedingAttention = [];

  const uint8 = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data: uint8, verbosity: 0 }).promise;
  const OPS = pdfjsLib.OPS;
  const opNames = Object.fromEntries(Object.entries(OPS).map(([k, v]) => [v, k]));

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const ops = await page.getOperatorList();

    // Get all text items with positions
    const tc = await page.getTextContent();
    const textItems = tc.items
      .filter(i => i.str && i.str.trim())
      .map(i => ({
        str: i.str,
        x: i.transform[4],
        y: i.transform[5],
        w: i.width || 0,
        h: i.height || 10
      }));

    // Step 1: collect all colored background rects on this page
    const coloredRects = []; // { color, x1, y1, x2, y2 }
    let pendingColor = null;

    for (let i = 0; i < ops.fnArray.length; i++) {
      const name = opNames[ops.fnArray[i]] || String(ops.fnArray[i]);
      const args = ops.argsArray[i];

      if (name === 'setFillRGBColor') {
        pendingColor = detectColor(args[0], args[1], args[2]);
      }
      if (name === 'setFillGray') {
        pendingColor = null; // gray = not colored
      }

      // constructPath followed by eoFill/fill = colored rectangle
      if ((name === 'eoFill' || name === 'fill' || name === 'fillStroke' || name === 'eoFillStroke') && pendingColor) {
        // Look back for the most recent constructPath
        for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
          const prevName = opNames[ops.fnArray[j]] || String(ops.fnArray[j]);
          if (prevName === 'constructPath') {
            const bounds = parseBoundsFromConstructPath(ops.argsArray[j]);
            if (bounds) {
              const w = bounds.x2 - bounds.x1;
              const h = bounds.y2 - bounds.y1;
              // Only capture single-line highlight rects (height 5-40px)
              // Ignore large container rects (table backgrounds, section boxes)
              if (w > 20 && h >= 5 && h <= 60) {
                coloredRects.push({ color: pendingColor, ...bounds });
              }
            }
            break;
          }
          // Also handle rectangle operator
          if (prevName === 'rectangle') {
            const [rx, ry, rw, rh] = ops.argsArray[j];
            if (Math.abs(rw) > 20 && Math.abs(rh) >= 5 && Math.abs(rh) <= 60) {
              coloredRects.push({
                color: pendingColor,
                x1: rx, y1: ry,
                x2: rx + Math.abs(rw), y2: ry + Math.abs(rh)
              });
            }
            break;
          }
        }
        pendingColor = null;
      }
    }

    // Step 2: for each colored rect, find text items whose position falls inside it
    for (const rect of coloredRects) {
      const margin = 6;
      const inside = textItems.filter(t => {
        // Text y in PDF is baseline — check if it's within the rect vertically
        return t.x >= rect.x1 - margin && t.x <= rect.x2 + margin &&
               t.y >= rect.y1 - margin && t.y <= rect.y2 + margin;
      });

      if (inside.length === 0) continue;

      const text = inside.map(t => t.str).join(' ').trim().replace(/\s+/g, ' ');
      if (text.length < 3) continue;

      // RED is Attention (needs attention / problems), YELLOW is Appreciation (positive feedback)
      if (rect.color === 'red') pushUnique(commentsNeedingAttention, text);
      else if (rect.color === 'yellow') pushUnique(appreciation, text);
    }
  }

  console.log(`\n[PDF Analyzer] YELLOW (appreciation): ${appreciation.length}`);
  appreciation.forEach((t, i) => console.log(`  [${i+1}] ${t}`));
  console.log(`[PDF Analyzer] RED (attention): ${commentsNeedingAttention.length}`);
  commentsNeedingAttention.forEach((t, i) => console.log(`  [${i+1}] ${t}`));

  return { appreciation, commentsNeedingAttention };
}

// ─────────────────────────────────────────────────────────────────
// FILTER: Is this text a real student comment?
// Rejects: page numbers, dates, URLs, table headers, metadata
// Accepts: single-word feedback ("GOOD", "Excellent", "best", "nice")
// ─────────────────────────────────────────────────────────────────
function isValidComment(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim();
  if (clean.length < 2) return false;

  // Reject page numbers like "1 / 3", "2/3", "about:blank 1 / 2"
  if (/^\d+\s*\/\s*\d+$/.test(clean)) return false;
  if (/about:blank/i.test(clean)) return false;
  if (/\d+\/\d+\/\d+/.test(clean) && clean.length < 35) return false; // dates e.g. "04/07/2026 17:03:01 PM"

  // Reject URLs
  if (/http|www\./i.test(clean)) return false;

  // Reject institution & report headers
  if (/madhav\s+institute|department\s+name|print\s+out/i.test(clean)) return false;
  if (/faculty\s+feedback|action\s+taken\s+report/i.test(clean)) return false;
  if (/academic\s+year|session:\s*july/i.test(clean)) return false;
  if (/average\s+ffi|average\s+response/i.test(clean)) return false;
  if (/feedback\s+submitted|report\s+generated/i.test(clean)) return false;

  // Reject table header keywords
  const tableKeywords = [
    'faculty name', 'course code', 'course name', 'semester', 'registered students',
    'link send', 'response %', 'submitted answers', 'label question',
    'signature', 'hod', 'pro - vc', 'ffi & suggestion', 'student feedback comments',
    'below average', 'course outcomes', 'qv 1', 'qv 2'
  ];
  const lower = clean.toLowerCase();
  if (tableKeywords.some(kw => lower.includes(kw))) return false;

  // Reject pure numbers or punctuation
  if (/^[\d\s.,\-–/\\%]+$/.test(clean)) return false;

  // Reject survey questions with numerical rating tables (e.g. "1 Classes are useful ... 0 7 14 11 16 3.75")
  if (/^\d+\s+[A-Za-z]/.test(clean) && /\b\d+\s+\d+\s+\d+\b/.test(clean)) return false;
  if (/^\d+\s+Total\b/i.test(clean)) return false;
  if (/\b(Below Average|Very good|Average)\b/i.test(clean) && /\d+/.test(clean)) return false;

  // Must have at least 1 letter
  if (!/[a-zA-Z]/.test(clean)) return false;

  return true;
}

// ─────────────────────────────────────────────────────────────────
// EXTRACT ALL STUDENT COMMENTS FROM PDF TEXT
// Handles:
// 1. Raw comment pages with individual rows (Page 4, 5, 7, 9)
// 2. Action Taken Report summary tables (Page 1-2) with bullet points
// ─────────────────────────────────────────────────────────────────
async function extractAllStudentComments(buffer, targetCourseCode) {
  const uint8 = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data: uint8, verbosity: 0 }).promise;
  let comments = [];
  const rawCommentPages = [];

  // Pass 1: Identify pages that have raw student comments
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const fullText = tc.items.map(i => i.str).join(' ').toLowerCase();

    const hasSubmitted = fullText.includes('submitted') && (fullText.includes('answer') || fullText.includes('response'));
    const hasStudentFeedbackHeader = fullText.includes('feedback') && (fullText.includes('comment') || fullText.includes('student'));
    const hasQuestionsTable = fullText.includes('label') && fullText.includes('question') && fullText.includes('qv');

    // Prefer pages dedicated to comments, but keep all potential pages
    if (hasSubmitted || hasStudentFeedbackHeader || !hasQuestionsTable) {
      rawCommentPages.push({ pageNum: p, page, tc, fullText, hasQuestionsTable });
    }
  }

  const extractRowsFromPages = (pages, filterCode) => {
    const res = [];
    for (const { pageNum, tc, fullText } of pages) {
      if (filterCode) {
        const cleanTarget = filterCode.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        const pageCodeMatch = fullText.match(/\d{5,}\s*-?\s*batch\s*-?\s*[a-z0-9]+/i);
        if (pageCodeMatch) {
          const pageCode = pageCodeMatch[0].replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
          if (pageCode !== cleanTarget) {
            continue; // belongs to another course in multi-course PDF
          }
        }
      }

      const items = tc.items.filter(i => i.str && i.str.trim());

      // Group text items by row Y (tolerance 3pt)
      const rowMap = {};
      items.forEach(i => {
        const yKey = Math.round(i.transform[5] / 3) * 3;
        if (!rowMap[yKey]) rowMap[yKey] = [];
        rowMap[yKey].push(i);
      });

      const yKeys = Object.keys(rowMap).map(Number).sort((a, b) => b - a);

      // Find the header line after which comments start
      let commentStartY = 750;
      for (const y of yKeys) {
        const line = rowMap[y].sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join(' ').toLowerCase();
        if ((line.includes('submitted') && (line.includes('answer') || line.includes('response'))) || (line.includes('student') && line.includes('feedback'))) {
          commentStartY = y;
          break;
        }
      }

      // Filter rows below header line and above bottom page footer (y > 30)
      const commentRows = yKeys.filter(y => y < commentStartY - 10 && y > 30).map(y => {
        const text = rowMap[y].sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join(' ').trim();
        return { y, text };
      });

      let i = 0;
      while (i < commentRows.length) {
        let curr = commentRows[i].text;
        while (i + 1 < commentRows.length && (commentRows[i].y - commentRows[i + 1].y) <= 16) {
          curr += ' ' + commentRows[i + 1].text;
          i++;
        }
        if (isValidComment(curr)) {
          res.push(curr.trim().replace(/\s+/g, ' '));
        }
        i++;
      }
    }
    return res;
  };

  // Pass 2: Extract rows from identified pages
  if (rawCommentPages.length > 0) {
    comments = extractRowsFromPages(rawCommentPages, targetCourseCode);
    if (comments.length === 0 && targetCourseCode) {
      comments = extractRowsFromPages(rawCommentPages, null);
    }
  }

  // Pass 3: Action Taken Report summary tables (Page 1-2) with bullet points
  if (comments.length === 0) {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const items = tc.items.filter(i => i.str && i.str.trim());
      const fullText = items.map(i => i.str).join(' ').toLowerCase();

      if (fullText.includes('action taken report') || (fullText.includes('needs attention') && fullText.includes('appreciation'))) {
        const tableComments = items
          .filter(i => i.transform[4] >= 340 && i.transform[4] < 680 && i.transform[5] > 30 && i.transform[5] < 750)
          .map(i => i.str)
          .join(' ');
        
        const bullets = tableComments.split(/•/).map(s => s.trim()).filter(Boolean);
        bullets.forEach(b => {
          if (!/^(good|very good|excellent|below average):\s*\d+%/i.test(b) && isValidComment(b)) {
            comments.push(b.trim().replace(/\s+/g, ' '));
          }
        });
      }
    }
  }

  // Pass 4: Fallback scan for valid feedback comments anywhere in doc
  if (comments.length === 0) {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const items = tc.items.filter(i => i.str && i.str.trim());
      for (const item of items) {
        const str = item.str.trim();
        if (str.length > 3 && isValidComment(str)) {
          if (/good|nice|excellent|poor|best|worst|speed|voice|doubt|explain|notes|exam|quiz|teach|clear|improve|slow|fast|audible|helpful/i.test(str)) {
            comments.push(str.replace(/\s+/g, ' '));
          }
        }
      }
    }
  }

  const unique = [...new Set(comments)];
  console.log(`[PDF] Extracted ${unique.length} student comments for AI analysis`);
  return unique;
}

// ─────────────────────────────────────────────────────────────────
// GOOGLE DRIVE LINK CONVERTER
// ─────────────────────────────────────────────────────────────────
function convertDriveLink(url) {
  if (!url) return url;
  // Handle /d/FILE_ID/... format
  const m1 = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) return `https://drive.google.com/uc?export=download&id=${m1[1]}`;
  // Handle ?id=FILE_ID or open?id=FILE_ID format
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2) return `https://drive.google.com/uc?export=download&id=${m2[1]}`;
  return url;
}

async function fetchPDFBuffer(url) {
  const res = await axios.get(convertDriveLink(url), {
    responseType: 'arraybuffer', timeout: 30000,
    headers: { 'User-Agent': 'Mozilla/5.0' }, maxRedirects: 5
  });
  return Buffer.from(res.data);
}

// ─────────────────────────────────────────────────────────────────
// METADATA EXTRACTION (MULTI-FORMAT)
// Correctly parses both MITS formats:
// Format 2: Standard MITS Faculty Feedback Form (header + data row)
// Format 1: Action Taken Report Summary Table
// Fallback: Robust field-level regular expressions
// ─────────────────────────────────────────────────────────────────
async function extractMetaFromBuffer(buffer) {
  const uint8 = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data: uint8, verbosity: 0 }).promise;

  let bestMeta = null;

  // 1. First attempt: Coordinate-based extraction on Page 1 (robust against line breaks and multi-row headers)
  try {
    const page = await doc.getPage(1);
    const tc = await page.getTextContent();
    const items = tc.items
      .filter(i => i.str && i.str.trim())
      .map(i => ({ str: i.str.trim(), x: Math.round(i.transform[4]), y: Math.round(i.transform[5]) }));

    // Group items by Y coordinate with 4px tolerance
    const rowMap = {};
    items.forEach(item => {
      const yKey = Math.round(item.y / 4) * 4;
      if (!rowMap[yKey]) rowMap[yKey] = [];
      rowMap[yKey].push(item);
    });

    const yKeys = Object.keys(rowMap).map(Number).sort((a, b) => b - a);
    let headerY = null;
    let dataY = null;

    for (const y of yKeys) {
      const rowText = rowMap[y].map(i => i.str.toLowerCase()).join(' ');
      if (rowText.includes('faculty') && (rowText.includes('code') || rowText.includes('name')) && (rowText.includes('semester') || rowText.includes('sem') || rowText.includes('ffi') || rowText.includes('resp'))) {
        headerY = y;
        const lowerRows = yKeys.filter(k => k < y).sort((a, b) => b - a);
        for (const ky of lowerRows) {
          if (rowMap[ky].length >= 5) {
            dataY = ky;
            break;
          }
        }
        break;
      }
    }

    if (headerY && dataY) {
      const dataRowItems = rowMap[dataY].sort((a, b) => a.x - b.x);

      // Extract FFI Score (float with decimal point, usually rightmost at ~X 540-560)
      const ffiItem = dataRowItems.filter(i => /^\d+\.\d+$/.test(i.str)).sort((a, b) => b.x - a.x)[0];
      const ffiScore = ffiItem ? parseFloat(ffiItem.str) : null;
      const ffiX = ffiItem ? ffiItem.x : 547;

      // Extract % Resp. (Response Percent): float or number just to the left of FFI (X between ffiX - 55 and ffiX - 10)
      let responsePercent = null;
      const pctItem = dataRowItems.find(i => i.x < ffiX - 10 && i.x >= ffiX - 60 && /^\d+(?:\.\d+)?$/.test(i.str));
      if (pctItem) {
        responsePercent = parseFloat(pctItem.str);
      }

      // Extract Response Count: integer to the left of % Resp. (X between ffiX - 110 and ffiX - 60)
      let responseCount = null;
      const respItem = dataRowItems.find(i => i.x < ffiX - 60 && i.x >= ffiX - 110 && /^\d+$/.test(i.str));
      if (respItem) {
        responseCount = parseInt(respItem.str, 10);
      }

      // Extract Link Sent: integer at X ~ 410-440
      let linkSent = null;
      const linkItem = dataRowItems.find(i => i.x >= 400 && i.x < 450 && /^\d+$/.test(i.str));
      if (linkItem) linkSent = parseInt(linkItem.str, 10);

      // Extract Registered Students: integer at X ~ 350-380
      let registeredStudents = null;
      const regItem = dataRowItems.find(i => i.x >= 340 && i.x < 390 && /^\d+$/.test(i.str));
      if (regItem) registeredStudents = parseInt(regItem.str, 10);

      // Extract Semester: 1 or 2 digits at X ~ 300-340
      let semester = '';
      const semItem = dataRowItems.find(i => i.x >= 300 && i.x < 340 && /^\d{1,2}$/.test(i.str));
      if (semItem) semester = semItem.str;

      // Extract Faculty Name: items at X < 140
      const facultyName = dataRowItems.filter(i => i.x < 140).map(i => i.str).join(' ').trim();

      // Extract Course Code: items between X 140 and 240
      const codeItems = dataRowItems.filter(i => i.x >= 140 && i.x < 240).map(i => i.str).join('');
      const subjectCode = codeItems ? codeItems.replace(/\s+/g, '-').replace(/-+/g, '-') : '';

      // Extract Course Name (Programme): items between X 240 and 320
      // Also check multiple adjacent rows above the data row (course names can wrap)
      const courseNameParts = [];
      const yKeysSorted = yKeys.filter(k => k > dataY && k < headerY).sort((a, b) => a - b);
      // Collect from up to 3 rows above the data row
      for (const aboveY of yKeysSorted.slice(-3)) {
        if (rowMap[aboveY]) {
          rowMap[aboveY].filter(i => i.x >= 240 && i.x < 320).forEach(i => {
            if (i.str.trim()) courseNameParts.unshift(i.str.trim());
          });
        }
      }
      dataRowItems.filter(i => i.x >= 240 && i.x < 320).forEach(i => {
        if (i.str.trim()) courseNameParts.push(i.str.trim());
      });
      const programme = courseNameParts.join(' ').replace(/\s+/g, ' ').trim();

      if (facultyName || subjectCode || ffiScore !== null) {
        // If responsePercent missing but responseCount and linkSent/registeredStudents exist, calculate
        if (responsePercent === null && responseCount !== null) {
          const base = linkSent || registeredStudents;
          if (base && base > 0) {
            responsePercent = Math.round((responseCount / base) * 10000) / 100;
          }
        }

        bestMeta = {
          facultyName,
          subjectCode,
          programme,
          semester,
          registeredStudents,
          linkSent,
          responseCount,
          responsePercent,
          ffiScore
        };
      }
    }
  } catch (err) {
    console.warn('[extractMeta] Coordinate extraction warning:', err.message);
  }

  // 2. Second attempt: Format 2 & Format 1 Regex
  if (!bestMeta || !bestMeta.facultyName || bestMeta.ffiScore === null) {
    const fmt2Regex = /Faculty\s+Name\s+Course\s+Code\s+Course\s+Name\s+Semester\s+Registered\s+Students\s+Link\s+Send\s+to\s+Students\s+Response\s+%\s*Resp\.?\s+FFI\s+([A-Za-z\s.]+?)\s+(\d{5,}(?:\s*-\s*Batch\s*-\s*[A-Z0-9]+|\s*-\s*[A-Za-z0-9]+|\s+Batch\s*-\s*[A-Z0-9]+)?)\s+([\w\s&,.\/-]+?)\s+(\d{1,2})\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/i;
    const fmt1Regex = /Faculty\s+Name\s+Code\s*\/\s*Batch\s+Programme\s+Sem(?:ester)?\s+FFI\s+Resp\.?\s+Needs\s+Attention\s+Appreciation\s+Action\s+Taken\s+Faculty\s+Signature\s+(\d+)\s+([A-Za-z\s.]+?)\s+(\d{5,}(?:\s*Batch\s*-\s*[A-Z0-9]+|\s*-\s*[A-Za-z0-9]+)?)\s+(.+?)\s+(\d{1,2})\s+(\d+(?:\.\d+)?)\s+([\d\-]+)/i;

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const text = tc.items.map(i => i.str.trim()).filter(Boolean).join(' ');

      const m2 = text.match(fmt2Regex);
      if (m2) {
        bestMeta = {
          facultyName: m2[1].trim(),
          subjectCode: m2[2].replace(/\s+/g, '-').replace(/-+/g, '-'),
          programme: m2[3].trim(),
          semester: m2[4].trim(),
          registeredStudents: parseInt(m2[5], 10),
          linkSent: parseInt(m2[6], 10),
          responseCount: parseInt(m2[7], 10),
          responsePercent: parseFloat(m2[8]),
          ffiScore: parseFloat(m2[9])
        };
        break;
      }

      if (!bestMeta) {
        const m1 = text.match(fmt1Regex);
        if (m1) {
          bestMeta = {
            facultyName: m1[2].trim(),
            subjectCode: m1[3].replace(/\s+/g, '-').replace(/-+/g, '-'),
            programme: m1[4].trim(),
            semester: m1[5].trim(),
            ffiScore: parseFloat(m1[6]),
            responseCount: /^\d+$/.test(m1[7]) ? parseInt(m1[7], 10) : null,
            responsePercent: null
          };
        }
      }
    }
  }

  // 3. Fallback: individual field regex search
  if (!bestMeta) {
    let facultyName = '', subjectCode = '', programme = '', semester = '', ffiScore = null, responseCount = null, responsePercent = null;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const fullText = tc.items.map(i => i.str.trim()).filter(Boolean).join(' ');

      if (!facultyName) {
        const m = fullText.match(/(?:faculty\s*name|name\s*of\s*faculty)\s*[:\-]?\s*([A-Za-z\s.]+?)(?=\s+(?:course|code|programme|semester|$))/i);
        if (m && m[1].trim().length > 2) facultyName = m[1].trim();
      }
      if (!subjectCode) {
        const m = fullText.match(/(?:course\s*code|code\s*\/\s*batch|code)\s*[:\-]?\s*(\d{5,}(?:\s*-\s*Batch\s*-\s*[A-Z0-9]+|\s*-\s*[A-Za-z0-9]+)?)/i);
        if (m) subjectCode = m[1].replace(/\s+/g, '-').replace(/-+/g, '-');
      }
      if (!programme) {
        // Capture everything after "course name/programme/branch" until semester/sem/digit or end
        const m = fullText.match(/(?:course\s*name|programme|branch)\s*[:\-]?\s*((?:[A-Za-z0-9&,./\-]+\s*)+?)(?=\s*(?:semester|sem\b|\d{1,2}\s*(?:semester|sem|\b)|ffi|resp|response|$))/i);
        if (m && m[1].trim().length > 2) programme = m[1].trim().replace(/\s+/g, ' ');
      }
      if (!semester) {
        const m = fullText.match(/(?:semester|sem)\s*[:\-]?\s*(\d{1,2})\b/i);
        if (m) semester = m[1];
      }
      if (ffiScore === null) {
        const m = fullText.match(/(?:ffi\s*score|ffi|average\s*ffi)\s*[:\-–]?\s*(\d+\.\d+)/i);
        if (m) ffiScore = parseFloat(m[1]);
      }
      if (responseCount === null) {
        const m = fullText.match(/(?:submitted\s*answers|responses?)\s*[:\-–]?\s*(\d+)/i);
        if (m) responseCount = parseInt(m[1], 10);
      }
      if (responsePercent === null) {
        const m = fullText.match(/(?:%\s*resp\.?|response\s*%|resp\s*%)\s*[:\-–]?\s*(\d+(?:\.\d+)?)/i);
        if (m) responsePercent = parseFloat(m[1]);
      }
    }
    bestMeta = { facultyName, subjectCode, programme, semester, ffiScore, responseCount, responsePercent };
  }

  return bestMeta;
}

// ─────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────
async function analyzePDF(pdfLink) {
  const buffer = await fetchPDFBuffer(pdfLink);
  return analyzePDFBuffer(buffer);
}

/**
 * Calculate accurate percentages from raw student comments.
 * Counts exact keyword occurrences across ALL comments (not just classified ones).
 * Returns: { "Excellent": 10, "Very Good": 25, "Good": 65 } (percentages)
 */
function calculateCommentPercentages(allComments, responseCount) {
  if (!allComments || allComments.length === 0) return {};

  const KEYWORDS = {
    'Excellent': ['excellent', 'outstanding', 'superb', 'brilliant', 'best', 'besttttt', 'bestt', 'excellent teacher', 'excellent mam', 'excellent sir'],
    'Very Good': ['very good', 'very well', 'very nice', 'very helpful', 'very great'],
    'Good':      ['good', 'great', 'nice', 'well done', 'satisfactory', 'good teacher', 'good mam', 'good sir', 'overall good', 'nicely'],
  };

  const counts = { 'Excellent': 0, 'Very Good': 0, 'Good': 0 };

  allComments.forEach(comment => {
    const lower = comment.toLowerCase().trim();
    // Check in priority order: Excellent > Very Good > Good
    for (const [category, keywords] of Object.entries(KEYWORDS)) {
      if (keywords.some(kw => {
        // Match: exact, starts with, ends with, or contains as whole word
        return lower === kw
          || lower === kw + '.'
          || lower.startsWith(kw + ' ')
          || lower.endsWith(' ' + kw)
          || lower.includes(' ' + kw + ' ')
          || lower.includes(' ' + kw + '.')
          // Also match if comment IS just this keyword (case insensitive)
          || lower.replace(/[^a-z\s]/g, '').trim() === kw;
      })) {
        counts[category]++;
        break;
      }
    }
  });

  const total = responseCount && responseCount > 0 ? responseCount : allComments.length;
  const result = {};
  for (const [label, count] of Object.entries(counts)) {
    if (count > 0) {
      result[label] = Math.round((count / total) * 100);
    }
  }
  return result;
}

async function analyzePDFBuffer(buffer) {
  const { analyzeCommentsWithAI } = require('./aiAnalyzer');

  // Extract meta, highlights, and text comments
  const meta = await extractMetaFromBuffer(buffer);
  const highlights = await extractHighlightedText(buffer).catch(e => {
    console.warn('[PDF Analyzer] Highlight extraction error:', e.message);
    return { appreciation: [], commentsNeedingAttention: [] };
  });
  const allComments = await extractAllStudentComments(buffer, meta?.subjectCode);

  // Include any highlighted comments in allComments
  (highlights?.appreciation || []).forEach(c => {
    if (!allComments.some(x => x.toLowerCase() === c.toLowerCase())) allComments.push(c);
  });
  (highlights?.commentsNeedingAttention || []).forEach(c => {
    if (!allComments.some(x => x.toLowerCase() === c.toLowerCase())) allComments.push(c);
  });

  let appreciation = [];
  let commentsNeedingAttention = [];
  let commentCategories = {};

  if (allComments.length > 0) {
    try {
      const aiResult = await analyzeCommentsWithAI(allComments);
      appreciation = aiResult.appreciation || [];
      commentsNeedingAttention = aiResult.commentsNeedingAttention || [];
      commentCategories = aiResult.commentCategories || {};
    } catch (aiErr) {
      console.warn('[PDF] AI analysis failed, falling back to rule-based sorting:', aiErr.message);
    }
  }

  // Guarantee that detected highlighted text is included in final lists
  (highlights?.appreciation || []).forEach(c => {
    pushUnique(appreciation, c);
  });
  (highlights?.commentsNeedingAttention || []).forEach(c => {
    pushUnique(commentsNeedingAttention, c);
    // Categorize attention comment if categories exist
    if (commentCategories) {
      const lower = c.toLowerCase();
      if (/speed|fast|slow|rush|pace/i.test(lower)) {
        commentCategories.Speed = commentCategories.Speed || [];
        if (!commentCategories.Speed.includes(c)) commentCategories.Speed.push(c);
      } else if (/voice|audible|volume|sound|mic|hear|loud/i.test(lower)) {
        commentCategories.Clarity = commentCategories.Clarity || [];
        if (!commentCategories.Clarity.includes(c)) commentCategories.Clarity.push(c);
      } else if (/note|material|pdf|ppt|slide|book|bank|question/i.test(lower)) {
        commentCategories.Materials = commentCategories.Materials || [];
        if (!commentCategories.Materials.includes(c)) commentCategories.Materials.push(c);
      } else if (/doubt|interactive|discuss|ask|talk/i.test(lower)) {
        commentCategories.Interaction = commentCategories.Interaction || [];
        if (!commentCategories.Interaction.includes(c)) commentCategories.Interaction.push(c);
      } else {
        commentCategories.General = commentCategories.General || [];
        if (!commentCategories.General.includes(c)) commentCategories.General.push(c);
      }
    }
  });

  const commentPercentages = calculateCommentPercentages(allComments, meta?.responseCount);

  return {
    appreciation,
    commentsNeedingAttention,
    appreciationCount: appreciation.length,
    attentionCount: commentsNeedingAttention.length,
    commentPercentages,
    commentCategories,
    rawStudentComments: allComments,
    meta, // Include full meta object
    ffiScore: meta?.ffiScore ?? null,
    responseCount: meta?.responseCount ?? null,
    responsePercent: meta?.responsePercent ?? null,
    registeredStudents: meta?.registeredStudents ?? null,
    linkSent: meta?.linkSent ?? null,
    analyzedAt: new Date()
  };
}

async function extractMetaFromPDF(buffer) {
  try { return await extractMetaFromBuffer(buffer); }
  catch { return { facultyName: '', subjectCode: '', programme: '', semester: '', ffiScore: null, responseCount: null, responsePercent: null }; }
}

module.exports = { analyzePDF, analyzePDFBuffer, extractMetaFromPDF, extractHighlightedText, convertDriveLink };
