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

/**
 * cleanCommentText — strips PDF extraction artifacts from a comment string.
 *
 * PDFs often embed rating column counts directly into text, e.g.:
 *   "notes are never shared in time0152941..."  →  "notes are never shared in time"
 *   "Sir explains02629294.29 very well"         →  "Sir explains very well"
 *
 * Rules applied (order matters):
 *  1. Remove a leading row-number prefix glued to the first word: "4Performance" → "Performance"
 *  2. Remove trailing decimal rating score: "...3.47" → ""
 *  3. Remove blocks of 3+ consecutive digits that appear mid-text or at end
 *  4. Normalise whitespace
 */
function cleanCommentText(text) {
    if (!text || typeof text !== 'string') return text;
    let t = text.trim();

    // 1. Strip leading row-number glued to capital letter: "4Performance" → "Performance"
    t = t.replace(/^\d{1,2}([A-Z])/, '$1');

    // 2. Remove full decimal blocks (rating scores embedded in text): "02629294.29", "3.47"
    //    But preserve real decimals in normal sentences like "4.5 out of 5" — those are rare
    //    Safe pattern: a digit run of 3+ digits followed by dot+digits = PDF count artifact
    t = t.replace(/\d{3,}\.\d+/g, '');   // long-number.decimal  e.g. "02629294.29"
    t = t.replace(/\b[1-5]\.\d{2}\b/g, ''); // short rating score e.g. "3.47", "4.29"

    // 3. Remove digits glued directly to word characters (PDF column bleed)
    //    "discussed02629" → "discussed",  "fortnightly21222" → "fortnightly"
    //    But keep "2D", "3G", "5G", "2nd", "3rd", "1st"
    t = t.replace(/([a-zA-Z]{2,})\d{2,}/g, '$1');   // word(2+chars) + 2+ digits
    t = t.replace(/\d{2,}([a-zA-Z]{2,})/g, '$1');   // 2+ digits + word(2+chars)

    // 4. Remove long standalone digit runs (4+ digits — counts/codes, not years)
    t = t.replace(/\b\d{4,}\b/g, '');

    // 5. Normalise whitespace
    t = t.replace(/\s{2,}/g, ' ').trim();
    // Remove trailing/leading stray punctuation left by number removal
    t = t.replace(/\s+([.,;])/g, '$1');

    return t;
}

