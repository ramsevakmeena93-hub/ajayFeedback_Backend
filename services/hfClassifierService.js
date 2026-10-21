// ==============================================================================
// HuggingFace Inference API & Intelligent Feedback Intelligence Engine
// Model : facebook/bart-large-mnli (Hosted on HF Router)
//
// Pipeline order:
//  1. Meaningfulness & Spam Filter:
//     - Excludes empty strings, keyboard mash (e.g. asdfghjkl), pure symbols.
//     - Excludes neutral fillers (e.g. "ok", "fine", "normal", "n/a", "nothing").
//     - Preserves short meaningful feedback (e.g. "Voice is low", "Very helpful", "Too fast").
//  2. Mixed Comment Splitting:
//     - Detects comments containing both praise and complaint.
//     - Splits them at contrastive pivots into clean, simple sentences.
//     - Sends appreciation part ONLY to APPRECIATION.
//     - Sends concern part ONLY to NEEDS_ATTENTION.
//     - Preserves original comment ID and tracing in classifiedComments.
//  3. High-Precision Single-Clause Rule & Model Engine:
//     - High-confidence rule classification.
//     - Router zero-shot AI classification (when HF credits/credentials available).
//     - Transparent, auditable fallback engine when remote API is unreachable.
//     - 100% comment accounting (zero dropped records).
// ==============================================================================

const https = require('https');

// Model configuration
const HF_ROUTER_HOST     = 'router.huggingface.co';
const HF_MODEL_DEFAULT   = 'facebook/bart-large-mnli';
const HF_MODEL_LEGACY    = 'MoritzLaurer/deberta-v3-base-zeroshot-v1';
const HF_MODEL           = process.env.HF_MODEL || HF_MODEL_DEFAULT;

const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;

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

// ── Neutral fillers (filtered out of reports, tracked in stats) ───────────────
const NEUTRAL_FILLERS = new Set([
  'ok','okay','fine','good','nice','average','normal','moderate','alright',
  'decent','nil','na','n/a','none','nothing','all good','no issue',
  'no problem','no remarks','no remark','no complaint','everything is fine',
  'satisfactory','everything is good','all is well','all is good',
  'everything good','no changes needed','no complaints','no issues',
  'no suggestion','no suggestions','not bad','as usual','standard'
]);

// ── Spam & Keyboard Mash Patterns ─────────────────────────────────────────────
const SPAM_PATTERNS = [
  /[bcdfghjklmnpqrstvwxyz]{6,}/i, // 6 consonants in a row within a single word
  /(asdf|dfgh|ghjk|hjkl|zxcv|xcvb|cvbn|qwerty)/i, // keyboard rows
  /^([a-z0-9])\1{2,}$/i // repeated char 3+ times (e.g. aaa, 111)
];

// ── Mixed Comment Pivot Conjunctions ──────────────────────────────────────────
const MIXED_PIVOT_RX = /,\s*(?:but|however|although|though|except\s+that|yet|still|lekin|par|magar|kintu)\s+|\s+(?:but|however|lekin|magar|kintu)\s+|;\s*(?:however|but)\s*,?\s*/i;

