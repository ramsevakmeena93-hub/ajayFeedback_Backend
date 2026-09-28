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
    if (!Array.isArray(arr)) return;
    if (typeof value !== 'string') return;

    const cleaned = value
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned) return;

    // Do not add extremely short/non-comment strings
    if (cleaned.length < 8) return;

    // Normalize and check duplicates (case-insensitive, handles punctuation)
    const normalized = cleaned.toLowerCase().replace(/[.,!?;:]+$/, '');

    const isDuplicate = arr.some(existing => {
        const existingNorm = existing.toLowerCase().replace(/[.,!?;:]+$/, '');
        return existingNorm === normalized;
    });

    if (!isDuplicate) {
        arr.push(cleaned);
    }
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

    // Minimum length to be considered a real comment (increased to filter more garbage)
    if (clean.length < 10) return false;

    // Reject page numbers like "1 / 3", "2/3", "about:blank 1 / 2"
    if (/^\d+\s*\/\s*\d+$/.test(clean)) return false;
    if (/about:blank/i.test(clean)) return false;

    // Reject dates (e.g. "04/07/2026 17:03:01 PM")
    if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(clean) && clean.length < 40) return false;

    // Reject URLs
    if (/http|www\./i.test(clean)) return false;

    // Reject institution & report headers
    const headerPatterns = [
        /madhav\s+institute/i,
        /department\s+name/i,
        /print\s+out/i,
        /faculty\s+feedback/i,
        /action\s+taken\s+report/i,
        /academic\s+year/i,
        /session:\s*july/i,
        /average\s+ffi/i,
        /average\s+response/i,
        /feedback\s+submitted/i,
        /report\s+generated/i
    ];

    if (headerPatterns.some(p => p.test(clean))) return false;

    // Reject table header keywords and metadata
    const tableKeywords = [
        'faculty name', 'course code', 'course name', 'semester', 'registered students',
        'link send', 'response %', 'submitted answers', 'label question', 'submitted answer',
        'signature', 'hod', 'pro - vc', 'ffi & suggestion', 'student feedback comments',
        'below average', 'course outcomes', 'qv 1', 'qv 2', 'needs attention', 'appreciation',
        'question', 'answer', 'response count', 'total responses', 'feedback form',
        'submit', 'label', 'requirement', 'operating system', 'real world', 'purchased'
    ];
    const lower = clean.toLowerCase();
    if (tableKeywords.some(kw => lower.includes(kw))) return false;
    
    // Reject if it looks like a course/subject name followed by an answer
    // e.g. "Software Engineering 45" or "Data Structures Yes" or "operating system purchased"
    if (/^[A-Z][A-Za-z\s&]+\s+(?:\d+|yes|no|n\.?a\.?|purchased|required)$/i.test(clean)) return false;
    
    // Reject lines that look like questions or prompts
    if (/\brequirement\b|\boperating system\b|\breal world\b|\bpurchased\b|\bproblem\b.*\bsoftware\b/i.test(clean)) return false;
    
    // Reject if it contains multiple tab-separated or pipe-separated values (table data)
    if (clean.split(/\t|\|/).length > 3) return false;

    // Reject pure numbers or punctuation
    if (/^[\d\s.,\-–/\\%]+$/.test(clean)) return false;

    // Reject survey questions with numerical rating tables
    if (/^\d+\s+[A-Za-z]/.test(clean) && /\b\d+\s+\d+\s+\d+\b/.test(clean)) return false;
    if (/^\d+\s+Total\b/i.test(clean)) return false;
    if (/\b(Below Average|Very good|Average)\b/i.test(clean) && /\d+/.test(clean)) return false;

    // Must have at least 1 letter
    if (!/[a-zA-Z]/.test(clean)) return false;

    // Reject if it's ONLY a rating word with no additional content
    const ratingOnlyPatterns = [
        /^(good|nice|excellent|poor|best|worst|average|ok|okay)\.?$/i,
        /^(very\s+good|very\s+nice|very\s+bad)\.?$/i
    ];
    if (ratingOnlyPatterns.some(p => p.test(clean))) return false;

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

            // CRITICAL: Accumulate complete multi-line comments WITHOUT splitting on sentiment keywords
            let i = 0;
            while (i < commentRows.length) {
                let curr = commentRows[i].text;

                // Merge continuation rows (line breaks within same comment)
                while (i + 1 < commentRows.length && (commentRows[i].y - commentRows[i + 1].y) <= 16) {
                    curr += ' ' + commentRows[i + 1].text;
                    i++;
                }

                // Clean and normalize whitespace
                curr = curr.trim().replace(/\s+/g, ' ');

                // Add complete comment as-is (NO splitting)
                if (isValidComment(curr)) {
                    res.push(curr);
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
                    // Clean and validate
                    const cleaned = b.trim().replace(/\s+/g, ' ');
                    if (!/^(good|very good|excellent|below average):\s*\d+%/i.test(cleaned) && isValidComment(cleaned)) {
                        comments.push(cleaned);
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
                const str = item.str.trim().replace(/\s+/g, ' ');
                if (str.length >= 8 && isValidComment(str)) {
                    // Look for feedback keywords
                    if (/good|nice|excellent|poor|best|worst|speed|voice|doubt|explain|notes|exam|quiz|teach|clear|improve|slow|fast|audible|helpful|teaching|class|lecture|understand/i.test(str)) {
                        comments.push(str);
                    }
                }
            }
        }
    }

    // Deduplicate using case-insensitive normalization
    const seen = new Set();
    const unique = [];
    for (const comment of comments) {
        const normalized = comment.toLowerCase().replace(/[.,!?;:]+$/, '');
        if (!seen.has(normalized)) {
            seen.add(normalized);
            unique.push(comment);
        }
    }

    console.log(`[PDF] Extracted ${unique.length} complete student comments (no splitting on sentiment keywords)`);
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
  // Check if it's a Google Drive link
  const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)|[?&]id=([a-zA-Z0-9_-]+)/);
  
  if (fileIdMatch) {
    // Google Drive link - use service account authentication
    const fileId = fileIdMatch[1] || fileIdMatch[2];
    
    try {
      const { google } = require('googleapis');
      
      // Check if service account credentials are available
      const clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
      const privateKey = process.env.GOOGLE_DRIVE_PRIVATE_KEY;
      
      if (clientEmail && privateKey) {
        console.log('[PDF] Using service account to download Drive file:', fileId);
        
        // Create authentication
        const auth = new google.auth.GoogleAuth({
          credentials: {
            client_email: clientEmail,
            private_key: privateKey.replace(/\\n/g, '\n'),
          },
          scopes: ['https://www.googleapis.com/auth/drive.readonly'],
        });
        
        const drive = google.drive({ version: 'v3', auth });
        
        // Download file using Drive API
        const response = await drive.files.get({
          fileId: fileId,
          alt: 'media',
        }, {
          responseType: 'arraybuffer'
        });
        
        console.log('[PDF] Successfully downloaded via service account');
        return Buffer.from(response.data);
      } else {
        console.warn('[PDF] Service account credentials not found, falling back to public download');
      }
    } catch (error) {
      console.error('[PDF] Service account download failed:', error.message);
      console.log('[PDF] Falling back to public download method');
    }
  }
  
  // Fallback: Use public download (works if file is publicly accessible)
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

    // 1. COORDINATE-BASED EXTRACTION (most reliable for standard MITS PDFs)
    try {
        const page = await doc.getPage(1);
        const tc = await page.getTextContent();
        const items = tc.items
            .filter(i => i.str && i.str.trim())
            .map(i => ({
                str: i.str.trim(),
                x: Math.round(i.transform[4]),
                y: Math.round(i.transform[5])
            }));

        // Group by Y coordinate (4px tolerance for multi-line headers)
        const rowMap = {};
        items.forEach(item => {
            const yKey = Math.round(item.y / 4) * 4;
            if (!rowMap[yKey]) rowMap[yKey] = [];
            rowMap[yKey].push(item);
        });

        const yKeys = Object.keys(rowMap).map(Number).sort((a, b) => b - a);
        let headerY = null;
        let dataY = null;

        // Find table header row
        for (const y of yKeys) {
            const rowText = rowMap[y].map(i => i.str.toLowerCase()).join(' ');
            if (rowText.includes('faculty') &&
                (rowText.includes('code') || rowText.includes('name')) &&
                (rowText.includes('semester') || rowText.includes('sem') || rowText.includes('ffi'))) {
                headerY = y;

                // Find first substantial data row below header
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

            // Extract FFI Score (rightmost decimal value at ~X 540-560)
            const ffiItem = dataRowItems
                .filter(i => /^\d+\.\d+$/.test(i.str))
                .sort((a, b) => b.x - a.x)[0];
            const ffiScore = ffiItem ? parseFloat(ffiItem.str) : null;
            const ffiX = ffiItem ? ffiItem.x : 547;

            // Extract Response Percent (decimal/integer left of FFI, X range: ffiX-60 to ffiX-10)
            let responsePercent = null;
            const pctItem = dataRowItems.find(i =>
                i.x < ffiX - 10 &&
                i.x >= ffiX - 60 &&
                /^\d+(?:\.\d+)?$/.test(i.str)
            );
            if (pctItem) responsePercent = parseFloat(pctItem.str);

            // Extract Response Count (integer left of percent, X range: ffiX-110 to ffiX-60)
            let responseCount = null;
            const respItem = dataRowItems.find(i =>
                i.x < ffiX - 60 &&
                i.x >= ffiX - 110 &&
                /^\d+$/.test(i.str)
            );
            if (respItem) responseCount = parseInt(respItem.str, 10);

            // Extract Link Sent (X ~ 400-450)
            let linkSent = null;
            const linkItem = dataRowItems.find(i =>
                i.x >= 400 && i.x < 450 && /^\d+$/.test(i.str)
            );
            if (linkItem) linkSent = parseInt(linkItem.str, 10);

            // Extract Registered Students (X ~ 340-390)
            let registeredStudents = null;
            const regItem = dataRowItems.find(i =>
                i.x >= 340 && i.x < 390 && /^\d+$/.test(i.str)
            );
            if (regItem) registeredStudents = parseInt(regItem.str, 10);

            // Extract Semester (X ~ 300-340, but be more flexible)
            // Look in the semester column area
            let semester = '';
            
            // Strategy 1: Look in expected semester column position
            const semItem = dataRowItems.find(i =>
                i.x >= 280 && i.x < 370 && /^\d{1,2}$/.test(i.str)
            );
            if (semItem) {
                semester = semItem.str;
            } 
            
            if (!semester) {
                // Strategy 2: Look for ANY single digit 1-8 in wider area
                const fallbackSem = dataRowItems.find(i => 
                    i.x >= 230 && i.x < 450 && /^[1-8]$/.test(i.str)
                );
                if (fallbackSem) {
                    semester = fallbackSem.str;
                }
            }
            
            if (!semester) {
                // Strategy 3: Scan all nearby rows (above and below data row)
                const nearbyItems = items.filter(i => 
                    Math.abs(i.y - dataY) < 15 && 
                    i.x >= 230 && i.x < 450
                );
                for (const item of nearbyItems) {
                    if (/^[1-8]$/.test(item.str)) {
                        semester = item.str;
                        break;
                    }
                }
            }
            
            if (!semester) {
                // Strategy 4: Look in all items for semester near faculty/course info
                const allNearby = items.filter(i => 
                    Math.abs(i.y - dataY) < 25
                );
                for (const item of allNearby) {
                    const match = item.str.match(/^(sem|semester|sem\.|s)\s*[:\-]?\s*([1-8])$/i);
                    if (match) {
                        semester = match[2];
                        break;
                    }
                    // Also check for Roman numerals
                    const romanMatch = item.str.match(/^(I{1,3}V?|V?I{1,3})$/);
                    if (romanMatch) {
                        const romanToNum = { 'I': '1', 'II': '2', 'III': '3', 'IV': '4', 'V': '5', 'VI': '6', 'VII': '7', 'VIII': '8' };
                        semester = romanToNum[romanMatch[1].toUpperCase()] || romanMatch[1];
                        break;
                    }
                }
            }

            // Extract Faculty Name (X < 140)
            const facultyName = dataRowItems
                .filter(i => i.x < 140)
                .map(i => i.str)
                .join(' ')
                .trim();

            // Extract Course Code (X 140-240)
            const codeItems = dataRowItems
                .filter(i => i.x >= 140 && i.x < 240)
                .map(i => i.str)
                .join('');
            const subjectCode = codeItems
                ? codeItems.replace(/\s+/g, '-').replace(/-+/g, '-')
                : '';

            // Extract Programme/Course Name (X 240-320)
            // Collect ALL text in the course name column area, including multi-line wrapped text
            const courseNameParts = [];
            
            // Strategy: Collect all text items in the X range 230-330 that appear
            // between the data row and header row (or within reasonable Y distance)
            const minY = Math.min(dataY - 50, headerY); // Look up to 50 units above
            const maxY = dataY + 20; // And 20 units below
            
            // Group all text items by Y position in the course name X range
            const courseTexts = items
                .filter(i => i.x >= 230 && i.x < 330 && i.y >= minY && i.y <= maxY)
                .sort((a, b) => b.y - a.y); // Sort by Y descending (top to bottom)
            
            // Collect unique text, filtering out headers and numbers
            const seenTexts = new Set();
            for (const item of courseTexts) {
                const text = item.str.trim();
                if (text && text.length > 1 && 
                    !seenTexts.has(text.toLowerCase()) &&
                    !text.match(/^(semester|sem|ffi|resp|programme|code|faculty|name|students|link|send|response|course|registered|\d+)$/i)) {
                    courseNameParts.push(text);
                    seenTexts.add(text.toLowerCase());
                }
            }

            const programme = courseNameParts.join('\n').trim(); // Preserve line breaks

            // Calculate missing response percent if possible
            if (facultyName || subjectCode || ffiScore !== null) {
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
        console.warn('[extractMetaFromBuffer] Coordinate extraction failed:', err.message);
    }

    // 2. REGEX-BASED EXTRACTION (fallback for non-standard layouts)
    if (!bestMeta || !bestMeta.facultyName || bestMeta.ffiScore === null) {
        // Format 2: Standard MITS Faculty Feedback Form
        const fmt2Regex = /Faculty\s+Name\s+Course\s+Code\s+Course\s+Name\s+Semester\s+Registered\s+Students\s+Link\s+Send\s+to\s+Students\s+Response\s+%\s*Resp\.?\s+FFI\s+([A-Za-z\s.]+?)\s+(\d{5,}(?:\s*-\s*Batch\s*-\s*[A-Z0-9]+|\s*-\s*[A-Za-z0-9]+|\s+Batch\s*-\s*[A-Z0-9]+)?)\s+([\w\s&,.\/-]+?)\s+(\d{1,2})\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/i;

        // Format 1: Action Taken Report Summary Table
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

    // 3. FIELD-BY-FIELD REGEX FALLBACK (last resort)
    if (!bestMeta) {
        let facultyName = '', subjectCode = '', programme = '', semester = '';
        let ffiScore = null, responseCount = null, responsePercent = null;

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
                // More flexible pattern for course name
                const patterns = [
                    /(?:course\s*name|programme|branch)\s*[:\-]?\s*((?:[A-Za-z0-9&,./\-\(\)]+\s*)+?)(?=\s*(?:semester|sem\b|\d{1,2}\s*(?:semester|sem|\b)|ffi|resp|response|registered|$))/i,
                    /(?:^|\n)((?:[A-Z][A-Za-z0-9&,./\-\(\)\s]+))(?=\s*(?:semester|sem\b|I{1,3}V?|V?I{1,3}\b))/im, // Matches course names before semester numbers
                    /programme\s*[:\-]?\s*([A-Z][A-Za-z0-9&,./\-\(\)\s]+?)(?=\s*semester)/i
                ];
                
                for (const pattern of patterns) {
                    const m = fullText.match(pattern);
                    if (m && m[1] && m[1].trim().length > 3) {
                        programme = m[1].trim().replace(/\s+/g, ' ');
                        break;
                    }
                }
            }

            if (!semester) {
                // Multiple patterns for semester
                const patterns = [
                    /(?:semester|sem)\s*[:\-]?\s*(\d{1,2})\b/i,
                    /\bsem\s*[:\-]?\s*([1-8])\b/i,
                    /\b(I{1,3}V?|V?I{1,3})\s*(?:semester|sem)\b/i, // Roman numerals
                    /(?:semester|sem)\s*[:\-]?\s*(I{1,3}V?|V?I{1,3})\b/i
                ];
                
                for (const pattern of patterns) {
                    const m = fullText.match(pattern);
                    if (m && m[1]) {
                        // Convert Roman to number if needed
                        const romanToNum = { 'I': '1', 'II': '2', 'III': '3', 'IV': '4', 'V': '5', 'VI': '6', 'VII': '7', 'VIII': '8' };
                        semester = romanToNum[m[1].toUpperCase()] || m[1];
                        break;
                    }
                }
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

        bestMeta = {
            facultyName,
            subjectCode,
            programme,
            semester,
            ffiScore,
            responseCount,
            responsePercent
        };
    }

    console.log('[PDF] Metadata extraction complete:', bestMeta ? 'Success' : 'Partial');
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

    // Priority-based keyword matching (check in order: Excellent > Very Good > Good)
    const KEYWORDS = {
        'Excellent': [
            'excellent', 'outstanding', 'superb', 'brilliant',
            'best', 'besttttt', 'bestt',
            'excellent teacher', 'excellent mam', 'excellent sir', 'excellent ma\'am'
        ],
        'Very Good': [
            'very good', 'very well', 'very nice',
            'very helpful', 'very great', 'very clear'
        ],
        'Good': [
            'good', 'great', 'nice', 'well done', 'satisfactory',
            'good teacher', 'good mam', 'good sir', 'good ma\'am',
            'overall good', 'nicely', 'fine', 'decent'
        ]
    };

    const counts = { 'Excellent': 0, 'Very Good': 0, 'Good': 0 };

    allComments.forEach(comment => {
        const lower = comment.toLowerCase().trim();

        // Match in priority order (first match wins)
        for (const [category, keywords] of Object.entries(KEYWORDS)) {
            const matched = keywords.some(kw => {
                // Exact match
                if (lower === kw || lower === kw + '.') return true;

                // Word boundary matches
                if (lower.startsWith(kw + ' ') || lower.endsWith(' ' + kw)) return true;
                if (lower.includes(' ' + kw + ' ') || lower.includes(' ' + kw + '.')) return true;

                // Clean alphanumeric match (handles punctuation)
                const cleanLower = lower.replace(/[^a-z\s]/g, '').trim();
                return cleanLower === kw || cleanLower === kw.replace(/'/g, '');
            });

            if (matched) {
                counts[category]++;
                break; // Stop after first category match
            }
        }
    });

    // Calculate percentages using responseCount as denominator (if available)
    const total = (responseCount && responseCount > 0) ? responseCount : allComments.length;
    const result = {};

    for (const [label, count] of Object.entries(counts)) {
        if (count > 0) {
            result[label] = Math.round((count / total) * 100);
        }
    }

    console.log(`[PDF] Comment percentages calculated:`, result);
    return result;
}

async function analyzePDFBuffer(buffer) {
    const { analyzeCommentsWithAI } = require('./aiAnalyzer');

    console.log('[PDF] Starting PDF analysis...');

    // STEP 1: Extract metadata
    const meta = await extractMetaFromBuffer(buffer);
    console.log('[PDF] Metadata extracted:', meta ? 'Success' : 'Partial');

    // STEP 2: Extract highlighted text (yellow/red backgrounds)
    const highlights = await extractHighlightedText(buffer).catch(e => {
        console.warn('[PDF Analyzer] Highlight extraction error:', e.message);
        return { appreciation: [], commentsNeedingAttention: [] };
    });

    // STEP 3: Extract ALL student comments (complete, no splitting)
    const allComments = await extractAllStudentComments(buffer, meta?.subjectCode);

    // STEP 4: Merge highlighted comments into allComments (deduplicate)
    (highlights?.appreciation || []).forEach(c => {
        const normalized = c.toLowerCase().replace(/[.,!?;:]+$/, '');
        const exists = allComments.some(x => x.toLowerCase().replace(/[.,!?;:]+$/, '') === normalized);
        if (!exists) allComments.push(c);
    });

    (highlights?.commentsNeedingAttention || []).forEach(c => {
        const normalized = c.toLowerCase().replace(/[.,!?;:]+$/, '');
        const exists = allComments.some(x => x.toLowerCase().replace(/[.,!?;:]+$/, '') === normalized);
        if (!exists) allComments.push(c);
    });

    // STEP 5: Classify comments using AI
    let appreciation = [];
    let commentsNeedingAttention = [];
    let commentCategories = {};

    if (allComments.length > 0) {
        try {
            console.log(`[PDF] Sending ${allComments.length} comments to AI classifier...`);
            const aiResult = await analyzeCommentsWithAI(allComments);
            appreciation = aiResult.appreciation || [];
            commentsNeedingAttention = aiResult.commentsNeedingAttention || [];
            commentCategories = aiResult.commentCategories || {};

            console.log(`[PDF] AI classification complete: ${appreciation.length} appreciation, ${commentsNeedingAttention.length} need attention`);
        } catch (aiErr) {
            console.error('[PDF] AI analysis failed:', aiErr.message);
            console.log('[PDF] Falling back to rule-based classification...');

            // Fallback: simple keyword-based sorting
            allComments.forEach(comment => {
                const lower = comment.toLowerCase();
                if (/excellent|outstanding|superb|brilliant|best|very good|great|nice|helpful|clear|understand|perfect/i.test(lower)) {
                    pushUnique(appreciation, comment);
                } else if (/poor|bad|worst|slow|fast|audible|voice|doubt|problem|issue|improve|confus|unclear/i.test(lower)) {
                    pushUnique(commentsNeedingAttention, comment);
                } else {
                    // Neutral comments go to appreciation by default (general feedback)
                    pushUnique(appreciation, comment);
                }
            });
        }
    }

    // STEP 6: Guarantee highlighted comments are in final classification
    // (Priority: Highlighted > AI classification)
    (highlights?.appreciation || []).forEach(c => {
        pushUnique(appreciation, c);
    });

    (highlights?.commentsNeedingAttention || []).forEach(c => {
        pushUnique(commentsNeedingAttention, c);

        // Auto-categorize "Need Attention" comments
        if (commentCategories) {
            const lower = c.toLowerCase();
            if (/speed|fast|slow|rush|pace/i.test(lower)) {
                commentCategories.Speed = commentCategories.Speed || [];
                if (!commentCategories.Speed.includes(c)) commentCategories.Speed.push(c);
            } else if (/voice|audible|volume|sound|mic|hear|loud|speak/i.test(lower)) {
                commentCategories.Clarity = commentCategories.Clarity || [];
                if (!commentCategories.Clarity.includes(c)) commentCategories.Clarity.push(c);
            } else if (/note|material|pdf|ppt|slide|book|bank|question|handout/i.test(lower)) {
                commentCategories.Materials = commentCategories.Materials || [];
                if (!commentCategories.Materials.includes(c)) commentCategories.Materials.push(c);
            } else if (/doubt|interactive|discuss|ask|talk|question|session/i.test(lower)) {
                commentCategories.Interaction = commentCategories.Interaction || [];
                if (!commentCategories.Interaction.includes(c)) commentCategories.Interaction.push(c);
            } else {
                commentCategories.General = commentCategories.General || [];
                if (!commentCategories.General.includes(c)) commentCategories.General.push(c);
            }
        }
    });

    // STEP 7: Calculate comment percentages (Excellent, Very Good, Good)
    const commentPercentages = calculateCommentPercentages(allComments, meta?.responseCount);

    console.log(`[PDF] Analysis complete: ${allComments.length} total comments extracted`);

    return {
        appreciation,
        commentsNeedingAttention,
        appreciationCount: appreciation.length,
        attentionCount: commentsNeedingAttention.length,
        commentPercentages,
        commentCategories,
        rawStudentComments: allComments, // Complete comments, never split
        meta,
        ffiScore: meta?.ffiScore ?? null,
        responseCount: meta?.responseCount ?? null,
        responsePercent: meta?.responsePercent ?? null,
        registeredStudents: meta?.registeredStudents ?? null,
        linkSent: meta?.linkSent ?? null,
        analyzedAt: new Date()
    };
}

async function extractMetaFromPDF(buffer) {
    try {
        return await extractMetaFromBuffer(buffer);
    } catch (error) {
        console.error('[extractMetaFromPDF] Error:', error.message);
        return {
            facultyName: '',
            subjectCode: '',
            programme: '',
            semester: '',
            ffiScore: null,
            responseCount: null,
            responsePercent: null,
            registeredStudents: null,
            linkSent: null
        };
    }
}

module.exports = { analyzePDF, analyzePDFBuffer, extractMetaFromPDF, extractHighlightedText, convertDriveLink };