function isValidComment(text) {
    if (!text || typeof text !== 'string') return false;
    const clean = text.trim();

    // Minimum length to be considered a real comment
    if (clean.length < 3) return false;

    // ══════════════════════════════════════════════════════════════════════════
    // PRIORITY 1: REJECT METADATA, HEADERS, SURVEY QUESTIONS & TABLE ARTIFACTS
    // MUST run before positive keyword matching to prevent questions/headers
    // from being falsely accepted as comments!
    // ══════════════════════════════════════════════════════════════════════════

    // ── Reject PDF rating-table rows ──────────────────────────────────────────
    // Pattern: starts with a row number immediately glued to a capital letter
    // e.g. "4Performance in...", "9Whether MMTLP...", "10Additional classes..."
    if (/^\d{1,2}[A-Z]/.test(clean)) return false;

    // Pattern: word text immediately followed by 3+ digits (no space) — embedded counts
    // e.g. "discussed02629294.29", "fortnightly2122219153.47"
    if (/[a-zA-Z]{3,}\d{3,}/.test(clean)) return false;

    // Pattern: 4+ standalone numbers in sequence — rating column counts
    if (/(\b\d+\b\s*){4,}/.test(clean)) return false;

    // Pattern: ends with a decimal rating score like "3.47", "4.29", "4.18"
    if (/\b[1-5]\.\d{2}\s*$/.test(clean)) return false;

    // Reject page numbers like "1 / 3", "2/3", "about:blank 1 / 2"
    if (/^\d+\s*\/\s*\d+$/.test(clean)) return false;
    if (/about:blank/i.test(clean)) return false;

    // Reject dates (e.g. "04/07/2026 17:03:01 PM")
    if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(clean) && clean.length < 40) return false;

    // Reject URLs
    if (/http|www\./i.test(clean)) return false;

    // Reject Total row or FFI suggestions row
    if (/^(?:\d+\s+)?total(?:\s*[:\-]?\s*[\d.]*)?$/i.test(clean)) return false;
    if (/^ffi\s*&\s*suggestions?\s*(?:are\s*noted.*)?/i.test(clean)) return false;
    if (/noted\s+for\s+further\s+improvement/i.test(clean)) return false;

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

    // Reject rating scale table header rows (e.g., "1-Below Average 3-Good 4-Very Good 5-Excellent QV")
    if (/label\s+question/i.test(clean)) return false;
    if (/\b(?:1\s*-?\s*)?below\s+average\b.*\b(?:average|good|excellent)\b/i.test(clean)) return false;
    if (/\bqv\b/i.test(clean) && /\b(?:good|average|excellent|question)\b/i.test(clean)) return false;

    // Reject table header keywords and metadata
    const tableKeywords = [
        'faculty name', 'course code', 'course name', 'semester', 'registered students',
        'link send', 'response %', 'submitted answers', 'label question', 'submitted answer',
        'signature', 'hod', 'pro - vc', 'pro-vc', 'ffi & suggestion', 'student feedback comments',
        'course outcomes', 'qv 1', 'qv 2',
        'question', 'answer', 'response count', 'total responses', 'feedback form',
        'submit', 'label', 'requirement', 'operating system', 'real world', 'purchased', 'total'
    ];
    const lower = clean.toLowerCase();
    if (tableKeywords.some(kw => lower === kw || lower.startsWith(kw + ':') || lower.startsWith(kw + ' :'))) return false;

    // ── Reject survey question patterns (MITS feedback standard questions 1-13) ──
    const surveyQuestionPatterns = [
        // 1. Weekly quiz & fortnightly assignments
        /weekly\s+quiz\s+and\s+fortnightly\s+assignments/i,
        /assignments?\s+motivate\s+you\s+to\s+revise/i,
        // 2. Positive, supportive, helpful attitude, ethical behaviour, gender bias
        /demonstrates?\s+a\s+consistently\s+positive/i,
        /supportive,?\s+and\s+helpful\s+attitude/i,
        /maintaining\s+ethical\s+behaviou?r/i,
        /gender\s+bias/i,
        // 3. Classes engaged with good preparation
        /classes\s+are\s+engaged\s+with\s+good\s+preparation/i,
        /engaged\s+with\s+good\s+preparation/i,
        // 4. Performance in Assignments/Quiz/Minor exams discussed in class
        /performance\s+in\s+assignments?\/quiz\/minor/i,
        /performance\s+in\s+(?:delivery|teaching|conduct|assignments)/i,
        /discussed\s+in\s+class/i,
        // 5. Evaluation/assessment fair and justified
        /evaluation\/assessment\s*\(minor/i,
        /fair\s+and\s+justified/i,
        // 6. Rate communication skills of the faculty
        /rate\s+the\s+communication\s+skills/i,
        /communication\s+skills\s+of\s+the\s+faculty/i,
        // 7. Whether MMTLP modes were used
        /whether\s+mmtlp\s+modes\s+were\s+used/i,
        /mmtlp\s+modes/i,
        /^whether\s+(?:mmtlp|faculty|teacher|material|notes)/i,
        // 8. PPTs/Notes shared in a timely manner
        /ppts?\/notes\s+are\s+shared/i,
        /shared\s+in\s+a\s+timely\s+manner/i,
        // 9. Coverage of syllabus/course content is good
        /coverage\s+of\s+syllabus\/course\s+content/i,
        /coverage\s+of\s+syllabus/i,
        /course\s+covered\s+so\s+far/i,
        // 10. Classes are useful and help in identifying strengths and correcting weaknesses
        /classes\s+are\s+useful\s+and\s+help\s+in\s+identifying\s+strengths/i,
        /identifying\s+strengths\s+and\s+(?:correcting|connecting)\s+weaknesses/i,
        // Other general survey question headers
        /^additional\s+classes?\s+(conducted|arranged|held)/i,
        /^(teaching|learning|availability)\s+(methodology|manner|performance|of\s+faculty)/i,
        /^relevance\s+of\s+(course|content|material)/i,
        /^teacher'?s?\s+participation\s+in/i,
        /^completion\s+of\s+syllabus/i,
        /^fortnightly\s+(upload|submission)/i,
        /^overall\s+rating\s+of\s+the\s+course/i,
        /^expected\s+course\s+outcomes/i,
        /program.*outcomes.*discussed/i,
        /remedial\s+purpose/i,
        /cleared\s+by\s+giving\s+examples/i
    ];
    if (surveyQuestionPatterns.some(p => p.test(clean))) {
        console.log('[PDF] ✗ Rejected survey question: ' + clean.substring(0, 60));
        return false;
    }

    // ── Reject survey questions prefixed with numbers (e.g., "1. The weekly quiz...", "2 Demonstrates...") ──
    if (/^\d{1,2}[\.\s\-]+(?:the\s+weekly\s+quiz|demonstrates?|the\s+classes|performance|evaluation|rate|whether|the\s+ppts?|coverage|classes\s+are|total)/i.test(clean)) {
        return false;
    }

    // ── Reject standalone rating scale options (ONLY exact matches) ─────
    const ratingOptionsExact = [
        'excellent', 'very good', 'good', 'average', 'below average', 'poor',
        'strongly agree', 'agree', 'neutral', 'disagree', 'strongly disagree',
        'always', 'often', 'sometimes', 'rarely', 'never',
        'needs attention', 'appreciation' // Section headers
    ];
    const cleanLower = clean.toLowerCase().replace(/[.,!?;:]+$/, '').trim();
    if (ratingOptionsExact.includes(cleanLower)) return false;

    // ── Reject rating percentages (e.g. "Excellent: 45%") ───────────────
    if (/^(excellent|very good|good|average|below average|poor):\s*\d+%$/i.test(clean)) return false;

    // Reject if it looks like a course/subject name followed by an answer
    if (/^[A-Z][A-Za-z\s&]+\s+(?:\d+|yes|no|n\.?a\.?|purchased|required)$/i.test(clean)) return false;

    // ══════════════════════════════════════════════════════════════════════════
    // PRIORITY 2: ACCEPT REAL FEEDBACK
    // If text passed rejection checks and contains feedback words, accept it!
    // ══════════════════════════════════════════════════════════════════════════
    const feedbackIndicators = /\b(sir|ma'?am|teacher|faculty|professor|teaching|class|lecture|explains?|teaches?|helpful|good|nice|best|worst|better|improve|slow|fast|clear|unclear|difficult|easy|understands?|doubts?|notes?|material|lab|practical|exam|quiz|test|assignments?|pace|speed|time|voice|audible|interactive|boring|interesting|patient|rude|polite|friendly|strict|lenient|knowledge|experience|method|style|way|approach|behavior|attitude|support|guide|help|available|absent|late|punctual|regular|irregular|excellent|decent|supporting|outstanding|amazing|great|cool|nil|nothing|blank|na|notice|noticeably|observed)\b/i;

    const hasFeedbackWords = feedbackIndicators.test(clean);

    if (hasFeedbackWords && clean.length >= 3) {
        console.log('[PDF] ✓ ACCEPTED (has feedback indicators): ' + clean.substring(0, 60));
        return true;
    }
    
    // Reject if it looks like a course/subject name followed by an answer
    // e.g. "Software Engineering 45" or "Data Structures Yes" or "operating system purchased"
    if (/^[A-Z][A-Za-z\s&]+\s+(?:\d+|yes|no|n\.?a\.?|purchased|required)$/i.test(clean)) return false;
    
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

    // RELAXED: Allow single positive/negative words if in feedback context
    // Don't reject short genuine feedback like "best", "worst", "poor teacher"
    
    return true;
}

// ─────────────────────────────────────────────────────────────────
// HELPER: Find "Student Feedback Comments" section boundaries
// ─────────────────────────────────────────────────────────────────
function findCommentSectionBounds(textContent) {
    const items = textContent.items;
    let sectionStartY = null;
    let sectionEndY = null;
    
    console.log('[PDF] Searching for feedback section...');
    
    // Find first feedback-like text (look for common feedback words)
    let firstFeedbackY = null;
    
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const text = (item.str || '').toLowerCase().trim();
        const y = item.transform[5];
        
        // Look for explicit section header "Student Feedback Comments"
        if (!sectionStartY) {
            if ((text.includes('student') && text.includes('feedback') && text.includes('comment')) ||
                text === 'student feedback comments' ||
                text.includes('student comments')) {
                // PDF Y-axis is bottom-up: comments BELOW header have LOWER Y values
                // Header at Y=93, first comment at Y=63
                // Filter is: y < sectionStartY
                // So sectionStartY should be LESS than header Y to exclude header itself
                // But GREATER than comment Y values to include them
                // Solution: sectionStartY = header Y - 5 (just below header line)
                sectionStartY = y - 5;
                console.log(`[PDF] ✓ Found explicit section header "${item.str}" at Y=${y}, starting extraction at Y=${sectionStartY}`);
            }
        }
        
        // Disallow rating table headers from being treated as feedback (e.g. "1-Below Average", "Label Question")
        const isSurveyTableArtifact = /label\s+question|below\s+average|qv|total|ffi\s*&/i.test(text);
        if (!firstFeedbackY && text.length >= 3 && !isSurveyTableArtifact) {
            const feedbackWords = /\b(good|excellent|nice|best|worst|poor|teacher|mam|sir|teaching|helpful|explains|slow|fast|clear|boring|interesting|supporting|decent|notice|cool|great)\b/i;
            if (feedbackWords.test(text)) {
                firstFeedbackY = y;
            }
        }
        
        // Look for section end markers (signature, next section header)
        // CRITICAL: End markers must only apply BELOW the sectionStartY (y < sectionStartY)
        if (sectionStartY && !sectionEndY && y < sectionStartY) {
            if (text.includes('signature') || 
                text.includes('faculty signature') ||
                text.includes('hod signature') ||
                text.includes('pro-vc') ||
                text.includes('pro - vc') ||
                text.includes('action taken by')) {
                sectionEndY = y + 15; // End 15px above footer
                console.log(`[PDF] ✓ Found section end at Y=${y}, stopping extraction at Y=${sectionEndY}`);
            }
        }
    }
    
    // If no explicit header found, use first feedback location
    if (!sectionStartY && firstFeedbackY) {
        sectionStartY = firstFeedbackY + 20; // Start slightly above first feedback
        console.log(`[PDF] ✓ No explicit header, using first feedback at Y=${firstFeedbackY}, starting extraction at Y=${sectionStartY}`);
    }
    
    // If we found start but not end, use page bottom
    if (sectionStartY && !sectionEndY) {
        sectionEndY = 30; // Typical footer area
        console.log(`[PDF] ✓ Using page bottom as section end (Y=${sectionEndY})`);
    }
    
    return { sectionStartY, sectionEndY };
}

