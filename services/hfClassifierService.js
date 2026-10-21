// ============================================================
// HuggingFace Inference API — DeBERTa v3 Zero-Shot Classifier
// Model : MoritzLaurer/deberta-v3-base-zeroshot-v1
// API   : https://api-inference.huggingface.co
// Token : set HF_API_TOKEN in your .env / Render env vars
// ============================================================

const https = require('https');

const HF_MODEL   = 'MoritzLaurer/deberta-v3-base-zeroshot-v1';
const HF_API_URL = `https://api-inference.huggingface.co/models/${HF_MODEL}`;

// Confidence threshold — below this we do a second-pass re-check
const CONFIDENCE_THRESHOLD = 0.75;

// ── Label config ──────────────────────────────────────────────────────────────
const SENTIMENT_LABELS   = ['appreciation', 'complaint or suggestion'];
const SENTIMENT_TEMPLATE = 'This student feedback about a teacher is a {}.';

const CATEGORY_LABELS = [
  'teaching clarity and explanation style',
  'voice, communication, and classroom engagement',
  'availability for doubts and student support',
  'study materials, notes, and slides',
  'exams, quizzes, and grading fairness'
];
const CATEGORY_MAP = {
  'teaching clarity and explanation style':         'Teaching',
  'voice, communication, and classroom engagement': 'Communication',
  'availability for doubts and student support':    'Availability',
  'study materials, notes, and slides':             'Materials',
  'exams, quizzes, and grading fairness':           'Assessment'
};

// ── Neutral fillers — skip entirely ──────────────────────────────────────────
const NEUTRAL_FILLERS = new Set([
  'ok','okay','fine','good','nice','average','normal','moderate','alright',
  'decent','nil','na','n/a','none','nothing','all good','no issue',
  'no problem','no remarks','no remark','no complaint','everything is fine',
  'satisfactory','everything is good','all is well','all is good',
  'everything good','no changes needed','no complaints'
]);

// ── Domain pre-rules for 100% obvious cases ───────────────────────────────────
const APPRECIATION_PATTERNS = [
  /\b(excellent|outstanding|superb|brilliant|fantastic|fabulous|wonderful|amazing|great|perfect|best|favourite|favorite)\b/i,
  /\b(very good|really good|so good|quite good|pretty good)\b/i,
  /\b(love|loved|loving|enjoy|enjoyed)\b.{0,30}\b(class|teach|explain|lecture|subject|course|lab|session)\b/i,
  /\b(clearly|well|nicely|easily|perfectly)\b.{0,30}\b(explain|taught|covered|understood)\b/i,
  /\b(helpful|supportive|approachable|friendly|kind|dedicated|sincere|hardworking|patient|polite|humble)\b/i,
  /\b(thank|thanks|grateful|appreciate|appreciated)\b/i,
  /\b(best teacher|great teacher|good teacher|nice teacher|sweet teacher|lovely teacher|best faculty)\b/i,
  /\b(5 star|5\/5|10\/10|100%)\b/i,
  /\b(all concepts? (are )?(clear|crystal clear|understood))\b/i,
  /\b(inspiration|role model)\b/i,
];

