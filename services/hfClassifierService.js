// ============================================================
// HuggingFace Inference API — DeBERTa v3 Zero-Shot Classifier
// Model : MoritzLaurer/deberta-v3-base-zeroshot-v1
// Token : set HF_API_TOKEN in your .env / Render env vars
//
// Classification pipeline (in order):
//  1. Neutral filler detection  → skip
//  2. Strong ATTENTION rules    → NEEDS_ATTENTION (high confidence)
//  3. Strong APPRECIATION rules → APPRECIATION (high confidence)
//  4. HF Inference API          → AI classification
//  5. Keyword fallback          → if API down
// ============================================================

const https = require('https');

const HF_MODEL            = 'MoritzLaurer/deberta-v3-base-zeroshot-v1';
const CONFIDENCE_THRESHOLD = 0.75;

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

// ── Neutral fillers ───────────────────────────────────────────────────────────
const NEUTRAL_FILLERS = new Set([
  'ok','okay','fine','good','nice','average','normal','moderate','alright',
  'decent','nil','na','n/a','none','nothing','all good','no issue',
  'no problem','no remarks','no remark','no complaint','everything is fine',
  'satisfactory','everything is good','all is well','all is good',
  'everything good','no changes needed','no complaints','no issues'
]);

// ─────────────────────────────────────────────────────────────────────────────
// ATTENTION RULES — anything matching these = NEEDS_ATTENTION
// Order matters: check these BEFORE appreciation rules
// ─────────────────────────────────────────────────────────────────────────────
const ATTENTION_RULES = [
  // Requests and suggestions (implicit criticism)
  /\b(need|needs?|needed|require[sd]?)\b.{0,40}\b(more|better|proper|clear|improve|example|explanation|practice|time|notes?|material|lab|session|class|interaction|explanation)\b/i,
  /\b(should|must|please|kindly|request|suggest|would be (good|great|better|helpful|nice))\b/i,
  /\b(more (example|explanation|practice|time|interact|detail|class|lab|session|handson|real.?world|problem))\b/i,
  /\b(better (notes?|material|explanation|teaching|slides?|ppt|approach|method|pace))\b/i,
  /\b(can be (better|improve|more|interactive|clear|effective|helpful))\b/i,
  /\b(could be (better|improve|more|clearer|effective))\b/i,

  // Speed / pace
  /\b(too fast|too slow|fast pace|slow pace|speed (is|was|feel)|pace (is|was|feel|too)|rushing|rushed|hurr)\b/i,
  /\b(pacing is|teaching speed|lecture speed)\b/i,

  // Clarity / understanding problems
  /\b(not (clear|understandable|audible|able to (follow|understand|hear|grasp))|can'?t (understand|follow|hear|grasp))\b/i,
  /\b(difficult to (understand|follow|grasp|hear)|hard to (understand|follow|grasp|hear))\b/i,
  /\b(don'?t understand|didn'?t understand|unable to (understand|follow|grasp))\b/i,
  /\b(concepts? (not clear|unclear|confusing|difficult))\b/i,
  /\b(not (getting|getting the|able to get))\b/i,

  // Notes / material problems
  /\b(notes? (not (given|provided|shared|available|uploaded|complete)|missing|incomplete|late|delay|should be|must be|need to be))\b/i,
  /\b(no notes?|notes? not|provide notes?|share notes?|upload notes?)\b/i,
  /\b(ppt (not|should|must|need)|slides? (not|should|must|need))\b/i,
  /\b(material (not|should|must|need|better|improve|early|timely))\b/i,
  /\b(notes? (early|on time|before class|timely|asap))\b/i,

  // Engagement / interaction problems
  /\b(not (interactive|engaging|interesting)|less (interactive|engaging)|boring|monoton|dull)\b/i,
  /\b(not (much|very|too) interact|not engaging|lack(ing)? (interaction|engagement))\b/i,
  /\b(class (should be|could be|more) interact|make (class|lecture) (more|interactive))\b/i,
  /\b(2.?way communication|two.?way)\b/i,

  // Voice / audibility
  /\b(voice (low|small|not (audible|clear|loud)|inaudible)|not (audible|loud enough))\b/i,
  /\b(speak (louder|clearly|more clearly)|be (louder|more clear|more audible))\b/i,
  /\b(loud(er)?|audib|mic(rophone)?|volume)\b/i,

  // Teaching method problems
  /\b(just (read|reads?|reading) (from |the )?(ppt|slides?|pdf|notes?|book))\b/i,
  /\b(only (read|reads?|reading)|reading out (loud|from|the))\b/i,
  /\b(copy.?paste|students? (just |only )?copy)\b/i,
  /\b(surface level|not (in.?depth|detail|deep)|lack(s|ing)? depth)\b/i,
  /\b(teach (basics?|from scratch|from beginning|fundamentals?) first)\b/i,
  /\b(direct(ly)? jump|jumping (into|to) (code|advance|topic))\b/i,
  /\b(not (cover|covered|completing|completed)|syllabus (not|incomplete|behind))\b/i,
  /\b(out of syllabus|beyond syllabus|outside syllabus)\b/i,

  // Assessment / quiz problems
  /\b(quiz (out of|beyond|not from)|marks? (not justified|unfair|wrong|issue))\b/i,
  /\b(unfair|biased|marks? distribut|assessment (issue|problem|unfair))\b/i,
  /\b(cheating|students? cheat)\b/i,

  // Fear / approachability
  /\b(fear|afraid|scared|hesitat|intimidat).{0,30}\b(class|doubt|ask|question|sir|mam|teacher)\b/i,
  /\b(not (approachable|friendly)|rude|strict (but|and)|too strict)\b/i,
  /\b(cannot ask|can'?t ask|scared to ask|afraid to ask)\b/i,

  // Change requests
  /\b(change (the |our |this )?(faculty|teacher|teaching|method|approach|style))\b/i,
  /\b(replace (the |our )?(faculty|teacher))\b/i,
  /\b(assign (another|different|better) (teacher|faculty))\b/i,

  // Lab specific
  /\b(lab (should|must|need|more|better|not|less|issue))\b/i,
  /\b(more (lab|practical|hands.?on|coding practice))\b/i,
  /\b(less practical|lab (not useful|waste|useless))\b/i,

  // Generic improvement requests
  /\b(improve(ment)?|improvement needed|needs? (to )?improve|could (be |do |teach )?better)\b/i,
  /\b(not (good|great|effective|helpful|satisf)|below (average|expectation))\b/i,
  /\b(issue|problem|concern|complain|complaint|dissatisf)\b/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// APPRECIATION RULES — only match these if NO attention rule matched
// ─────────────────────────────────────────────────────────────────────────────
const APPRECIATION_RULES = [
  /\b(excellent|outstanding|superb|brilliant|fantastic|fabulous|wonderful|amazing|great|perfect|best|favourite|favorite|splendid|marvellous)\b/i,
  /\b(very good|really good|so good|quite good|pretty good|really great|so helpful)\b/i,
  /\b(love|loved|enjoy|enjoyed|like|liked)\b.{0,30}\b(class|teach|explain|lecture|subject|course|lab|session|style|way)\b/i,
  /\b(clearly|well|nicely|easily|perfectly|thoroughly)\b.{0,30}\b(explain|taught|covered|understood|presented)\b/i,
  /\b(best teacher|great teacher|good teacher|nice teacher|sweet teacher|lovely teacher|best faculty|amazing teacher|excellent teacher|wonderful teacher)\b/i,
  /\b(thank(s| you)|grateful|thankful|appreciate[sd]?)\b/i,
  /\b(5 star|5\/5|10\/10|100 ?%|full marks?|top (marks?|rating))\b/i,
  /\b(all concepts? (are )?(clear|crystal clear|well understood|nicely explained))\b/i,
  /\b(inspiration|role model|my (favourite|favorite|best) (teacher|faculty|prof))\b/i,
  /\b(no (complaint|remark|issue|problem|change needed))\b/i,
  /\b(everything (is )?(perfect|fine|great|good|excellent|wonderful))\b/i,
  /\b(very (helpful|supportive|friendly|approachable|patient|dedicated|sincere|kind))\b/i,
  /\b(highly (recommend|satisfied|impressed|effective))\b/i,
];

// ── HTTP call to HF Inference API ────────────────────────────────────────────
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

    const req = https.request({
      hostname : 'api-inference.huggingface.co',
      path     : `/models/${HF_MODEL}`,
      method   : 'POST',
      headers  : {
        'Content-Type'   : 'application/json',
        'Content-Length' : Buffer.byteLength(body),
        'Authorization'  : `Bearer ${TOKEN}`
      }
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
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

// ── Pre-rule check ────────────────────────────────────────────────────────────
function preRule(text) {
  // ATTENTION first — complaints take priority
  for (const rx of ATTENTION_RULES)    if (rx.test(text)) return 'attention';
  for (const rx of APPRECIATION_RULES) if (rx.test(text)) return 'appreciation';
  return null;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
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
      appreciation  : 0, attention     : 0,
      neutral       : 0, skipped       : 0,
      aiClassified  : 0, ruleClassified: 0
    }
  };

  // Clean + deduplicate
  const seen  = new Set();
  const valid = [];

  for (const raw of rawComments) {
    if (!raw || typeof raw !== 'string') { result.statistics.skipped++; continue; }
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text || text.length < 3)        { result.statistics.skipped++; continue; }
    if (seen.has(text.toLowerCase()))    continue;
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

  let apiWorking    = true;
  const attnList    = [];

  for (const text of valid) {

    // ── STEP 1: Pre-rule (covers ~80% of comments correctly) ─────────────────
    const rule = preRule(text);

    if (rule === 'attention') {
      pushUnique(result.commentsNeedingAttention, text);
      result.statistics.attention++;
      result.statistics.ruleClassified++;
      const e = {
        text, classification: 'attention', needsAttention: true,
        confidence: 0.97, topLabel: 'NEEDS_ATTENTION', category: 'General', reason: 'rule'
      };
      result.classifiedComments.push(e);
      attnList.push(e);
      continue;
    }

    if (rule === 'appreciation') {
      pushUnique(result.appreciation, text);
      result.statistics.appreciation++;
      result.statistics.ruleClassified++;
      result.classifiedComments.push({
        text, classification: 'appreciation', needsAttention: false,
        confidence: 0.97, topLabel: 'APPRECIATION', reason: 'rule'
      });
      continue;
    }

    // ── STEP 2: HF API for ambiguous comments ────────────────────────────────
    if (apiWorking) {
      try {
        const pred      = await callHF(text, SENTIMENT_LABELS, SENTIMENT_TEMPLATE);
        let isApprec    = pred.labels[0] === 'appreciation';
        let confidence  = parseFloat(pred.scores[0].toFixed(4));

        // Low-confidence second pass
        if (confidence < CONFIDENCE_THRESHOLD) {
          try {
            const p2 = await callHF(
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
            text, classification: 'appreciation', needsAttention: false,
            confidence, topLabel: 'APPRECIATION'
          });
        } else {
          pushUnique(result.commentsNeedingAttention, text);
          result.statistics.attention++;
          const e = {
            text, classification: 'attention', needsAttention: true,
            confidence, topLabel: 'NEEDS_ATTENTION', category: 'General'
          };
          result.classifiedComments.push(e);
          attnList.push(e);
        }
        await sleep(300);

      } catch (err) {
        console.warn('[HF API] Switching to fallback:', err.message);
        apiWorking = false;
        strictKeywordClassify(text, result, attnList);
      }
    } else {
      strictKeywordClassify(text, result, attnList);
    }
  }

  // ── Categorize attention comments ─────────────────────────────────────────
  for (const entry of attnList) {
    if (apiWorking) {
      try {
        const cat = await callHF(entry.text, CATEGORY_LABELS, 'This feedback is about {}.');
        entry.category = CATEGORY_MAP[cat.labels[0]] || 'General';
        pushUnique(result.commentCategories[entry.category], entry.text);
        await sleep(300);
        continue;
      } catch { /* fall through */ }
    }
    entry.category = keywordCategory(entry.text);
    pushUnique(result.commentCategories[entry.category], entry.text);
  }

  console.log(
    `[HF Classifier] apprec=${result.statistics.appreciation}` +
    ` attn=${result.statistics.attention}` +
    ` neutral=${result.statistics.neutral}` +
    ` rule=${result.statistics.ruleClassified}` +
    ` ai=${result.statistics.aiClassified}`
  );
  return result;
}

// ── Strict keyword fallback — when HF API is unavailable ─────────────────────
// Default to ATTENTION unless clearly positive
function strictKeywordClassify(text, result, attnList) {
  // Only mark as appreciation if clearly positive with no criticism signals
  const clearlyPositive = APPRECIATION_RULES.some(rx => rx.test(text));
  const hasCriticism    = ATTENTION_RULES.some(rx => rx.test(text));

  // If BOTH match (mixed comment) → attention wins
  if (!hasCriticism && clearlyPositive) {
    pushUnique(result.appreciation, text);
    result.statistics.appreciation++;
    result.classifiedComments.push({
      text, classification: 'appreciation', needsAttention: false,
      confidence: 0.7, topLabel: 'APPRECIATION', reason: 'keyword-fallback'
    });
  } else {
    // Default: treat as attention (safer — better to review than miss)
    pushUnique(result.commentsNeedingAttention, text);
    result.statistics.attention++;
    const e = {
      text, classification: 'attention', needsAttention: true,
      confidence: 0.7, topLabel: 'NEEDS_ATTENTION',
      category: keywordCategory(text), reason: 'keyword-fallback'
    };
    result.classifiedComments.push(e);
    attnList.push(e);
    pushUnique(result.commentCategories[e.category], text);
  }
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

function keywordCategory(text) {
  if (/\b(speed|fast|slow|rush|pace|pacing)\b/i.test(text))                        return 'Teaching';
  if (/\b(voice|audible|volume|sound|mic|hear|loud|speak|clear(er)?)\b/i.test(text)) return 'Communication';
  if (/\b(doubt|available|respond|reach|help|support|approachable)\b/i.test(text))  return 'Availability';
  if (/\b(note|material|pdf|ppt|slide|book|handout|upload|diagram)\b/i.test(text))  return 'Materials';
  if (/\b(quiz|marks?|test|assessment|grade|exam|cheat)\b/i.test(text))             return 'Assessment';
  if (/\b(lab|practical|coding|hands.?on|implement|program)\b/i.test(text))         return 'Teaching';
  return 'General';
}

module.exports = { classifyCommentsWithHF };