// ─────────────────────────────────────────────────────────────────
// EXTRACT ALL STUDENT COMMENTS FROM PDF TEXT - SECTION-BASED
// ONLY extracts text from "Student Feedback Comments" section
// ─────────────────────────────────────────────────────────────────
async function extractAllStudentComments(buffer, targetCourseCode) {
    const uint8 = new Uint8Array(buffer);
    const doc = await pdfjsLib.getDocument({ data: uint8, verbosity: 0 }).promise;
    let comments = [];
    const rawCommentPages = [];

    // Pass 1: Identify pages that have "Student Feedback Comments" section
    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        const fullText = tc.items.map(i => i.str).join(' ').toLowerCase();

        // Check for comment section indicators:
        // Page 1 & 2 are the Action Taken Report summary table
        // Notice that summary pages have '• no suggestion' or bulleted percentages '• good:' or faculty summary signatures 'hod pro - vc'
        const isActionTakenReport = 
            fullText.includes('action taken report') || 
            (fullText.includes('needs attention') && fullText.includes('appreciation')) ||
            (fullText.includes('s.no') && fullText.includes('code/batch')) ||
            (fullText.includes('• no suggestion') || fullText.includes('• good:') || fullText.includes('• excellent:')) ||
            (fullText.includes('batch-a') && fullText.includes('hod') && fullText.includes('pro - vc') && !fullText.includes('student feedback comments'));
        
        const hasExplicitCommentsHeader = 
            (fullText.includes('student') && fullText.includes('feedback') && fullText.includes('comment')) ||
            fullText.includes('student feedback comments');

        const hasSubmittedAnswersHeader = fullText.includes('submitted answers');

        const hasCommonFeedbackWords = 
            (fullText.match(/\b(good|excellent|nice|best|teacher|mam|sir|teaching|helpful)\b/gi) || []).length >= 3;

        // Only include page if it has feedback header or content, and is NOT the Action Taken Report summary page
        if (!isActionTakenReport && (hasExplicitCommentsHeader || hasSubmittedAnswersHeader || hasCommonFeedbackWords)) {
            console.log(`[PDF] ✓ Page ${p} has feedback content`);
            rawCommentPages.push({ pageNum: p, page, tc, fullText });
        }
    }
    
    if (rawCommentPages.length === 0) {
        console.warn('[PDF] ⚠ No pages found with feedback content!');
        return [];
    }

    const extractRowsFromPages = (pages, filterCode) => {
        const res = [];
        for (const { pageNum, tc, fullText } of pages) {
            console.log(`[PDF] Processing page ${pageNum}...`);
            
            if (filterCode) {
                const cleanTarget = filterCode.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                const pageCodeMatch = fullText.match(/\d{5,}\s*-?\s*batch\s*-?\s*[a-z0-9]+/i);
                if (pageCodeMatch) {
                    const pageCode = pageCodeMatch[0].replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                    if (pageCode !== cleanTarget) {
                        console.log(`[PDF] Skipping page ${pageNum} - different course code`);
                        continue;
                    }
                }
            }

            const items = tc.items.filter(i => i.str && i.str.trim());

            // ═══ CRITICAL: Find section boundaries ═══
            const { sectionStartY, sectionEndY } = findCommentSectionBounds(tc);
            
            // Safety: If no bounds found at all, process entire page
            const useSectionFilter = sectionStartY !== null && sectionEndY !== null;
            
            if (!useSectionFilter) {
                console.warn(`[PDF] ⚠ No section bounds detected on page ${pageNum}, processing entire page`);
            }

            // Group text items by row Y (tolerance 3pt)
            const rowMap = {};
            items.forEach(i => {
                const yKey = Math.round(i.transform[5] / 3) * 3;
                if (!rowMap[yKey]) rowMap[yKey] = [];
                rowMap[yKey].push(i);
            });

            const yKeys = Object.keys(rowMap).map(Number).sort((a, b) => b - a);

            // ═══ CRITICAL: Filter rows ONLY within section bounds (if bounds exist) ═══
            // PDF Y-axis is bottom-up, so sectionStartY > Y > sectionEndY
            const commentRows = yKeys
                .filter(y => {
                    // If no section filter, accept all rows
                    if (!useSectionFilter) return true;
                    
                    const inBounds = y < sectionStartY && y > sectionEndY;
                    if (!inBounds) {
                        // Debug: show what's being filtered out
                        const line = rowMap[y].map(i => i.str).join(' ').substring(0, 60);
                        console.log(`[PDF] ✗ Filtered (Y=${y}): ${line}...`);
                    }
                    return inBounds;
                })
                .map(y => {
                // Sort items left-to-right by X position
                const rowItems = rowMap[y].sort((a, b) => a.transform[4] - b.transform[4]);

                // --- KEY FIX ---
                // PDF rating tables have the question text in the first column and
                // rating counts (numbers) in subsequent columns on the SAME Y row.
                // We keep only text items — items whose trimmed value contains at least
                // one letter. Pure-number cells (counts, scores) are dropped.
                const textOnlyItems = rowItems.filter(item => {
                    const s = item.str.trim();
                    // Keep if it has any letter character
                    return /[a-zA-Z]/.test(s);
                });

                // If filtering removed everything fall back to all items (genuine comment row)
                const chosenItems = textOnlyItems.length > 0 ? textOnlyItems : rowItems;
                const text = chosenItems.map(i => i.str).join(' ').trim();
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

                // Clean embedded table numbers, then validate
                curr = cleanCommentText(curr);
                if (isValidComment(curr)) {
                    console.log(`[PDF] ✓ Valid comment: "${curr.substring(0, 80)}${curr.length > 80 ? '...' : ''}"`);
                    res.push(curr);
                } else {
                    console.log(`[PDF] ✗ Rejected: "${curr.substring(0, 60)}..."`);
                }
                i++;
            }
        }
        return res;
    };

    // Pass 2: Extract rows from identified pages (ONLY from Student Feedback Comments section)
    if (rawCommentPages.length > 0) {
        comments = extractRowsFromPages(rawCommentPages, targetCourseCode);
        if (comments.length === 0 && targetCourseCode) {
            console.log('[PDF] Retrying without course code filter...');
            comments = extractRowsFromPages(rawCommentPages, null);
        }
    }
    
    console.log(`[PDF] ✓ Extracted ${comments.length} comments from dedicated section`);

    // Pass 3: Action Taken Report - DISABLED
    // This extracts from summary tables on first pages, which you want to avoid
    /*
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
                    const cleaned = cleanCommentText(b.trim().replace(/\s+/g, ' '));
                    if (!/^(good|very good|excellent|below average):\s*\d+%/i.test(cleaned) && isValidComment(cleaned)) {
                        comments.push(cleaned);
                    }
                });
            }
        }
    }
    */

    // Pass 4: Fallback scan disabled - was too aggressive and extracted form text
    // This pass would extract ANY text with feedback keywords, including:
    // - Survey question text ("Performance in delivery...")
    // - Rating scale options ("Excellent", "Good", "Average")
    // - Form labels and table headers
    // If Pass 1-3 don't find comments, the PDF likely has no student comments section
    /*
    if (comments.length === 0) {
        console.log('[PDF] Warning: No comments found in dedicated sections. Fallback disabled to prevent form text extraction.');
        for (let p = 1; p <= doc.numPages; p++) {
            const page = await doc.getPage(p);
            const tc = await page.getTextContent();
            const items = tc.items.filter(i => i.str && i.str.trim());
            for (const item of items) {
                const str = cleanCommentText(item.str.trim().replace(/\s+/g, ' '));
                if (str.length >= 8 && isValidComment(str)) {
                    // Look for feedback keywords
                    if (/good|nice|excellent|poor|best|worst|speed|voice|doubt|explain|notes|exam|quiz|teach|clear|improve|slow|fast|audible|helpful|teaching|class|lecture|understand/i.test(str)) {
                        comments.push(str);
                    }
                }
            }
        }
    }
    */

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
                    !text.match(/^(semester|sem|ffi|resp|programme|code|faculty|name|students|link|send|response|course|registered|submitted|answer|\d+)$/i)) {
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
                const m = fullText.match(/(?:faculty\s*name|name\s*of\s*faculty)\s*[:\-]?\s*([A-Za-z\s.]{2,50})/i);
                if (m && m[1].trim().length > 2) facultyName = m[1].trim();
            }

            if (!subjectCode) {
                const m = fullText.match(/(?:course\s*code|code\s*\/\s*batch|code)\s*[:\-]?\s*(\d{5,}(?:\s*-\s*Batch\s*-\s*[A-Z0-9]+|\s*-\s*[A-Za-z0-9]+)?)/i);
                if (m) subjectCode = m[1].replace(/\s+/g, '-').replace(/-+/g, '-');
            }

            if (!programme) {
                const patterns = [
                    /(?:course\s*name|programme|branch)\s*[:\-]?\s*([A-Za-z0-9&,./\-\(\)\s]{3,60})/i,
                    /programme\s*[:\-]?\s*([A-Za-z0-9&,./\-\(\)\s]{3,60})/i
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
 * Extract rating statistics from survey table (Good, Very Good, Excellent counts)
 * Looks for "Total" row in rating tables and extracts column counts
 */
async function extractRatingStatistics(buffer) {
    const uint8 = new Uint8Array(buffer);
    const doc = await pdfjsLib.getDocument({ data: uint8, verbosity: 0 }).promise;
    
    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        const items = tc.items.filter(i => i.str && i.str.trim());
        
        // Find "Total" row (last row of rating table)
        const totalItems = [];
        let totalY = null;
        
        for (const item of items) {
            const text = (item.str || '').trim().toLowerCase();
            if (text === 'total' || text === '15') { // Row 15 is usually Total
                totalY = item.transform[5];
                break;
            }
        }
        
        if (totalY) {
            // Collect all numbers on the same Y line (within 5px tolerance)
            const rowNums = items
                .filter(i => Math.abs(i.transform[5] - totalY) < 5)
                .filter(i => /^\d+$/.test(i.str.trim()))
                .map(i => parseInt(i.str.trim(), 10))
                .filter(n => n > 0);
            
            // Expected format: [Below Avg, Average, Good, Very Good, Excellent, QV score]
            // Example: [48, 182, 318, 238, 194, 3.36]
            if (rowNums.length >= 5) {
                const [belowAvg, average, good, veryGood, excellent] = rowNums;
                const total = belowAvg + average + good + veryGood + excellent;
                
                if (total > 0) {
                    console.log(`[PDF] ✓ Found rating statistics: G=${good}, VG=${veryGood}, E=${excellent}, Total=${total}`);
                    return {
                        'Good': Math.round((good / total) * 100),
                        'Very Good': Math.round((veryGood / total) * 100),
                        'Excellent': Math.round((excellent / total) * 100),
                        counts: { good, veryGood, excellent, average, belowAvg, total }
                    };
                }
            }
        }
    }
    
    return null;
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
            'best', 'besttttt', 'bestt', 'mind blowing', 'profoundly',
            'love the way', 'amazing', '5 star', 'perfect',
            'excellent teacher', 'excellent mam', 'excellent sir', 'excellent ma\'am'
        ],
        'Very Good': [
            'very good', 'very well', 'very nice',
            'very helpful', 'very great', 'very clear', 'very practical',
            'very much', 'soo desperate', 'prepared very well', 'dedicated'
        ],
        'Good': [
            'good', 'great', 'nice', 'well done', 'satisfactory',
            'good teacher', 'good mam', 'good sir', 'good ma\'am',
            'overall good', 'nicely', 'fine', 'decent', 'rich content',
            'easy to understand', 'easy to follow', 'simple language', 'clear'
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

            const { classifyCommentsWithHF } = require('./hfClassifierService');
            const fbResult = await classifyCommentsWithHF(allComments, { forceFallback: true });
            appreciation = fbResult.appreciation || [];
            commentsNeedingAttention = fbResult.commentsNeedingAttention || [];
            commentCategories = fbResult.commentCategories || {};
        }
    }

    // STEP 6: Guarantee highlighted comments are in final classification
    // (Priority: Highlighted > AI classification)
    (highlights?.commentsNeedingAttention || []).forEach(c => {
        pushUnique(commentsNeedingAttention, c);
    });

    (highlights?.appreciation || []).forEach(c => {
        if (!commentsNeedingAttention.includes(c)) {
            pushUnique(appreciation, c);
        }
    });

    (highlights?.commentsNeedingAttention || []).forEach(c => {

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

    // Final strict filter: ensure zero attention comments in appreciation
    appreciation = appreciation.filter(c => !commentsNeedingAttention.includes(c));

    // STEP 7: Calculate comment percentages 
    // Try extracting from rating table first, fallback to keyword counting
    let commentPercentages = await extractRatingStatistics(buffer);
    if (!commentPercentages) {
        commentPercentages = calculateCommentPercentages(allComments, meta?.responseCount);
        console.log('[PDF] Using keyword-based percentages:', commentPercentages);
    } else {
        console.log('[PDF] Using rating table percentages:', commentPercentages);
    }

    // STEP 8: Ensure only clean, non-filler comments with >= 5 words in appreciation & need attention lists
    const FILLER_ONLY_RX = /^(ok|okay|fine|na|n\/a|nil|none|nothing|no remark|no remarks|no feedback)$/i;
    const meetsWordCount = c => {
        if (!c || typeof c !== 'string') return false;
        const trimmed = c.trim().replace(/[.,!?;:]+$/, '');
        if (!trimmed || trimmed.length < 3) return false;
        if (FILLER_ONLY_RX.test(trimmed)) return false;
        return trimmed.split(/\s+/).filter(Boolean).length >= 5;
    };

    appreciation = appreciation.filter(meetsWordCount);
    commentsNeedingAttention = commentsNeedingAttention.filter(meetsWordCount);

    console.log(`[PDF] Analysis complete: ${allComments.length} total comments extracted, ${appreciation.length} appreciation and ${commentsNeedingAttention.length} attention comments kept (>= 5 words)`);

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

module.exports = { analyzePDF, analyzePDFBuffer, extractMetaFromPDF, extractHighlightedText, convertDriveLink, extractMetaFromBuffer, extractAllStudentComments };