const ATTENTION_PATTERNS = [
  /\b(too fast|too slow|speed is|pace is|rushes?|rushed)\b/i,
  /\b(not (clear|audible|understandable)|can'?t (hear|follow|understand))\b/i,
  /\b(boring|monoton|dull|not engaging|not interactive)\b/i,
  /\b(notes? not|no notes?|notes? (missing|incomplete|not shared|not provided|late))\b/i,
  /\b(out of syllabus|marks? not justified|unfair|biased)\b/i,
  /\b(change (the )?faculty|change faculty|replace (the )?teacher)\b/i,
  /\b(fear|afraid|scared|hesitat|intimidat).{0,30}\b(class|doubt|ask|question)\b/i,
  /\b(doesn'?t (explain|teach|help|clear)|don'?t (explain|teach|help))\b/i,
  /\b(just reads?|only reads?).{0,20}\b(ppt|slides?|pdf|notes?)\b/i,
  /\b(copy.?paste)\b/i,
  /\b(please (change|improve|explain|share|provide|upload|teach))\b/i,
];

// ── Raw HTTPS call to HF Inference API ───────────────────────────────────────
function hfRequest(text, candidateLabels, template) {
  return new Promise((resolve, reject) => {
    const TOKEN = process.env.HF_API_TOKEN || '';
    const body  = JSON.stringify({
      inputs: text,
      parameters: {
        candidate_labels    : candidateLabels,
        hypothesis_template : template,
        multi_label         : false
      }
    });

    const options = {
      hostname : 'api-inference.huggingface.co',
      path     : `/models/${HF_MODEL}`,
      method   : 'POST',
      headers  : {
        'Content-Type'   : 'application/json',
        'Content-Length' : Buffer.byteLength(body),
        'Authorization'  : `Bearer ${TOKEN}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          // Model still loading — HF returns { error, estimated_time }
          if (parsed.error) {
            if ((parsed.error + '').toLowerCase().includes('load')) {
              return reject(new Error('LOADING:' + (parsed.estimated_time || 20)));
            }
            return reject(new Error(parsed.error));
          }
          resolve(parsed);
        } catch (e) {
          reject(new Error('Bad JSON from HF: ' + data.slice(0, 120)));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(40000, () => { req.destroy(); reject(new Error('HF API timeout')); });
    req.write(body);
    req.end();
  });
}

// ── Retry wrapper (handles model loading warm-up) ────────────────────────────
async function callHF(text, labels, template, retries = 3) {
  for (let i = 1; i <= retries; i++) {
    try {
      return await hfRequest(text, labels, template);
    } catch (err) {
      if (err.message.startsWith('LOADING') && i < retries) {
        const wait = parseInt(err.message.split(':')[1] || '20') * 1000;
        console.log(`[HF API] Model loading, waiting ${wait / 1000}s...`);
        await sleep(wait);
      } else if (i < retries) {
        await sleep(1000);
      } else {
        throw err;
      }
    }
  }
}

// ── Pre-rule check — instant classification for obvious cases ─────────────────
function preRule(text) {
  for (const rx of ATTENTION_PATTERNS)   if (rx.test(text)) return 'attention';
  for (const rx of APPRECIATION_PATTERNS) if (rx.test(text)) return 'appreciation';
  return null;
}

// ── MAIN exported function ────────────────────────────────────────────────────
async function classifyCommentsWithHF(rawComments) {
  if (!Array.isArray(rawComments) || rawComments.length === 0) {
    return emptyResult(0);
  }

  const result = {
    appreciation            : [],
    commentsNeedingAttention: [],
    commentCategories       : {
      Teaching: [], Communication: [], Availability: [],
      Materials: [], Assessment: [], General: []
    },
    classifiedComments: [],
    statistics: {
      totalReceived : rawComments.length,
      appreciation  : 0,
      attention     : 0,
      neutral       : 0,
      skipped       : 0,
      aiClassified  : 0,
      ruleClassified: 0
    }
  };

  // Clean + deduplicate
  const seen = new Set();
  const valid = [];
  for (const raw of rawComments) {
    if (!raw || typeof raw !== 'string') { result.statistics.skipped++; continue; }
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text || text.length < 3)         { result.statistics.skipped++; continue; }
    if (seen.has(text.toLowerCase()))     continue;
    seen.add(text.toLowerCase());

    const lower = text.toLowerCase().replace(/[.,!?;:]+$/, '').trim();
    if (NEUTRAL_FILLERS.has(lower)) {
      result.statistics.neutral++;
      result.classifiedComments.push({
        text, classification: 'neutral',
        needsAttention: false, confidence: 1.0, reason: 'neutral-filler'
      });
      continue;
    }
    valid.push(text);
  }

  if (valid.length === 0) return result;

  let apiWorking      = true;
  const attentionList = [];   // entries needing category classification

  for (const text of valid) {

    // ── 1. Pre-rule (instant, ~100% for obvious comments) ──────────────────
    const rule = preRule(text);
    if (rule === 'appreciation') {
      pushUnique(result.appreciation, text);
      result.statistics.appreciation++;
      result.statistics.ruleClassified++;
      result.classifiedComments.push({
        text, classification: 'appreciation',
        needsAttention: false, confidence: 0.97, topLabel: 'APPRECIATION', reason: 'rule'
      });
      continue;
    }
    if (rule === 'attention') {
      pushUnique(result.commentsNeedingAttention, text);
      result.statistics.attention++;
      result.statistics.ruleClassified++;
      const e = {
        text, classification: 'attention',
        needsAttention: true, confidence: 0.97, topLabel: 'NEEDS_ATTENTION',
        category: 'General', reason: 'rule'
      };
      result.classifiedComments.push(e);
      attentionList.push(e);
      continue;
    }

    // ── 2. HF Inference API (for ambiguous comments) ────────────────────────
    if (apiWorking) {
      try {
        const pred       = await callHF(text, SENTIMENT_LABELS, SENTIMENT_TEMPLATE);
        let topLabel     = pred.labels[0];
        let confidence   = parseFloat(pred.scores[0].toFixed(4));
        let isApprec     = topLabel === 'appreciation';

        // ── 3. Low-confidence → second pass with different framing ──────────
        if (confidence < CONFIDENCE_THRESHOLD) {
          try {
            const p2  = await callHF(
              text,
              ['positive feedback', 'negative feedback or complaint'],
              'This is {}.'
            );
            await sleep(300);
            isApprec   = p2.labels[0] === 'positive feedback';
            confidence = parseFloat(p2.scores[0].toFixed(4));
          } catch { /* keep first pass */ }
        }

        result.statistics.aiClassified++;

        if (isApprec) {
          pushUnique(result.appreciation, text);
          result.statistics.appreciation++;
          result.classifiedComments.push({
            text, classification: 'appreciation',
            needsAttention: false, confidence, topLabel: 'APPRECIATION'
          });
        } else {
          pushUnique(result.commentsNeedingAttention, text);
          result.statistics.attention++;
          const e = {
            text, classification: 'attention',
            needsAttention: true, confidence, topLabel: 'NEEDS_ATTENTION', category: 'General'
          };
          result.classifiedComments.push(e);
          attentionList.push(e);
        }

        await sleep(300); // respect HF rate limit

      } catch (err) {
        console.warn('[HF API] Error — switching to keyword fallback:', err.message);
        apiWorking = false;
        keywordClassify(text, result, attentionList);
      }
    } else {
      keywordClassify(text, result, attentionList);
    }
  }

  // ── 4. Categorize attention comments ─────────────────────────────────────
  for (const entry of attentionList) {
    if (apiWorking) {
      try {
        const cat  = await callHF(entry.text, CATEGORY_LABELS, 'This feedback is about {}.');
        const cat_ = CATEGORY_MAP[cat.labels[0]] || 'General';
        entry.category = cat_;
        pushUnique(result.commentCategories[cat_], entry.text);
        await sleep(300);
        continue;
      } catch { /* fall through */ }
    }
    entry.category = keywordCategory(entry.text);
    pushUnique(result.commentCategories[entry.category], entry.text);
  }

  console.log(
    `[HF Classifier] appreciation=${result.statistics.appreciation}` +
    ` attention=${result.statistics.attention}` +
    ` neutral=${result.statistics.neutral}` +
    ` rule=${result.statistics.ruleClassified}` +
    ` ai=${result.statistics.aiClassified}`
  );
  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function pushUnique(arr, v) { if (!arr.includes(v)) arr.push(v); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function emptyResult(n) {
  return {
    appreciation: [], commentsNeedingAttention: [],
    commentCategories: { Teaching:[], Communication:[], Availability:[], Materials:[], Assessment:[], General:[] },
    classifiedComments: [],
    statistics: { totalReceived:n, appreciation:0, attention:0, neutral:0, skipped:0, aiClassified:0, ruleClassified:0 }
  };
}

function keywordClassify(text, result, attentionList) {
  const neg = /\b(not|slow|fast|bad|issue|problem|incomplete|unclear|skip|poor|confus|late|improve|voice|doubt|material|quiz|marks|change|boring|fear|rush)\b/i.test(text);
  if (neg) {
    pushUnique(result.commentsNeedingAttention, text);
    result.statistics.attention++;
    const e = {
      text, classification: 'attention', needsAttention: true,
      confidence: 0.6, topLabel: 'NEEDS_ATTENTION',
      category: keywordCategory(text), reason: 'keyword-fallback'
    };
    result.classifiedComments.push(e);
    attentionList.push(e);
    pushUnique(result.commentCategories[e.category], text);
  } else {
    pushUnique(result.appreciation, text);
    result.statistics.appreciation++;
    result.classifiedComments.push({
      text, classification: 'appreciation', needsAttention: false,
      confidence: 0.6, topLabel: 'APPRECIATION', reason: 'keyword-fallback'
    });
  }
}

function keywordCategory(text) {
  if (/\b(speed|fast|slow|rush|pace)\b/i.test(text))                      return 'Teaching';
  if (/\b(voice|audible|volume|sound|mic|hear|loud|speak)\b/i.test(text))  return 'Communication';
  if (/\b(doubt|available|respond|reach|help|support)\b/i.test(text))      return 'Availability';
  if (/\b(note|material|pdf|ppt|slide|book|handout|upload)\b/i.test(text)) return 'Materials';
  if (/\b(quiz|marks?|test|assessment|grade|exam)\b/i.test(text))          return 'Assessment';
  return 'General';
}

module.exports = { classifyCommentsWithHF };