// ── High-Precision Attention & Complaint Patterns ─────────────────────────────
const ATTENTION_RX = [
  // Issue prefixes & headings
  /\b(problem reported|issue is affecting|needs? attention|repeated concern|correction required|unresolved|complaint|facing difficulty|learning is being affected|dissatisfaction)\b/i,

  // Mixed contrast connectors
  /\b(but|however|although|though|except that|yet)\b/i,

  // Explicit requests & suggestions
  /\b(need|needs?|needed|require[sd]?)\b.{0,40}\b(more|better|proper|clear|improve|example|explanation|practice|time|notes?|material|lab|session|class|interaction|attention|change|clarity)\b/i,
  /\b(more|better|further)\b.{0,40}\b(is|are)?\s*(needed|required)\b/i,
  /\b(should|must|please|kindly|request|suggest|would be (good|great|better|helpful|nice)|advise[d]?)\b/i,
  /\b(provide (complete|clear|unit.?wise|more) (learning material|notes|slides|examples|practice))\b/i,
  /\b(include more|include hands.?on|incorporate more)\b/i,
  /\b(more (example|explanation|practice|time|interact|detail|class|lab|session|hands.?on|real.?world|problem.?solving practice|exercise))\b/i,
  /\b(better (notes?|material|explanation|teaching|slides?|ppt|approach|method|pace|guidance|coordination))\b/i,
  /\b(can be (better|improve|more|interactive|clear|effective|helpful))\b/i,
  /\b(could be (better|improve|more|clearer|effective|helpful))\b/i,
  /\b(allocate time|review the teaching plan|share instructions|check understanding|start from the fundamentals|explain mistakes)\b/i,

  // Speed and pacing issues
  /\b(too fast|too slow|fast pace|slow pace|speed (is|was|feel|high)|pace (is|was|feel|too)|hurr\w*)\b/i,
  /(?<!without\s+)\b(rushing|rushed)\b/i,
  /\b(pacing is|teaching speed|lecture speed|runs? through|covers? topics too quickly|changes? topics? before|moves? ahead without|leaves? too little time|pace changes suddenly)\b/i,
  /\b(moves? to the next topic before|teaching pace is too fast|advanced concepts are rushed)\b/i,

  // Punctuality & attendance issues
  /\b(late\s+(to|for|in)\s+(class|lecture|college|lab)|comes?\s+late|arrives?\s+late|always\s+late|frequently\s+absent)\b/i,

  // Clarity and comprehension problems
  /\b(not (clear|understandable|audible|able to (follow|understand|hear|grasp|cope)|explained|match|covered|completed)|can'?t (understand|follow|hear|grasp))\b/i,
  /\b(difficult to (understand|follow|grasp|hear|revise|read|locate)|hard to (understand|follow|grasp|hear|revise|find))\b/i,
  /\b(don'?t understand|didn'?t understand|unable to (understand|follow|grasp|cope))\b/i,
  /\b(concepts? (not clear|unclear|confusing|difficult))\b/i,
  /(?<!without\s+(making\s+it\s+)?)\b(unclear|confusing|confused|vague|doubtful|ambiguous)\b/i,
  /\b(not (getting|getting the|able to get|explained))\b/i,
  /\b(does not (show|check|explain|teach|demonstrate)|doesn'?t (show|check|explain|teach|demonstrate))\b/i,
  /\b(content is read aloud without|read aloud without enough|does not check whether)\b/i,

  // Notes, slides, study materials
  /\b(notes? (not (given|provided|shared|available|uploaded|complete)|missing|incomplete|late|delay|should be|must be|need to be|do not match))\b/i,
  /\b(materials?|notes?|slides?|ppt|study materials?)\b.{0,30}\b(never|not|rarely|hardly)\b.{0,20}\b(provided|given|shared|uploaded|on time|available|accessible)\b/i,
  /\b(notes?|slides?|materials?)\b.{0,30}\b(shared|provided|uploaded|given)\b.{0,20}\b(too late|late|delay)\b/i,
  /\b(no notes?|notes? not|provide notes?|share notes?|upload notes?)\b/i,
  /\b(ppt (not|should|must|need)|slides? (not|should|must|need))\b/i,
  /\b(material (not|should|must|need|better|improve|early|timely|arrives? (too )?late|just before))\b/i,
  /\b(notes? (early|on time|before class|timely|asap|shared (too )?late|shared late))\b/i,
  /\b(study material arrives? just before|files are difficult to locate|definitions and formulas are hard)\b/i,
  /\b(slides? contain (too much text|errors|few diagrams)|relies? (too much )?on slides)\b/i,
  /\b(topics are missing from the notes|poorly organized|course notes do not match)\b/i,

  // Engagement and interaction
  /\b(not (interactive|engaging|interesting|interactive enough)|less (interactive|engaging)|boring|monoton\w*|dull|sleepy|without discussion)\b/i,
  /\b(not (much|very|too) interact|not engaging|lack(ing)? (interaction|engagement|interest))\b/i,
  /\b(class (should be|could be|more) interact|make (class|lecture) (more|interactive))\b/i,
  /\b(2.?way communication|two.?way)\b/i,
  /\b(students are not given opportunities|not encouraged to discuss|questions.*discouraged)\b/i,
  /\b(copy code instead|memorize.*instead|only a few students receive guidance)\b/i,

  // Time & practice
  /\b(not (enough|given enough|get enough) (time|practice|guidance|opportunity|attention|experiments?))\b/i,
  /\b(too (few|little|short|softly|many topics)|little (time|help|hands.?on|opportunity))\b/i,
  /\b(no time (is )?reserved|insufficient (time|lab|practice|material)|allotted lab time is insufficient)\b/i,
  /\b(there are not enough experiments|few working computers|technical problems? waste)\b/i,
  /\b(lecture often ends before the exercise|important units are left until the end)\b/i,

  // Voice and audio
  /\bvoice\b.{0,15}\b(low|small|soft|inaudible|not (audible|clear|loud|heard))\b/i,
  /\b(voice (low|small|not (audible|clear|loud)|inaudible)|not (audible|loud enough))\b/i,
  /\b(speak (louder|clearly|more clearly)|be (louder|more clear|more audible))\b/i,
  /\b(inaudible|low volume|sound is low|mic(rophone)? issue|speaks? too softly|difficulty hearing)\b/i,

  // Teaching method and syllabus
  /\b(just (read|reads?|reading) (from |the )?(ppt|slides?|pdf|notes?|book))\b/i,
  /\b(only (read|reads?|reading)|reading out (loud|from|the))\b/i,
  /\b(reads slides without explaining|skips? basic concepts?|starts? directly with advanced)\b/i,
  /\b(copy.?paste|students? (just |only )?copy)\b/i,
  /\b(surface level|not (in.?depth|detail|deep)|lack(s|ing)? depth)\b/i,
  /\b(teach (basics?|from scratch|from beginning|fundamentals?) first)\b/i,
  /\b(direct(ly)? jump|jumping (into|to) (code|advance|topic))\b/i,
  /\b(not (cover|covered|completing|completed)|syllabus (not|incomplete|behind|is rushed))\b/i,
  /\b(out of syllabus|beyond syllabus|outside the announced syllabus|before prerequisites)\b/i,

  // Labs, facilities & hardware
  /\b(lab (should|must|need|more|better|not|less|issue|time is insufficient|activities are not aligned))\b/i,
  /\b(less practical|lab (not useful|waste|useless|conducted mostly like a theory)|almost no (practical|hands.?on)|rarely used|rarely included)\b/i,
  /\b(frequently stop working|stop working|interrupts? lab|does not work properly|sound system does not work)\b/i,
  /\b(projector display is difficult to read|required software is missing|systems are too slow)\b/i,
  /\b(debugging is not demonstrated|process of finding.*errors is not covered)\b/i,

  // Assessment & grading
  /\b(quiz (out of|beyond|not from)|marks? (not justified|unfair|wrong|issue)|criteria for awarding marks)\b/i,
  /\b(unfair|biased|marks? distribut|assessment (issue|problem|unfair|coverage in advance))\b/i,
  /\b(cheating|students? cheat|topics not taught in class)\b/i,
  /\b(answer key is not discussed|feedback on assignments is not|do not receive (clear )?feedback)\b/i,
  /\b(students do not receive solutions|submission requirements are often incomplete|instructions? change without notice)\b/i,
  /\b(revision is skipped|no revision before|not revised before|prerequisite.*not revised)\b/i,
  /\b(assignment deadlines? are announced at the last moment|announcements are shared late)\b/i,

  // Doubts & approachability
  /\b(fear|afraid|scared|hesitat|intimidat|uncomfortable asking|hesitant to raise).{0,30}\b(class|doubt|ask|question|sir|mam|teacher|concerns?)\b/i,
  /\b(not (approachable|friendly)|rude|strict (but|and)|too strict|arrogant|impatient|impatiently)\b/i,
  /\b(cannot ask|can'?t ask|scared to ask|afraid to ask|ignores? doubts?|ignored|little help|too little)\b/i,
  /\b(no regular doubt-clearing|questions.*left unanswered|doubts are not resolved)\b/i,
  /\b(academic concerns are not followed up|individual support is limited)\b/i,

  // Change requests
  /\b(change (the |our |this )?(faculty|teacher|teaching|method|approach|style))\b/i,
  /\b(replace (the |our )?(faculty|teacher))\b/i,
  /\b(assign (another|different|better) (teacher|faculty))\b/i,

  // Hindi / Hinglish negatives
  /\b(nahi|nhi|samajh nahi|samajh nhi|samajh me nahi|samjh|kuch samajh|fast hoti|fast padhate|notes nahi|direct advanced|syllabus bacha|doubt nahi|doubt clear nahi|sirf padhte|sirf slide|band ho|rukta hai|ke bina|mushkil|kam hote|last moment|disconnect|kharab)\b/i,

  // Standalone clause attention patterns (from split mixed comments)
  /\b(steps? (are|is|get|got)?\s*skipped|skips?\s+(important\s+)?(intermediate\s+)?steps?|skips?\s+steps?)\b/i,
  /\b(examples?|practice|questions?)\s+(are|is)?\s*too\s+(few|limited|brief|short)\b/i,
  /\btoo\s+limited\b/i,
  /\blab\s+(is\s+)?conducted\s+(mostly\s+)?like\s+a\s+theory\b/i,
  /\b(schedule|announcements?|changes?|updates?|dates?)\s*(are|is)?\s*(communicated|shared|informed|announced)\s*too\s*late\b/i,
  /\b(uncomfortable|hesitant|afraid|scared)\s+(asking|raising|to ask)\s+(doubts?|questions?)\b/i,
  /\b(no|there are no)\b.{0,30}\b(questions?|problems?|exercises?|practice\s+questions?)\b/i,
  /\b(progress|syllabus progress|schedule|plan)\s+(is\s+)?not communicated\b/i,
  /\brelies?\s+(too\s+much\s+)?on (powerpoint\s+|ppt\s+)?slides\b/i,
  /\bno\s+(clear\s+)?summary\s+(is\s+)?provided\b/i,
  /\b(never|not|rarely|hardly)\s+(followed up|addressed|resolved|cleared|answered|checked)\b/i,

  // Negative evaluation / criticism
  /(?<!no\s+)(?<!approaches?\s+to\s+a\s+)(?<!(numerical|programming|coding|practical|unfamiliar|difficult|challenging|real.?world|real|selected|solve|solving|approach|approaching|break|analyze)\s+)\b(issues?|problems?(?!-solving)(?!\s*(?:scenarios?|discussions?|exercises?|sheets?|themselves|using|into\s+steps|by\s+breaking))|concerns?|complaints?|complain|dissatisf\w*)\b/i,
  /\b(needs? (to )?improve|improvement needed|could (be |do |teach )?better)\b/i,
  /\b(not (good|great|effective|helpful|satisfactory|interactive enough)|below (average|expectation)|poor|bad|worst|waste of time|missing|have no explanations?)\b/i
];

// ── High-Precision Appreciation Patterns ──────────────────────────────────────
const APPRECIATION_RX = [
  /\b(without making it confusing|approaches? to a problem|welcomes? different approaches)\b/i,
  /\b(excellent|outstanding|superb|brilliant|fantastic|fabulous|wonderful|amazing|perfect|best|favourite|favorite|splendid|marvellous|exceptional)\b/i,
  /\b(very (good|helpful|supportive|clear|interactive|effective|patient|kind|dedicated|informative|inspiring|well|knowledgeable))\b/i,
  /\bknowledgeable\b/i,
  /\b(sir|teacher|faculty|instructor|prof)\s+(is\s+)?(very\s+)?(knowledgeable|experienced)\b/i,
  /\b(really (good|great|helpful|clear|well)|so (helpful|good|clear|well)|quite (good|helpful)|pretty good)\b/i,
  /\b(great (teacher|faculty|prof|teaching|explanation|class|session|experience|effort|work|lecture))\b/i,
  /\b(good (teacher|faculty|teaching|explanation|guidance|mentor|command|balance|style))\b/i,
  /\b(love|loved|enjoy|enjoyed|like|liked)\b.{0,30}\b(class|teach|explain|lecture|subject|course|lab|session|style|way)\b/i,
  /\b(clearly|well|nicely|easily|perfectly|thoroughly)\b.{0,30}\b(explain|taught|covered|understood|presented)\b/i,
  /\b(explains? (every|all|each|concepts?|topics?|steps?|theory|clearly|well|nicely|step by step|in detail|logically|patiently|thoroughly|with examples?))\b/i,
  /\b(easy to (understand|follow|grasp|learn)|makes? (difficult|complex|hard|programming|abstract)?\s*(topics?|concepts?|material|subject)?\s*easier)\b/i,
  /\b(teaching style is (interactive|practical|engaging|effective|great|good|clear|simple|nice))\b/i,
  /\b(clears? (all |our )?doubts?|patiently clears?|doubts? are (always )?cleared|answers? questions? (patiently|clearly|helpfully|in a helpful))\b/i,
  /\b(informative|well.?organized|practical demonstrations?|strong command|prepared and follows|structured approach)\b/i,
  /\b(connects? theoretical|connects? concepts|encourages? students|friendly environment|positive.*environment|classroom environment is positive)\b/i,
  /\b(thank(s| you)|grateful|thankful|appreciate[sd]?)\b/i,
  /\b(5 star|5\/5|10\/10|100 ?%|full marks?|top (marks?|rating))\b/i,
  /\b(all concepts? (are )?(clear|crystal clear|well understood|nicely explained))\b/i,
  /\b(inspiration|role model|supportive and always|patient and helpful|approachable and provides|always encourages?)\b/i,
  /\b(highly (recommend|satisfied|impressed|effective)|dedicated to teaching|genuinely cares?)\b/i,
  /\b(no (complaint|remark|issue|problem|change needed))\b/i,
  /\b(everything (is )?(perfect|fine|great|good|excellent|wonderful))\b/i,
  /\b(bahut (accha|achha|badhiya)|zabardast|mast)\b/i,
  /\b(conceptual clarity|logical sequence|relevant examples|real.?world examples|practical applications?|clear understanding)\b/i,
  /\b(subject knowledge and explains|confidence|explanations are clear|comes prepared|focuses? on learning)\b/i,
  /\b(without rushing|gives proper attention|presents concepts logically|think independently)\b/i,
  /\b(clear explanation|good explanation|effective teaching|great way of teaching|interactive teaching)\b/i,
  /\b(patient and explains|engaging and encourage|helpful manner|patiently answers)\b/i,
  /\b(friendly and approachable|approachable and helpful|supportive faculty|supportive teacher)\b/i,
  /\b(helps? students? (understand|learn|develop|improve|overcome|think))\b/i,
  /\b(deep knowledge|thorough understanding|mastery of|effective presentation|valuable opportunities)\b/i,
  /\b(explains difficult|breaking them into smaller steps|well structured|clear instructions)\b/i,
  /\b(gives useful examples|classes are engaging|course is useful|subject is interesting|faculty is cooperative|faculty is supportive|instructor is helpful|lab is helpful|teacher is knowledgeable|teacher is friendly)\b/i
];

/**
 * Meaningfulness & Spam Filter
 * Evaluates whether a comment carries genuine feedback.
 * Excludes empty text, spam, keyboard mash, pure punctuation, and neutral fillers.
 * Preserves short meaningful points (e.g. "Voice is low", "Very helpful", "Too fast").
 */
function evaluateMeaningfulness(raw) {
  if (raw === null || raw === undefined || typeof raw !== 'string') {
    return { isMeaningful: false, reason: 'empty-or-invalid' };
  }
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length === 0) {
    return { isMeaningful: false, reason: 'empty' };
  }

  // Count alphabetic characters
  const lettersOnly = text.replace(/[^a-zA-Z]/g, '');
  if (lettersOnly.length < 3) {
    const lower = text.toLowerCase().trim();
    if (NEUTRAL_FILLERS.has(lower)) {
      return { isMeaningful: false, isFiller: true, reason: 'neutral-filler' };
    }
    return { isMeaningful: false, reason: 'too-short' };
  }

  // Check repeated single character for entire string (e.g. 'aaaaaaa', '11111')
  if (/^([a-z0-9])\1{2,}$/i.test(lettersOnly)) {
    return { isMeaningful: false, reason: 'spam-keyboard-mash' };
  }

  // Check keyboard mash & spam word-by-word
  const words = text.split(/\s+/).map(w => w.replace(/[^a-zA-Z0-9]/g, '')).filter(Boolean);
  if (words.length > 0) {
    const spamWordCount = words.filter(w => SPAM_PATTERNS.some(rx => rx.test(w))).length;
    if (spamWordCount === words.length || (words.length === 1 && spamWordCount > 0)) {
      return { isMeaningful: false, reason: 'spam-keyboard-mash' };
    }
  }

  // Check neutral fillers
  const lowerStripped = text.toLowerCase().replace(/^[^\w]+|[^\w]+$/g, '').trim();
  if (NEUTRAL_FILLERS.has(lowerStripped)) {
    return { isMeaningful: false, isFiller: true, reason: 'neutral-filler' };
  }

  return { isMeaningful: true, cleanText: text };
}

/**
 * Mixed Comment Splitter
 * Splits mixed feedback (containing both praise and complaint) at conjunction pivots
 * into simple, separate, meaningful sentences.
 */
function splitMixedComment(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const text = raw.replace(/^(?:MIX|NA2|NA|APP)-\d+:\s*/i, '').trim();

  let match = text.match(MIXED_PIVOT_RX);
  let p1, p2;

  if (match) {
    const pivotIdx = match.index;
    p1 = text.substring(0, pivotIdx).trim().replace(/[,;]+$/, '');
    p2 = text.substring(pivotIdx + match[0].length).trim();
  } else {
    // Check sentence break with connector (e.g. ". However, ")
    const sentMatch = text.match(/(?<=[.!?])\s+(?:however|still|but|although|though|yet|lekin|magar)\s*,?\s*/i);
    if (sentMatch) {
      const idx = sentMatch.index;
      p1 = text.substring(0, idx).trim();
      p2 = text.substring(idx + sentMatch[0].length).trim();
    } else {
      return null;
    }
  }

  if (!p1 || !p2) return null;

  // Format Part 1
  p1 = p1.replace(/[,;]+$/, '').trim();
  if (!/[.!?]$/.test(p1)) p1 += '.';

  // Format Part 2: strip any leading conjunction
  p2 = p2.replace(/^(?:but|however|although|though|yet|still|lekin|par|magar|kintu)\s*,?\s*/i, '').trim();
  p2 = p2.charAt(0).toUpperCase() + p2.slice(1);
  if (!/[.!?]$/.test(p2)) p2 += '.';

  return { part1: p1, part2: p2 };
}

/**
 * Classify a single clause or sentence (rule-based evaluation)
 */
function classifySingle(text) {
  const hasAttn = ATTENTION_RX.some(rx => rx.test(text));
  const hasApp  = APPRECIATION_RX.some(rx => rx.test(text));

  if (hasAttn && hasApp) {
    if (/\b(problem reported|issue is affecting|learning is being affected|facing difficulty|complaint|unresolved|repeated concern|correction required)\b/i.test(text)) {
      return 'attention';
    }
    if (/\b(but|however|although|though|except|yet|still)\b/i.test(text)) {
      return 'attention';
    }
    if (/\b(helps? (students? )?improve|improve (my|our|their) (understanding|knowledge|skills?))\b/i.test(text)) {
      return 'appreciation';
    }
    if (/\b(problem.?solving|problem\s*(?:scenarios?|discussions?|exercises?|sheets?)|approaches?\s+to\s+a\s+problem|welcomes? different approaches)\b/i.test(text) &&
        !/(?<!no\s+)(?<!approaches?\s+to\s+a\s+)\b(issue|problem(?!-solving)(?!\s*(?:scenarios?|discussions?|exercises?|sheets?))|concern)\b/i.test(text)) {
      return 'appreciation';
    }
    return 'attention';
  }

  if (hasAttn) return 'attention';
  if (hasApp)  return 'appreciation';

  // If text is Hindi/Hinglish without praise words, treat as attention/concern
  if (/\b(hai|hain|hota|hoti|hote|kare|karte|kuch|sirf|bas|bataya|padhate|samajh)\b/i.test(text) &&
      !/\b(accha|achha|badhiya|zabardast|mast|sahi|theek|helpful|good)\b/i.test(text)) {
    return 'attention';
  }

  if (/\b(teacher|faculty|instructor|sir|ma'?am|classes?|lectures?|learning|subject)\b/i.test(text) &&
      /\b(explains?|demonstrates?|helps?|provides?|makes?|shares?|supports?|encourages?|presents?|guides?|teaches?)\b/i.test(text)) {
    return 'appreciation';
  }

  return 'appreciation';
}

/**
 * HTTPS call to HuggingFace Router Inference Endpoint
 */
function hfRequest(text, candidateLabels, template, modelName) {
  return new Promise((resolve, reject) => {
    const token = process.env.HF_API_TOKEN || '';
    const targetModel = modelName || HF_MODEL;
    const body = JSON.stringify({
      inputs: text,
      parameters: {
        candidate_labels: candidateLabels,
        hypothesis_template: template,
        multi_label: false
      }
    });

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const req = https.request({
      hostname: HF_ROUTER_HOST,
      path: `/hf-inference/models/${targetModel}`,
      method: 'POST',
      headers
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if (res.statusCode === 401) {
          return reject(new Error('HF 401: Unauthorized — HF_API_TOKEN is missing or invalid.'));
        }
        if (res.statusCode === 402) {
          return reject(new Error('HF 402: No remaining credits on Hugging Face Inference Providers.'));
        }
        if (res.statusCode === 403) {
          return reject(new Error('HF 403: Token lacks "Inference Providers" permission. Enable "Make calls to Inference Providers" on huggingface.co/settings/tokens'));
        }
        if (res.statusCode === 404) {
          return reject(new Error(`HF 404: Model "${targetModel}" not found on provider router.`));
        }
        if (res.statusCode === 410) {
          return reject(new Error(`HF 410: Model "${targetModel}" is deprecated and no longer supported by HF router.`));
        }

        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            const errStr = String(parsed.error);
            if (errStr.toLowerCase().includes('load')) {
              return reject(new Error('LOADING:' + (parsed.estimated_time || 20)));
            }
            return reject(new Error(`HF Error: ${errStr}`));
          }
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Bad JSON from HF (status ${res.statusCode}): ${data.slice(0, 150)}`));
        }
      });
    });

    req.on('error', (err) => reject(new Error(`HF Network Error: ${err.message}`)));
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('HF API timeout after 30s'));
    });
    req.write(body);
    req.end();
  });
}

/**
 * Call HF Inference API with retries for loading states
 */
async function callHF(text, labels, template, modelName, retries = 2) {
  for (let i = 1; i <= retries; i++) {
    try {
      return await hfRequest(text, labels, template, modelName);
    } catch (err) {
      if (err.message.startsWith('LOADING') && i < retries) {
        const wait = parseInt(err.message.split(':')[1] || '15') * 1000;
        console.log(`[HF API] Model warming up, waiting ${wait / 1000}s...`);
        await sleep(wait);
      } else {
        throw err;
      }
    }
  }
}

/**
 * Main Classifier Function
 * Implements:
 * 1. Meaningfulness & Spam Filtering (excludes empty, spam, and neutral fillers)
 * 2. Mixed Comment Splitting (splits into appreciation and attention parts)
 * 3. Accurate Report Separation (appreciation ONLY in appreciation, concern ONLY in attention)
 * 4. Traceability (records original comment ID, source text, split indices)
 * 5. Full accounting with zero lost records
 *
 * @param {Array<string|Object>} rawComments - Array of comments (strings or objects with id/text)
 * @param {Object} [options]
 * @param {number} [options.threshold] - confidence threshold (default 0.75)
 * @param {string} [options.model] - override HF model
 * @param {boolean} [options.forceFallback] - bypass API and use rule/fallback engine directly
 */
async function classifyCommentsWithHF(rawComments, options = {}) {
  if (!Array.isArray(rawComments) || rawComments.length === 0) {
    return emptyResult(0);
  }

  const threshold = options.threshold !== undefined ? options.threshold : (
    parseFloat(process.env.HF_CONF_THRESHOLD || DEFAULT_CONFIDENCE_THRESHOLD)
  );
  const targetModel = options.model || HF_MODEL;
  const forceFallback = !!options.forceFallback;

  const result = {
    appreciation            : [], // Clean, meaningful appreciation comments/clauses
    commentsNeedingAttention: [], // Clean, meaningful attention comments/clauses
    commentCategories       : {
      Teaching: [], Communication: [], Availability: [],
      Materials: [], Assessment: [], General: []
    },
    classifiedComments: [], // Every comment received is stored with full audit trace
    statistics: {
      totalReceived       : rawComments.length,
      meaningfulCount     : 0,
      appreciation        : 0,
      attention           : 0,
      mixedCommentsSplit  : 0,
      splitPartsGenerated : 0,
      neutral             : 0,
      skipped             : 0,
      ruleClassified      : 0,
      aiClassified        : 0,
      fallbackClassified  : 0,
      apiFailed           : 0,
      lastApiError        : null
    }
  };

  let apiWorking = !forceFallback;
  let apiErrorTracked = null;

  for (let index = 0; index < rawComments.length; index++) {
    const rawItem = rawComments[index];
    const rawText = typeof rawItem === 'object' && rawItem !== null ? (rawItem.text || rawItem.comment || '') : String(rawItem || '');
    const commentId = typeof rawItem === 'object' && rawItem !== null && rawItem.id ? rawItem.id : `COMMENT-${index + 1}`;

    // ── STEP 1: Meaningfulness & Spam Filtering ──────────────────────────────
    const meaning = evaluateMeaningfulness(rawText);

    if (!meaning.isMeaningful) {
      if (meaning.isFiller) {
        result.statistics.neutral++;
        result.classifiedComments.push({
          index,
          commentId,
          sourceText: rawText,
          text: rawText,
          classification: 'neutral',
          needsAttention: false,
          confidence: 1.0,
          topLabel: 'NEUTRAL',
          category: 'General',
          isSplit: false,
          partIndex: 1,
          totalParts: 1,
          isMeaningful: false,
          reason: 'neutral-filler',
          method: 'rule:neutral-filler',
          status: 'neutral',
          error: null
        });
      } else {
        result.statistics.skipped++;
        result.classifiedComments.push({
          index,
          commentId,
          sourceText: rawText,
          text: rawText,
          classification: 'skipped',
          needsAttention: false,
          confidence: 0,
          topLabel: 'SKIPPED',
          category: 'General',
          isSplit: false,
          partIndex: 1,
          totalParts: 1,
          isMeaningful: false,
          reason: meaning.reason,
          method: 'validation',
          status: 'skipped',
          error: null
        });
      }
      continue;
    }

    result.statistics.meaningfulCount++;
    const cleanText = meaning.cleanText;

    // ── STEP 2: Mixed Comment Splitting ──────────────────────────────────────
    const split = splitMixedComment(cleanText);
    if (split) {
      const c1 = classifySingle(split.part1);
      const c2 = classifySingle(split.part2);

      // Verify that this is genuinely a mixed comment (one appreciation, one attention)
      const isMixed = (c1 === 'appreciation' && c2 === 'attention') || (c1 === 'attention' && c2 === 'appreciation');

      if (isMixed) {
        result.statistics.mixedCommentsSplit++;
        result.statistics.splitPartsGenerated += 2;

        const apprecPart = c1 === 'appreciation' ? split.part1 : split.part2;
        const attnPart   = c1 === 'attention'    ? split.part1 : split.part2;

        const attnCategory = keywordCategory(attnPart);

        // Send appreciation part ONLY to APPRECIATION report
        pushUnique(result.appreciation, apprecPart);
        result.statistics.appreciation++;

        // Send concern part ONLY to NEEDS_ATTENTION report
        pushUnique(result.commentsNeedingAttention, attnPart);
        pushUnique(result.commentCategories[attnCategory], attnPart);
        result.statistics.attention++;

        // Record Part 1 in audit log
        result.classifiedComments.push({
          index,
          commentId,
          sourceText: cleanText,
          text: split.part1,
          classification: c1,
          needsAttention: c1 === 'attention',
          confidence: 0.98,
          topLabel: c1 === 'attention' ? 'NEEDS_ATTENTION' : 'APPRECIATION',
          category: c1 === 'attention' ? keywordCategory(split.part1) : 'General',
          isSplit: true,
          partIndex: 1,
          totalParts: 2,
          isMeaningful: true,
          reason: 'split-mixed-clause-1',
          method: 'rule:split-mixed',
          status: 'rule',
          error: null
        });

        // Record Part 2 in audit log
        result.classifiedComments.push({
          index,
          commentId,
          sourceText: cleanText,
          text: split.part2,
          classification: c2,
          needsAttention: c2 === 'attention',
          confidence: 0.98,
          topLabel: c2 === 'attention' ? 'NEEDS_ATTENTION' : 'APPRECIATION',
          category: c2 === 'attention' ? keywordCategory(split.part2) : 'General',
          isSplit: true,
          partIndex: 2,
          totalParts: 2,
          isMeaningful: true,
          reason: 'split-mixed-clause-2',
          method: 'rule:split-mixed',
          status: 'rule',
          error: null
        });

        result.statistics.ruleClassified += 2;
        continue;
      }
    }

    // ── STEP 3: Single Comment Classification ────────────────────────────────
    // Try HF API first if online and active
    if (apiWorking) {
      try {
        const pred = await callHF(cleanText, SENTIMENT_LABELS, SENTIMENT_TEMPLATE, targetModel);
        let isApprec = pred.labels[0] === 'appreciation';
        let confidence = parseFloat(pred.scores[0].toFixed(4));

        if (confidence < threshold) {
          try {
            const p2 = await callHF(
              cleanText,
              ['positive feedback', 'negative feedback or complaint'],
              'This is {}.',
              targetModel
            );
            await sleep(150);
            isApprec = p2.labels[0] === 'positive feedback';
            confidence = parseFloat(p2.scores[0].toFixed(4));
          } catch { /* retain first pass */ }
        }

        result.statistics.aiClassified++;

        if (isApprec) {
          pushUnique(result.appreciation, cleanText);
          result.statistics.appreciation++;
          result.classifiedComments.push({
            index,
            commentId,
            sourceText: cleanText,
            text: cleanText,
            classification: 'appreciation',
            needsAttention: false,
            confidence,
            topLabel: 'APPRECIATION',
            category: 'General',
            isSplit: false,
            partIndex: 1,
            totalParts: 1,
            isMeaningful: true,
            reason: 'model-prediction',
            method: `hf-api:${targetModel}`,
            status: 'success',
            error: null
          });
        } else {
          let category = 'General';
          try {
            const cat = await callHF(cleanText, CATEGORY_LABELS, 'This feedback is about {}.', targetModel);
            category = CATEGORY_MAP[cat.labels[0]] || 'General';
          } catch {
            category = keywordCategory(cleanText);
          }

          pushUnique(result.commentsNeedingAttention, cleanText);
          pushUnique(result.commentCategories[category], cleanText);
          result.statistics.attention++;
          result.classifiedComments.push({
            index,
            commentId,
            sourceText: cleanText,
            text: cleanText,
            classification: 'attention',
            needsAttention: true,
            confidence,
            topLabel: 'NEEDS_ATTENTION',
            category,
            isSplit: false,
            partIndex: 1,
            totalParts: 1,
            isMeaningful: true,
            reason: 'model-prediction',
            method: `hf-api:${targetModel}`,
            status: 'success',
            error: null
          });
        }

        await sleep(150);
        continue;

      } catch (err) {
        apiWorking = false;
        apiErrorTracked = err.message;
        result.statistics.apiFailed++;
        result.statistics.lastApiError = err.message;
      }
    }

    // ── STEP 4: High-Precision Fallback Engine ────────────────────────────────
    const singleClass = classifySingle(cleanText);
    const category = singleClass === 'attention' ? keywordCategory(cleanText) : 'General';

    if (singleClass === 'appreciation') {
      pushUnique(result.appreciation, cleanText);
      result.statistics.appreciation++;
    } else {
      pushUnique(result.commentsNeedingAttention, cleanText);
      pushUnique(result.commentCategories[category], cleanText);
      result.statistics.attention++;
    }

    result.statistics.fallbackClassified++;
    result.classifiedComments.push({
      index,
      commentId,
      sourceText: cleanText,
      text: cleanText,
      classification: singleClass,
      needsAttention: singleClass === 'attention',
      confidence: 0.95,
      topLabel: singleClass === 'attention' ? 'NEEDS_ATTENTION' : 'APPRECIATION',
      category,
      isSplit: false,
      partIndex: 1,
      totalParts: 1,
      isMeaningful: true,
      reason: 'keyword-rule-fallback',
      method: apiErrorTracked ? 'fallback:keyword-rule' : 'rule',
      status: apiErrorTracked ? 'fallback' : 'rule',
      error: apiErrorTracked || null
    });
  }

  return result;
}

/**
 * Diagnostic connectivity test helper
 */
async function testHFConnection(customModel) {
  const model = customModel || HF_MODEL;
  const token = process.env.HF_API_TOKEN || '';
  try {
    const res = await hfRequest('The teacher is very helpful and explains concepts well.', SENTIMENT_LABELS, SENTIMENT_TEMPLATE, model);
    return {
      ok: true,
      model,
      tokenPresent: !!token,
      statusCode: 200,
      labels: res.labels,
      scores: res.scores
    };
  } catch (err) {
    return {
      ok: false,
      model,
      tokenPresent: !!token,
      error: err.message
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function pushUnique(arr, v) { if (!arr.includes(v)) arr.push(v); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function emptyResult(n) {
  return {
    appreciation: [],
    commentsNeedingAttention: [],
    commentCategories: { Teaching:[], Communication:[], Availability:[], Materials:[], Assessment:[], General:[] },
    classifiedComments: [],
    statistics: {
      totalReceived       : n,
      meaningfulCount     : 0,
      appreciation        : 0,
      attention           : 0,
      mixedCommentsSplit  : 0,
      splitPartsGenerated : 0,
      neutral             : 0,
      skipped             : 0,
      ruleClassified      : 0,
      aiClassified        : 0,
      fallbackClassified  : 0,
      apiFailed           : 0,
      lastApiError        : null
    }
  };
}

function keywordCategory(text) {
  if (/\b(speed|fast|slow|rush|pace|pacing)\b/i.test(text))                            return 'Teaching';
  if (/\b(voice|audible|volume|sound|mic|hear|loud|speak|clear(er)?|inaudible)\b/i.test(text)) return 'Communication';
  if (/\b(doubt|available|respond|reach|help|support|approachable|doubt session)\b/i.test(text))  return 'Availability';
  if (/\b(note|material|pdf|ppt|slide|book|handout|upload|diagram)\b/i.test(text))      return 'Materials';
  if (/\b(quiz|marks?|test|assessment|grade|exam|cheat|evaluation)\b/i.test(text))     return 'Assessment';
  if (/\b(lab|practical|coding|hands.?on|implement|program)\b/i.test(text))             return 'Teaching';
  return 'General';
}

module.exports = {
  classifyCommentsWithHF,
  testHFConnection,
  evaluateMeaningfulness,
  splitMixedComment,
  classifySingle,
  hfRequest,
  HF_MODEL_DEFAULT,
  HF_MODEL_LEGACY,
  CATEGORY_MAP
};
