// ============================================================
// HuggingFace Inference API — DeBERTa v3 Zero-Shot Classifier
// Model: MoritzLaurer/deberta-v3-base-zeroshot-v1
//
// SPEED FIX: All comments sent in ONE batch API call
// ACCURACY FIX: 40+ domain-specific rules before API call
// FALLBACK: Strong keyword rules if API is down
// ============================================================

const https = require('https');

const HF_MODEL = 'MoritzLaurer/deberta-v3-base-zeroshot-v1';

// ── Neutral fillers — skip entirely ──────────────────────────────────────────
const NEUTRAL_FILLERS = new Set([
  'ok','okay','fine','good','nice','average','normal','moderate','alright',
  'decent','nil','na','n/a','none','nothing','all good','no issue',
  'no problem','no remarks','no remark','no complaint','everything is fine',
  'satisfactory','everything is good','all is well','all is good',
  'everything good','no changes needed','no complaints','no issues',
  'everything fine','all fine','all ok','nothing to say','no feedback'
]);

// ─────────────────────────────────────────────────────────────────────────────
// NEEDS_ATTENTION RULES — checked FIRST, highest priority
// If ANY rule matches → NEEDS_ATTENTION, no API call needed
// ─────────────────────────────────────────────────────────────────────────────
const ATTENTION_RULES = [
  // Suggestions / requests (most common source of misclassification)
  /\b(need|needs?|needed|require[sd]?)\s.{0,50}(more|better|proper|clear|improve|example|explanation|practice|time|notes?|material|lab|session|class|interaction)\b/i,
  /\b(more\s)(example|explanation|practice|time|interact|detail|class|lab|session|hands?.?on|real.?world|problem|illustration|discussion)\b/i,
  /\b(better\s)(notes?|material|explanation|teaching|slides?|ppt|approach|method|pace|content|coverage)\b/i,
  /\b(can be|could be|should be|must be)\s.{0,30}(better|improve|more|interactive|clear|effective|helpful|engaging|detailed)\b/i,
  /\b(should|must|please|kindly|request|suggest|would be (good|great|better|helpful|nice|beneficial))\b/i,
  /\b(provide|share|upload|give|send|make available)\s.{0,30}(notes?|material|slides?|ppt|pdf|handout|formula|content|book)\b/i,

  // Speed and pace
  /\b(too fast|too slow|very fast|very slow|fast pace|slow pace|speaks? too|teaching (is |was |feels? )?(too )?(fast|slow))\b/i,
  /\b(speed (is|was|feel|too|of)|pace (is|was|feel|too)|pacing (is|was|feel))\b/i,
  /\b(rushing|rushed|hurr|slow(er)?( down)?|speed( up)?)\b.{0,20}(class|lecture|teaching|topic)\b/i,

  // Notes and materials problems
  /\bnotes?\s.{0,30}(not|never|should|must|need|early|timely|before|missing|incomplete|late|delay|proper|on time)\b/i,
  /\b(no notes?|notes? not (given|provided|shared|available|uploaded|complete))\b/i,
  /\b(ppt|slides?)\s.{0,20}(not|should|must|need|better|improve|share|provide|upload)\b/i,
  /\b(material\s.{0,20}(not|should|must|need|better|improve|early|timely))\b/i,
  /\b(notes?\s.{0,10}(early|on time|before class|timely|asap|start|beginning))\b/i,
  /\b(no (study )?material|material not provided)\b/i,

  // Clarity and understanding issues
  /\b(not (clear|understandable|able to (follow|understand|hear|grasp)))\b/i,
  /\b(can'?t (understand|follow|hear|grasp)|unable to (understand|follow|grasp))\b/i,
  /\b(difficult to (understand|follow|grasp|hear)|hard to (understand|follow|grasp))\b/i,
  /\b(don'?t understand|didn'?t understand|not understanding)\b/i,
  /\b(concept[s]?\s.{0,20}(not clear|unclear|confus|difficult))\b/i,
  /\b(not (getting|able to get)|lost in (class|lecture))\b/i,

  // Voice / audibility
  /\b(voice\s.{0,20}(low|small|not audible|inaudible|not clear|not loud))\b/i,
  /\b(not (audible|loud enough|clearly heard)|can'?t hear)\b/i,
  /\b(speak (louder|clearly|more clearly|up)|be (louder|more audible))\b/i,
  /\b(mic(rophone)?|use (a )?mic|volume (low|issue)|sound (issue|problem))\b/i,
  /\b(more loud|little loud|bit loud|little more loud)\b/i,

  // Engagement / interaction problems
  /\b(not (interactive|engaging|interesting|involved)|less (interactive|engaging|involved))\b/i,
  /\b(boring|monoton|dull|dry (lecture|class|teaching))\b/i,
  /\b(not much interact|lack(ing)? (interaction|engagement|discussion))\b/i,
  /\b(class (should be|could be|needs to be) (more )?interact)\b/i,
  /\b(2.?way communication|two.?way interaction|one.?way (lecture|class))\b/i,

  // Teaching method problems
  /\b(just (read|reads?|reading) (from |the )?(ppt|slides?|pdf|notes?|book|screen))\b/i,
  /\b(only (read|reads?|reading)|reads? (out|off|from|straight))\b/i,
  /\b(copy.?paste|students? (just |only )?copy)\b/i,
  /\b(surface level|not (in.?depth|detailed|thorough)|lacks? depth)\b/i,
  /\b(teach (basics?|fundamentals?|from scratch|from beginning) first)\b/i,
  /\b(direct(ly)? jump(ing)?|jump(ing)? (into|to|straight to) (advance|code|topic|complex))\b/i,
  /\b(syllabus (not|incomplete|not complet|behind|rush|force)|not complet(ed|ing) syllabus)\b/i,
  /\b(out of syllabus|beyond syllabus|outside syllabus|not in syllabus)\b/i,

  // Assessment issues
  /\b(quiz (out of|beyond|not from|tough|difficult)|marks? (not justified|unfair|wrong|issue|distribut))\b/i,
  /\b(unfair|biased|partiality|favorit|marks? (issue|wrong|not right))\b/i,
  /\b(students? cheat(ing)?|cheating (happen|going|in class))\b/i,
  /\b(assessment (issue|problem|unfair)|grading (issue|unfair))\b/i,

  // Fear and approachability
  /\b(fear|afraid|scared|hesitat|intimidat).{0,30}(class|doubt|ask|question|approach)\b/i,
  /\b(not (approachable|friendly|helpful|cooperative)|rude|harsh|strict)\b/i,
  /\b(cannot ask|can'?t ask|scared to ask|afraid to ask|fear of asking)\b/i,
  /\b(creates? (fear|panic|pressure)|students? are (scared|afraid|hesitant))\b/i,

  // Change requests
  /\b(change (the |our |this |your )?(faculty|teacher|teaching|method|approach|style|way))\b/i,
  /\b(replace (the |our )?(faculty|teacher)|assign (another|different|new) (teacher|faculty))\b/i,
  /\b(please (change|improve|explain|share|provide|upload|be|teach|use|try|consider))\b/i,
  /\b(request(ing)? (to|you|sir|mam|faculty) (please |kindly )?(change|improve|explain|provide))\b/i,

  // Lab / practical issues
  /\b(lab (should|must|need|more|better|not useful|waste|less|issue|problem|only theory))\b/i,
  /\b(more (lab|practical|hands.?on|coding practice|experiment))\b/i,
  /\b(less (practical|hands.?on)|lab (not enough|insufficient|inadequate))\b/i,
  /\b(not (enough|sufficient) (lab|practical|experiment|coding|practice))\b/i,

  // Improvement requests
  /\b(improve(ment)?( needed| required)?|needs? (to )?improve|needs? (more )?work)\b/i,
  /\b(not (good enough|satisfactory|effective|helpful)|below (average|expectation|standard))\b/i,
  /\b(issue|problem|concern|complain(t)?|dissatisf|not satisfied|unhappy with)\b/i,
  /\b(suggestion[s]?:|feedback:|concern:|problem:|issue:)\b/i,

  // Specific phrases from your CSV data
  /\b(class (not|should) (be more|needs to be) (interactive|engaging))\b/i,
  /\b(not (cover|covered|teach|taught) (properly|well|clearly|completely))\b/i,
  /\b(need (to be|more) explained|explain (more|better|clearly|properly))\b/i,
  /\b(example[s]? (should|must|need|more|better|relevant|real.?world))\b/i,
  /\b(make (the )?(class|lecture|session) (more|better|interesting|interactive))\b/i,
  /\b(notes? (can be|could be|should be) better)\b/i,
  /\b(content (can be|could be|should be|needs to be) (better|clear|improve))\b/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// APPRECIATION RULES — only checked if NO attention rule matched
// ─────────────────────────────────────────────────────────────────────────────
const APPRECIATION_RULES = [
  /\b(excellent|outstanding|superb|brilliant|fantastic|fabulous|wonderful|amazing|great|perfect|best|splendid|exceptional|terrific)\b/i,
  /\b(very good|really good|so good|quite good|pretty good|really great|so helpful|very helpful|very clear|very nice|very well)\b/i,
  /\b(love|loved|enjoy|enjoyed|like[sd]?)\b.{0,30}\b(class|teach|explain|lecture|subject|course|lab|session|style|way|approach)\b/i,
  /\b(clearly|well|nicely|easily|perfectly|thoroughly|beautifully)\b.{0,30}\b(explain|taught|covered|understood|presented|communicated)\b/i,
  /\b(best (teacher|faculty|professor|sir|mam|ma'?am|instructor))\b/i,
  /\b(great (teacher|faculty|professor|sir|mam|ma'?am|instructor))\b/i,
  /\b(amazing (teacher|faculty|professor|sir|mam|ma'?am|instructor))\b/i,
  /\b(thank(s| you)|grateful|thankful|appreciate[sd]?)\b/i,
  /\b(5 star|5\/5|10\/10|100 ?%|full marks?|top (marks?|rating))\b/i,
  /\b(all concepts? (are )?(clear|crystal clear|well understood|nicely explained|very clear))\b/i,
  /\b(inspiration|role model|favourite (teacher|faculty)|my (best|favourite) (teacher|faculty))\b/i,
  /\b(no (complaint|remark|issue|problem|change needed|suggestion))\b/i,
  /\b(highly (recommend|satisfied|impressed|effective|knowledgeable))\b/i,
  /\b(good (command|knowledge|understanding|grip|hold) (over|of|on) (subject|topic|concept))\b/i,
  /\b(teaches? (very well|nicely|clearly|effectively|brilliantly|perfectly))\b/i,
  /\b(explains? (very well|nicely|clearly|effectively|brilliantly|everything|perfectly))\b/i,
  /\b(very (helpful|supportive|friendly|approachable|patient|dedicated|sincere|kind|polite|humble|cooperative))\b/i,
];

// ── Single HF API call for ONE comment ───────────────────────────────────────
function hfApiCall(text, candidateLabels, template) {
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
            return reject(new Error('HF_ERROR:' + parsed.error));
          }
          resolve(parsed);
        } catch (e) {
          reject(new Error('BAD_JSON'));
        }
      });
    });

    req.on('error', (e) => reject(new Error('NET:' + e.message)));
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.write(body);
    req.end();
  });
}

// ── Call with retry ───────────────────────────────────────────────────────────
async function callHF(text, labels, template) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await hfApiCall(text, labels, template);
    } catch (err) {
      if (err.message.startsWith('LOADING') && attempt < 3) {
        const secs = parseInt(err.message.split(':')[1] || '20');
        await sleep(secs * 1000);
      } else if (attempt < 3 && !err.message.startsWith('NET') && !err.message.startsWith('TIMEOUT')) {
        await sleep(1000);
      } else {
        throw err;
      }
    }
  }
}

// ── Apply pre-rules (no API needed) ──────────────────────────────────────────
function applyPreRule(text) {
  // ATTENTION always checked first
  for (const rx of ATTENTION_RULES)    if (rx.test(text)) return 'attention';
  for (const rx of APPRECIATION_RULES) if (rx.test(text)) return 'appreciation';
  return null; // ambiguous → needs API
}

// ── MAIN FUNCTION ─────────────────────────────────────────────────────────────
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

  // ── Clean + deduplicate ───────────────────────────────────────────────────
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
      result.classifiedComments.push({ text, classification: 'neutral', needsAttention: false, confidence: 1.0 });
      continue;
    }
    valid.push(text);
  }

  if (valid.length === 0) return result;

  // ── STEP 1: Apply pre-rules to all comments ───────────────────────────────
  const ambiguous = []; // comments that rules couldn't classify

  for (const text of valid) {
    const rule = applyPreRule(text);
    if (rule === 'attention') {
      pushUnique(result.commentsNeedingAttention, text);
      result.statistics.attention++;
      result.statistics.ruleClassified++;
      result.classifiedComments.push({
        text, classification: 'attention', needsAttention: true,
        confidence: 0.97, topLabel: 'NEEDS_ATTENTION', reason: 'rule'
      });
    } else if (rule === 'appreciation') {
      pushUnique(result.appreciation, text);
      result.statistics.appreciation++;
      result.statistics.ruleClassified++;
      result.classifiedComments.push({
        text, classification: 'appreciation', needsAttention: false,
        confidence: 0.97, topLabel: 'APPRECIATION', reason: 'rule'
      });
    } else {
      ambiguous.push(text);
    }
  }

  // ── STEP 2: Call HF API for ambiguous comments ────────────────────────────
  // Send one comment at a time but only for truly ambiguous ones
  const attnEntries = result.classifiedComments.filter(c => c.classification === 'attention');
  let apiWorking = true;

  for (const text of ambiguous) {
    if (!apiWorking) {
      // API down → default to ATTENTION (safer than missing problems)
      pushUnique(result.commentsNeedingAttention, text);
      result.statistics.attention++;
      const e = {
        text, classification: 'attention', needsAttention: true,
        confidence: 0.6, topLabel: 'NEEDS_ATTENTION',
        category: keywordCategory(text), reason: 'fallback-default'
      };
      result.classifiedComments.push(e);
      attnEntries.push(e);
      continue;
    }

    try {
      const pred      = await callHF(
        text,
        ['appreciation', 'complaint or suggestion'],
        'This student feedback about a teacher is a {}.'
      );
      const isApprec  = pred.labels[0] === 'appreciation';
      const confidence = parseFloat(pred.scores[0].toFixed(4));

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
        attnEntries.push(e);
      }

      await sleep(200); // small delay between calls

    } catch (err) {
      console.warn('[HF API] Failed:', err.message, '— using fallback');
      apiWorking = false;
      // Default ambiguous to attention
      pushUnique(result.commentsNeedingAttention, text);
      result.statistics.attention++;
      const e = {
        text, classification: 'attention', needsAttention: true,
        confidence: 0.6, topLabel: 'NEEDS_ATTENTION',
        category: keywordCategory(text), reason: 'api-fallback'
      };
      result.classifiedComments.push(e);
      attnEntries.push(e);
    }
  }

  // ── STEP 3: Categorize attention comments (keyword-based, instant) ─────────
  // Skip API for categorization — keyword rules are accurate enough
  for (const entry of result.classifiedComments) {
    if (entry.classification !== 'attention') continue;
    entry.category = keywordCategory(entry.text);
    pushUnique(result.commentCategories[entry.category], entry.text);
  }

  console.log(
    `[HF Classifier] Total=${result.statistics.totalReceived}` +
    ` | Appreciation=${result.statistics.appreciation}` +
    ` | Attention=${result.statistics.attention}` +
    ` | Neutral=${result.statistics.neutral}` +
    ` | Rule=${result.statistics.ruleClassified}` +
    ` | API=${result.statistics.aiClassified}` +
    ` | APIWorking=${apiWorking}`
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

function keywordCategory(text) {
  if (/\b(speed|fast|slow|rush|pace|pacing|quickly|hurry)\b/i.test(text))                  return 'Teaching';
  if (/\b(voice|audible|volume|sound|mic|hear|loud|speak|clear(er|ly)?)\b/i.test(text))    return 'Communication';
  if (/\b(doubt|available|respond|reach|help|support|approachable|accessible)\b/i.test(text)) return 'Availability';
  if (/\b(note|material|pdf|ppt|slide|book|handout|upload|diagram|formula)\b/i.test(text)) return 'Materials';
  if (/\b(quiz|marks?|test|assessment|grade|exam|evaluation|cheat)\b/i.test(text))         return 'Assessment';
  if (/\b(lab|practical|coding|hands.?on|implement|program|experiment)\b/i.test(text))     return 'Teaching';
  return 'General';
}

module.exports = { classifyCommentsWithHF };
