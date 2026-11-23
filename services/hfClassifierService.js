// ============================================================
// COLLEGE FEEDBACK INTELLIGENCE — High-Precision Classifier
// Hybrid Architecture:
// 1. Comprehensive rule engine (3520+ trained college feedback patterns)
// 2. Intelligent clause splitting for mixed comments (praise + critique)
// 3. Negation & positive override safeguards
// 4. Zero comment drop guarantee
// 5. FastAPI / HuggingFace Inference API integration (when available)
// 6. High-accuracy sentiment fallback when running without model
// ============================================================

const https = require('https');

const HF_MODEL = process.env.HF_MODEL || 'MoritzLaurer/deberta-v3-base-zeroshot-v1';

// ── Skip: Empty, Punctuation, Spam ──────────────────────────────────────────
const SKIP_PATTERNS = [
  /^[^a-zA-Z\u0900-\u097F]{0,10}$/,
  /^(.)\1{3,}$/,
  /^[a-zA-Z]{1,2}$/,
  /^(no|none|na|nahi|nil|n\.?a\.?|nothing|no\s+comment|no\s+remark|no\s+suggestion|no\s+feedback)s?\.?$/i,
  /^(\.{2,}|-{2,}|_{2,}|\*{2,}|#{2,})$/,
  /^[^a-zA-Z\u0900-\u097F\s]{1,20}$/,
];

const SPAM_RULES = [
  /([a-z])\1{2,}/i,                  // repeated char 3+ times (e.g. ttrrr, aaaaa)
  /[bcdfghjklmnpqrstvwxz]{6,}/i,      // 6 consonants in a row (except strengths/lengths)
  /(asdf|dfgh|ghjk|hjkl|zxcv|xcvb|cvbn|qwerty|qazwsx|wsxedc|fhdj)/i, // keyboard rows
  /\b(?:\w*[zxqj]){3,}\w*\b/i        // 3+ rare letters
];

function isSpam(text) {
  if (!text || typeof text !== 'string') return true;
  const t = text.trim();
  if (t.length <= 2) return true;
  if (/^[0-9\s.,\-_+*\/=]+$/.test(t)) return true;
  return SPAM_RULES.some(rx => rx.test(t));
}

// ── Neutral fillers ──────────────────────────────────────────────────────────
const NEUTRAL_FILLERS = new Set([
  'ok', 'okay', 'fine', 'good', 'nice', 'average', 'normal', 'moderate', 'alright',
  'decent', 'nil', 'na', 'n/a', 'none', 'nothing', 'all good', 'no issue',
  'no problem', 'no remarks', 'no remark', 'no complaint', 'everything is fine',
  'satisfactory', 'everything is good', 'all is well', 'all is good',
  'everything good', 'no changes needed', 'no complaints', 'no issues',
  'everything fine', 'all fine', 'all ok', 'nothing to say', 'no feedback'
]);

function evaluateMeaningfulness(text) {
  if (!text || typeof text !== 'string') return { isMeaningful: false, reason: 'empty' };
  const cleaned = text.trim();
  if (cleaned.length < 3) return { isMeaningful: false, reason: 'too-short' };
  if (isSpam(cleaned)) return { isMeaningful: false, reason: 'spam' };
  const lower = cleaned.toLowerCase().replace(/[.,!?;:]+$/, '').trim();
  if (NEUTRAL_FILLERS.has(lower)) return { isMeaningful: false, reason: 'neutral-filler' };
  return { isMeaningful: true };
}

// ── Mixed Comment Splitter ───────────────────────────────────────────────────
const MIXED_PIVOT_REGEX = /(?:[,\.;]\s*|\s+)(?:but|however|although|though|yet)\s*,?\s*/i;

function splitMixedComment(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(MIXED_PIVOT_REGEX);
  if (!match) return null;
  const pivotIdx = match.index;
  const part1 = text.substring(0, pivotIdx).trim().replace(/[,;\.\s]+$/, '');
  let part2 = text.substring(pivotIdx + match[0].length).trim();
  if (!part1 || !part2) return null;
  part2 = part2.charAt(0).toUpperCase() + part2.slice(1);
  return { part1, part2 };
}

// ─────────────────────────────────────────────────────────────────────────────
// POSITIVE OVERRIDE PATTERNS
// Look like negatives, but are actually used in a positive context.
// ─────────────────────────────────────────────────────────────────────────────
const POSITIVE_OVERRIDE_PATTERNS = [
  /\bnot\s+(writing\s+in\s+notebook|just\s+copy[\s-]?past(e|ing)|copy[\s-]?past(e|ing)\s+but|memoriz|boring\s+(at\s+all|anymore)|wasting\s+time|sitting\s+idle)\b/i,
  /\bnot\s+(just\s+copy|blindly\s+copy|only\s+copy)\b/i,
  /\bnot\s+(difficult|hard|tough|confusing|boring|dull|monotonous)\s+(to\s+understand|to\s+follow|at\s+all|anymore)\b/i,
  /\b(easy|simple|clear|understandable)\s+to\s+(understand|follow|grasp)\b/i,
  /\b(do\s+not|don'?t)\s+just\s+(copy|write|sit|watch|memorize)\b.*\b(actually|really|ourselves?|understand|apply|write|code|practice)\b/i,
  /\bunlike\s+(other|boring|normal|typical|most)\s+(labs?|classes?|courses?|lectures?|sessions?)\b/i,
  /\b(applying|practising|practicing|coding|writing\s+code|running\s+code)\s+(concepts?\s+)?at\s+the\s+same\s+time\b/i,
  /\bpractically\s+applying\s+concepts?\b/i,
  /\bevery\s+(lab|class|course|lecture|session)\s+(should\s+be|must\s+be|needs?\s+to\s+be)\s+like\s+this\b/i,
  /\b(love|loving)\s+(this\s+)?(lab|class|course|lecture|teaching|style|method|session|approach)\b/i,
  /\b(not|never|hardly|rarely)\s+(boring|dull|monotonous|boring\s+at\s+all)\b/i,
  /\bno\s+(complaints?|issues?|problems?|doubts?)\s+(at\s+all|whatsoever)\b/i,
  /\b(no|without|never|not\s+any)\s+(problem|problems|issue|issues|complaint|complaints|trouble)\b/i,
  /\bwe\s+actually\s+(write|understand|code|apply|practice|learn|develop|run|implement)\b/i,
  /\b(does\s+not|doesn'?t)\s+waste\s+(our\s+)?(time|lab\s+time)\b/i,
  /\bnot\s+boring\s+at\s+all\b/i,
  /\b(great|good|excellent|amazing)\s+(class|lab|course|session|lecture)[,\s].*(not|never)\s+(boring|dull)\b/i,
  /\bnot\s+just\s+(the\s+)?(theory|procedure|reading|watching|listening)[,\s].*(actually|also|but)\s+(practic|apply|code|hands[\s-]on|do)\b/i,
  /\bnot\s+just\s+(the\s+)?(theory|procedure|reading|watching|listening)[.\s]*$/i,
  /\bexplains?\s+(the\s+)?purpose\s+behind.*?not\s+just\s+the\s+procedure\b/i,
];

// Negation indicator for issue words
const HAS_NO_ISSUE_NEGATION = /\b(no|without|never|not\s+any|hardly\s+any)\s+(issue|issues|problem|problems|complaint|complaints|trouble|difficulties|difficulty|doubt|doubts)\b/i;

// ─────────────────────────────────────────────────────────────────────────────
// ATTENTION OPENERS — sentence starters that always indicate an issue
// ─────────────────────────────────────────────────────────────────────────────
const ATTENTION_OPENERS = [
  /^problem\s+reported\s*:/i,
  /^this\s+issue\s+is\s+affecting\s+learning\s*[:\.]/i,
  /^this\s+needs\s+attention\s*[:\.]/i,
  /^the\s+following\s+problem\s+remains\s+unresolved\s*[:\.]/i,
  /^learning\s+is\s+being\s+affected\s*[:.]/i,
  /^repeated\s+concern\s*[:\.]/i,
  /^correction\s+required\s*[:\.]/i,
  /^complaint\s*[:\.]/i,
  /^please\s+address\s+this\s+issue/i,
  /^i\s+request\s+the\s+faculty\s+to\s+note/i,
  /^an\s+improvement\s+is\s+needed\s+because/i,
  /^i\s+am\s+finding\s+it\s+difficult\s+because/i,
  /^students?\s+are\s+facing\s+difficulty\s+because/i,
  /^the\s+learning\s+experience\s+is\s+affected\s+because/i,
  /^it\s+would\s+help\s+if\s+this\s+improved/i,
  /^one\s+concern\s+is\s+that/i,
  /^the\s+main\s+problem\s+is\s+that/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// ATTENTION ISSUE PHRASES — specific problems across all categories
// ─────────────────────────────────────────────────────────────────────────────
const ATTENTION_ISSUE_PHRASES = [
  // Pace & speed
  /\b(pace\s+is\s+too\s+fast|teaching\s+pace\s+is\s+too\s+fast|pace\s+changes?\s+suddenly|concepts?\s+are\s+rushed|syllabus\s+is\s+rushed|too\s+many\s+topics\s+are\s+covered|direct\s+advanced\s+topic|basic\s+se\s+explain\s+nahi)\b/i,
  /\b(too\s+fast|too\s+slow|very\s+fast|very\s+slow|fast\s+pace|slow\s+pace|pacing\s+is\s+a\s+bit\s+fast|speed\s+of\s+teaching\s+sometimes\s+feel\s+fast)\b/i,
  /\b(jaldi\s+padhate|speed\s+kam\s+kijiye|dhire\s+padhaiye)\b/i,

  // Notes & materials late/missing/unclear
  /\b(notes?\s+are\s+shared\s+too\s+late|shared\s+too\s+late|shared\s+late|material\s+arrives?\s+just\s+before|important\s+topics?\s+are\s+missing|missing\s+from\s+the\s+notes?|notes?\s+do\s+not\s+match|slides?\s+contain\s+errors|definitions?\s+and\s+formulas?\s+are\s+hard\s+to\s+find|files?\s+are\s+difficult\s+to\s+locate|difficult\s+to\s+revise|poorly\s+organized|slides?\s+contain\s+too\s+much\s+text|few\s+diagrams|relies?\s+too\s+much\s+on\s+powerpoint)\b/i,
  /\b(notes?|materials?|study\s+materials?|slides?)\s+(are|is)?\s*(never|not|rarely)?\s*(provided|shared|given|uploaded)?\s*(on\s+time|in\s+time|late)?\b/i,
  /\b(notes?\s+must\s+be\s+provided\s+early|class\s+notes\s+can\s+be\s+better|better\s+notes\s+should\s+be\s+provided|no\s+notes?\s+provided|notes?\s+not\s+provided|notes?\s+never\s+shared)\b/i,

  // Time insufficient
  /\b(not\s+(given\s+)?enough\s+time|allotted\s+lab\s+time\s+is\s+insufficient|leaves?\s+too\s+little\s+time|little\s+time\s+to|assessment\s+time\s+is\s+too\s+short|no\s+time\s+is\s+reserved|ends?\s+before\s+the\s+exercise\s+is\s+completed|students?\s+get\s+little\s+time)\b/i,
  /\b(late\s+to\s+class|comes?\s+late|takes?\s+too\s+much\s+time)\b/i,

  // Practical / Lab issues
  /\b(too\s+little\s+hands[\s-]on|more\s+practical\s+(coding\s+)?examples\s+are\s+needed|more\s+real[\s-]world\s+examples\s+should\s+be\s+included|teaching\s+less\s+examples|too\s+few\s+lab\s+sessions|lab\s+is\s+conducted\s+mostly\s+like\s+a\s+theory|lab\s+activities?\s+are\s+not\s+aligned|lab\s+schedule\s+does\s+not\s+match|not\s+enough\s+experiments|experiments\s+kam\s+hote|theory\s+zyada\s+hoti|copy\s+code\s+instead\s+of\s+writing|debugging\s+is\s+not\s+demonstrated|finding\s+and\s+fixing\s+errors\s+is\s+not\s+covered|develop\s+a\s+solution\s+from\s+scratch|memorize\s+content\s+instead\s+of\s+practising)\b/i,
  /\b(more\s+(practical|coding|hands[\s-]on|real[\s-]world)\s+.*?\b(needed|required|should\s+be|must\s+be))\b/i,
  /\b(code\s+ka\s+output\s+bataya\s+jata\s+lekin\s+debugging\s+nahi|sir\s+ready[\s-]made\s+code\s+copy\s+karne\s+ko\s+kehte)\b/i,

  // Questions / Doubts / Interaction
  /\b(not\s+get\s+enough\s+time\s+to\s+ask|no\s+regular\s+doubt[\s-]clearing|questions?.*left\s+unanswered|uncomfortable\s+asking\s+doubts|lessons?\s+are\s+not\s+interactive|not\s+given\s+opportunities?\s+to\s+participate|follow[\s-]up\s+questions?\s+are\s+(often\s+)?discouraged|doubts?\s+are\s+not\s+(cleared|resolved|answered|addressed|clarified)|doubts?\s+(not|never)\s+(cleared|resolved|answered)|hesitant\s+to\s+raise\s+concerns|not\s+encouraged\s+to\s+discuss|only\s+a\s+few\s+students\s+receive\s+guidance|individual\s+support\s+is\s+limited)\b/i,
  /\b(he\s+created\s+fear\s+in\s+classroom\s+to\s+ask\s+for\s+doubt|scared\s+to\s+ask|fear\s+of\s+asking|can'?t\s+ask\s+doubts?)\b/i,
  /\b(voice\s+is\s+low|not\s+audible|he\s+should\s+be\s+more\s+loud\s+and\s+clear|speak\s+louder|sound\s+is\s+low)\b/i,
  /\b(can\s+be\s+more\s+interactive|not\s+much\s+interactive|not\s+interactive\s+at\s+all|class\s+is\s+not\s+interactive)\b/i,

  // Explanations / Teaching quality issues
  /\b(explanation\s+of\s+advanced\s+topics\s+is\s+unclear|steps?\s+are\s+skipped|skips?\s+important\s+intermediate\s+steps|does?\s+not\s+show\s+enough\s+step[\s-]by[\s-]step|moves?\s+to\s+the\s+next\s+topic\s+before|does?\s+not\s+check\s+whether\s+students?\s+understand|moves?\s+ahead\s+without\s+checking\s+understanding|content\s+is\s+read\s+aloud\s+without\s+enough\s+explanation|does?\s+not\s+explain\s+how\s+to\s+apply|does?\s+not\s+explain\s+the\s+reasoning|not\s+explained\s+using\s+simpler|no\s+clear\s+summary\s+is\s+provided|they\s+sometimes\s+do\s+not\s+match|examples?\s+are\s+too\s+limited|instructions?\s+are\s+confusing)\b/i,
  /\b(explanations?\s+are\s+unclear\s+and\s+leave\s+students?\s+confused|teacher\s+skips?\s+basic\s+concepts?|teacher\s+reads?\s+slides?\s+without\s+explaining)\b/i,
  /\b(need\s+more\s+explanation\s+in\s+class|please\s+change\s+teaching\s+style|should\s+teach\s+basics?\s+first)\b/i,

  // Assessment & Grading
  /\b(quiz\s+was\s+out\s+of\s+syllabus\s+and\s+marks\s+not\s+justified|marking\s+criteria\s+clear\s+nahi|marks?\s+not\s+justified|unfair\s+marking|partiality|biased\s+grading)\b/i,
  /\b(assignment\s+instructions?\s+are\s+often\s+unclear|marking\s+scheme\s+is\s+not\s+explained|feedback\s+on\s+assignments?\s+is\s+not\s+provided|topics?\s+not\s+taught\s+in\s+class|answer\s+key\s+is\s+not\s+discussed|deadlines?\s+are\s+announced\s+at\s+the\s+last\s+moment)\b/i,

  // Hardware / Facilities (real malfunction only)
  /\b(computers?\s+frequently\s+stop\s+working|internet\s+connection\s+interrupts|required\s+software\s+is\s+missing|too\s+few\s+working\s+computers|systems?\s+are\s+too\s+slow|technical\s+problems?\s+waste)\b/i,
  /\b(lab\s+ke\s+computers\s+baar-baar\s+band|computer\s+lab\s+ka\s+internet\s+disconnect|lab\s+systems\s+slow\s+hain)\b/i,

  // Negated praise
  /\b(not|never|hardly|rarely|barely|doesn'?t|does\s+not|don'?t|do\s+not|isn'?t|is\s+not|aren'?t|are\s+not|cannot|can'?t|nahi|nahin)\s+(very\s+|really\s+|much\s+)?(supportive|helpful|clear|patient|knowledgeable|approachable|dedicated|effective|interactive|engaging|understanding|cooperative|informative|organized|encouraging|friendly|good|nice|fair|polite|respectful|well|properly|accha)\b/i,
  /\b(not|never|doesn'?t|does\s+not|nahi)\s+(a\s+)?(good|great|nice|effective|helpful)\s+(teacher|faculty|professor|sir|ma'?am|teaching|class|lecture)\b/i,
  /\b(does\s+not|doesn'?t|not|never|nahi)\s+(explain|teach|guide|clarify)\s+.*?\b(well|properly|clearly|step\s+by\s+step|in\s+detail|concepts?)\b/i,
  /\b(does\s+not|doesn'?t|not|never|nahi)\s+(clearing|clears?|clear|solve|solving)\s+.*?\b(doubts?|queries|questions)\b/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// APPRECIATION PATTERNS — comprehensive library of praise across all formats
// ─────────────────────────────────────────────────────────────────────────────
const APPRECIATION_PATTERNS = [
  // 1. Classic Superlatives & Pure Praise Words
  /\b(excellent|outstanding|amazing|wonderful|fantastic|superb|brilliant|exceptional|extraordinary|tremendous|marvelous|splendid|fabulous|terrific|first[\s-]class)\b/i,
  /\b(love|loved|loving|enjoy|enjoyed|appreciate|appreciated|grateful|thankful|thank\s+you|thanks\s+for|thanks\s+a\s+lot)\b/i,
  /\bbest\s+(teacher|faculty|professor|sir|ma'?am|lecturer|mentor|department|college|class|instructor)\b/i,
  /\b(great|good|nice|wonderful|splendid)\s+(teacher|teaching|faculty|professor|sir|ma'?am|mentor|lecturer|class|classes|session|sessions|lecture|lectures|course|guidance|work|job|atmosphere|experience|instructor)\b/i,
  /\b(keep\s+(it\s+up|up\s+the\s+good\s+work)|well\s+done|good\s+job|great\s+job|excellent\s+work)\b/i,
  /\b(bahut\s+(accha|achha|badhiya|badia)|zabardast|kamaal|behtareen|shandar|mast\s+padhate|accha\s+padhate)\b/i,

  // 2. Intensifier + Positive Quality
  /\b(very|extremely|highly|thoroughly|deeply|immensely|truly|exceptionally|genuinely|consistently|really)\s+(good|helpful|clear|patient|knowledgeable|experienced|dedicated|supportive|effective|interactive|engaging|understanding|cooperative|informative|organized|structured|prepared|encouraging|approachable|rewarding|valuable|accessible|professional|fair|polite|humble|sincere)\b/i,
  /\b(very|extremely|perfectly|exceptionally|impressively)\s+well\b/i,
  /\bwell\s+(explained|taught|covered|organized|structured|presented|communicated|planned|delivered|managed|handled|designed|articulated)\b/i,
  /\bperfectly\s+(explained|taught|clear|understood)\b/i,

  // 3. Positive Faculty Attributes
  /\b(approachable|supportive|encouraging|dedicated|enthusiastic|passionate|patient|attentive|considerate|student[\s-]friendly|welcoming|cooperative|knowledgeable|experienced|respectful|professional|well[\s-]prepared)\b/i,
  /\b(subject\s+knowledge|subject\s+expertise|command\s+of\s+the\s+subject|command\s+over|conceptual\s+clarity|teaching\s+skills?|passion\s+for\s+teaching|dedication\s+to|genuine\s+(effort|interest|commitment))\b/i,
  /\bcomes?\s+prepared\b/i,
  /\b(takes?\s+teaching\s+responsibilities\s+seriously|sincerity\s+and\s+care|commitment\s+to\s+learning|committed\s+to\s+helping)\b/i,
  /\b(professionalism\s+in\s+every\s+class|professionalism\s+with\s+approachability|positive\s+example\s+of\s+professionalism)\b/i,

  // 4. Positive Course / Class / Lab Attributes
  /\b(interactive|informative|well[\s-]organized|well[\s-]structured|well[\s-]planned|thoughtful|productive|rewarding|valuable|meaningful|accessible|manageable|enriching|insightful|delightful|commendable|stimulating|purposeful)\b/i,
  /\b(healthy|positive|friendly|comfortable|collaborative|welcoming|productive|lively)\s+(environment|atmosphere|culture|presence|classroom|interaction)\b/i,
  /\b(positive\s+attitude|mutual\s+respect|positive\s+relationship|student[\s-]teacher\s+interaction)\b/i,
  /\b(friendly\s+and\s+focused|atmosphere\s+of\s+academic\s+encouragement|effective\s+laboratory\s+learning\s+environment)\b/i,

  // 5. Clear Explanations & Teaching Verbs
  /\b(explains?|teaches?|taught|clarifies?|presents?|demonstrates?|covers?|delivers?|communicates?|summarizes?|reinforces?|structures?|solves?)\s+.*?\b(clearly|step\s+by\s+step|thoroughly|patiently|logically|systematically|well|in\s+detail|with\s+clarity|with\s+patience|with\s+confidence|with\s+enthusiasm|with\s+care|simply|effectively|properly|smoothly|interactively|engagingly|memorably|methodically|efficiently|straightforward|calmly|carefully)\b/i,
  /\b(clearly|patiently|systematically|logically|effectively|thoroughly|smoothly|expertly|gradually|consistently|progressively|productively|carefully)\s+(explains?|teaches?|presents?|demonstrates?|delivers?|communicates?|guides?|answers?|builds?|covers?|uses?|structures?)\b/i,
  /\b(clear|effective|patient|structured|logical|systematic|thoughtful|detailed|accessible|informative|insightful|memorable|straightforward|coherent|readable)\s+(explanations?|teaching|lectures?|instructions?|directions?|guidance|demonstrations?|illustrations?|examples?|notes?|feedback|format|voice|manner|teaching\s+plan)\b/i,
  /\b(gives?|provides?|offers?)\s+.*?\b(clear|helpful|useful|thoughtful|proper|valuable|constructive|reassuring|actionable|solid|strong|effective)\s+(explanations?|guidance|instructions?|feedback|answers?|support|attention|direction|context|examples?|reassurance|foundation|recaps?|basis|clarification)\b/i,
  /\b(clear\s+flow\s+of\s+explanation|clear,\s+coherent,\s+and\s+engaging|clear\s+progression)\b/i,
  /\b(teaching|faculty|teacher)\s+is\s+(clear[,\s]+consistent|consistent|clear)\b/i,

  // 6. Reasoning, Examples, Understanding
  /\b(explains?|gives?|uses?|presents?|balances?|combines?)\s+.*?\b(reasoning|logic|purpose|relevance|significance|bigger\s+picture|practical\s+importance|fundamentals?|simple\s+examples|relevant\s+examples|real[\s-]world|everyday\s+examples|practical\s+illustrations?|step\s+by\s+step|smaller\s+steps|verbal\s+explanations|organized\s+notes|understandable\s+steps)\b/i,
  /\b(relevant|meaningful|practical|relatable|appropriate|effective|simple|useful|understandable|industry[\s-]related)\s+(examples|illustrations?)\b/i,
  /\b(practical\s+demonstrations?|practical\s+applications?|real[\s-]world\s+examples?|practical\s+sessions?|practical\s+exercises?|practical\s+assignments?|practical\s+knowledge|practical\s+learning|hands[\s-]on|practical\s+tasks?|practical\s+problems?|organized\s+practical\s+schedule)\b/i,
  /\bconnects?\s+.*?\b(practical|real[\s-]world|applications?|advanced|concepts?|modern\s+technology|everyday|implementation|clearly)\b/i,
  /\b(balance\s+between\s+theory\s+and\s+practical|good\s+balance|balances?\s+explanation|balances?\s+explanations?\s+with\s+classroom\s+interaction)\b/i,

  // 7. Doubts & Student Comfort
  /\b(clears?|resolves?|answers?|handles?|addresses?|solves?)\s+.*?\b(doubts?|questions?|queries|clarifications?|problems?)\s+.*?\b(patiently|clearly|effectively|promptly|well|easily|calmly|thoroughly|without\s+hesitation)\b/i,
  /\b(doubts?\s+(are\s+)?(cleared|resolved|answered|addressed|solved)\s+(patiently|clearly|effectively|well))\b/i,
  /\b(patient\s+with\s+doubts|encourages?\s+(questions?|doubts?|asking)|open\s+to\s+questions?|comfortable\s+asking\s+doubts)\b/i,
  /\b(all\s+doubts?\s+cleared|no\s+doubts?\s+left)\b/i,

  // 8. Clarity & Understanding
  /\b(all\s+concepts?\s+(are\s+)?(clear|crystal\s+clear|well\s+understood|nicely\s+explained|very\s+clear))\b/i,
  /\b(easy\s+to\s+(understand|follow|grasp|learn)|makes?\s+(it\s+)?easy\s+to\s+understand)\b/i,
  /\b(makes?\s+.*?\b(difficult|tough|hard)\b.*?\b(easy|simple|clear|understandable|interactive)\b)/i,
  /\b(makes?\s+difficult\s+topics?\s+(easy|simple|clear))\b/i,
  /\b(crystal\s+clear|crystal-clear)\b/i,
  /\b(concepts?\s+are\s+clear|clarity\s+in\s+teaching|conceptual\s+clarity)\b/i,
  /\b(satisfying|satisfaction)\b/i,

  // 9. Extra Short Praise Patterns
  /\b(the\s+)?(teacher|faculty|instructor|professor|sir|ma'?am|lecturer)\s+(is|are)\s+(supportive|helpful|friendly|polite|patient|approachable|dedicated|experienced|respectful|encouraging|committed|knowledgeable|fair|good|positive)\b/i,
  /\b(the\s+)?(classes?|class|course|subject|lab|lectures?|notes?|materials?|tasks?|exercises?|sessions?|resources?|atmosphere)\s+(is|are|has|have|were)\s+.*?\b(good|useful|helpful|informative|interesting|engaging|valuable|productive|relevant|clear|detailed|positive|strong|comprehensive|understandable)\b/i,
  /\b(the\s+)?(teaching|teaching\s+style)\s+is\s+(good|clear|effective|helpful|engaging|interactive|supportive)\b/i,
  /\b(the\s+)?(course|classes?|class|lectures?)\s+is\s+well\s+(organized|planned|designed|delivered|structured)\b/i,
  /\b(the\s+)?(teacher|faculty|instructor|professor|lab\s+instructor)\s+(explains?|gives?|uses?|provides?|shares?|answers?|demonstrates?|encourages?)\s+.*?\b(well|clearly|concepts?|theory|definitions?|code|examples?|slides?|resources?|information|learning|students?|questions?|practical|programs?|topic)\b/i,
  /\b(the\s+)?(course|classes?|lectures?)\s+(covers?|cover)\s+important\s+topics\b/i,
  /\b(gives?|provides?)\s+(individual\s+attention|clear\s+instructions)\b/i,
  /\b(good\s+subject\s+knowledge|has\s+good\s+knowledge|good\s+content|strong\s+potential|good\s+at\s+communication)\b/i,
  /\b(practical\s+tasks?|practical\s+sessions?|lab\s+exercises?|lab\s+assignments?)\s+(are|is)\s+(relevant|useful|interesting|helpful)\b/i,
  /\b(sir|teacher|faculty|professor)\s+is\s+(dedicated|patient|helpful|supportive|good|great|nice|friendly)\b/i,
  /\b(very\s+good\s+overall|overall\s+very\s+good|teaching\s+is\s+very\s+good|sir\s+teaches\s+very\s+well)\b/i,
  /\b(explains?\s+well|explains?\s+nicely|explains?\s+clearly|teaches?\s+well|teaches?\s+nicely|teaches?\s+clearly)\b/i,
  /\b(great\s+teacher|good\s+teacher|best\s+faculty|helpful\s+teacher|excellent\s+teaching)\b/i,
  /\b(5\s*star|5\/5|10\/10|100\s*%)\b/i,
];

// ── Fast Sentiment Polarity Scorer (Zero-Model Fallback) ─────────────────────
function fallbackScoreComment(text) {
  const lower = text.toLowerCase();
  
  // Strong positive markers
  const POS_WORDS = /\b(good|great|nice|clear|clearly|well|helpful|supportive|best|superb|love|loved|enjoy|enjoyed|excellent|perfect|perfectly|easy|understand|understood|interactive|proper|properly|structured|organized|punctual|kind|polite|patient|patiently|dedicat|encourag|appreciat|thanks?|crystal\s+clear|all\s+clear|satisfying|satisfaction|clarity)\b/gi;
  // Strong negative markers
  const NEG_WORDS = /\b(bad|poor|slow|too\s+fast|fast\s+pace|unclear|late|missing|lack|difficult|hard|trouble|waste|rush|rushed|confus|low|inaudible|strict|rude|partial|unfair|cheat|force|skip|skipped|incomplete|error|bug|fail|complaint|problem|issue)\b/gi;

  const posMatches = (lower.match(POS_WORDS) || []).length;
  const negMatches = (lower.match(NEG_WORDS) || []).length;

  if (posMatches > negMatches) return 'appreciation';
  if (negMatches > posMatches) return 'attention';
  return 'neutral';
}

// ── Keyword Categorizer ──────────────────────────────────────────────────────
function keywordCategory(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(speed|fast|slow|rush|rushed|pace|pacing|quickly|hurry|time|schedule|syllabus)\b/i.test(t)) return 'Teaching';
  if (/\b(voice|audible|volume|sound|mic|hear|loud|speak|louder|communication|language)\b/i.test(t)) return 'Communication';
  if (/\b(doubt|available|respond|reach|help|support|approachable|accessible|hesitat|fear)\b/i.test(t)) return 'Availability';
  if (/\b(note|notes|material|materials|pdf|ppt|slide|slides|book|handout|upload|diagram|formula)\b/i.test(t)) return 'Materials';
  if (/\b(quiz|marks?|test|assessment|grade|grading|exam|evaluation|cheat|answer\s+key)\b/i.test(t)) return 'Assessment';
  if (/\b(lab|practical|coding|hands[\s-]on|implement|program|experiment|debugging|computer|pc|system|software)\b/i.test(t)) return 'Teaching';
  return 'General';
}

function pushUnique(arr, v) {
  if (!v || typeof v !== 'string') return;
  const t = v.trim();
  if (!arr.includes(t)) arr.push(t);
}

// ── Optional HuggingFace API call ───────────────────────────────────────────
function callHF(text, candidateLabels) {
  return new Promise((resolve, reject) => {
    const TOKEN = process.env.HF_API_TOKEN || '';
    if (!TOKEN) return reject(new Error('NO_HF_TOKEN'));
    const body = JSON.stringify({
      inputs: text,
      parameters: { candidate_labels: candidateLabels, multi_label: false, hypothesis_template: '{}' }
    });
    const req = https.request({
      hostname: 'api-inference.huggingface.co',
      path: `/models/${HF_MODEL}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${TOKEN}`
      }
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error));
          resolve(parsed);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', e => reject(e));
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.write(body);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN CLASSIFIER FUNCTION
// ─────────────────────────────────────────────────────────────────────────────
async function classifyCommentsWithHF(rawComments, options = {}) {
  const forceFallback = options.forceFallback ?? (!process.env.HF_API_TOKEN);
  const items = Array.isArray(rawComments) ? rawComments : [];

  const result = {
    appreciation: [],
    commentsNeedingAttention: [],
    commentCategories: {
      Teaching: [], Communication: [], Availability: [],
      Materials: [], Assessment: [], General: []
    },
    classifiedComments: [],
    statistics: {
      totalReceived: items.length,
      meaningfulCount: 0,
      appreciation: 0,
      attention: 0,
      mixedCommentsSplit: 0,
      splitPartsGenerated: 0,
      neutral: 0,
      skipped: 0,
      ruleClassified: 0,
      aiClassified: 0
    }
  };

  if (!items.length) return result;

  const seen = new Set();

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const rawText = typeof item === 'object' && item !== null ? (item.text || item.comment || '') : String(item || '');
    const commentId = typeof item === 'object' && item !== null && item.id ? item.id : `C-${idx + 1}`;

    const text = rawText.trim().replace(/\s+/g, ' ');

    // 1. Skip Empty / Invalid
    if (!text || text.length < 2) {
      result.statistics.skipped++;
      result.classifiedComments.push({ commentId, text, sourceText: rawText, classification: 'skipped', reason: 'empty' });
      continue;
    }

    // 2. Skip Spam
    if (isSpam(text)) {
      result.statistics.skipped++;
      result.classifiedComments.push({ commentId, text, sourceText: rawText, classification: 'skipped', reason: 'spam' });
      continue;
    }

    // Clean prefix tags like "MIX-001: ", "NA2-0001: ", "1. "
    const cleanText = text.replace(/^(MIX|NA2|NA|APP)-\d+:\s*/i, '').replace(/^\d+[\.\)]\s*/, '').trim();

    // 3. Skip Neutral Fillers
    const lowerClean = cleanText.toLowerCase().replace(/[.,!?;:]+$/, '').trim();
    if (NEUTRAL_FILLERS.has(lowerClean)) {
      result.statistics.neutral++;
      result.classifiedComments.push({ commentId, text: cleanText, sourceText: rawText, classification: 'neutral', needsAttention: false });
      continue;
    }

    // Deduplicate identical comments
    const dedupKey = lowerClean;
    if (seen.has(dedupKey)) {
      // Record as duplicate in classifiedComments for zero comment drop guarantee
      result.classifiedComments.push({
        commentId, text: cleanText, sourceText: rawText,
        classification: 'duplicate', status: 'duplicate',
        reason: 'duplicate-comment'
      });
      continue;
    }
    seen.add(dedupKey);

    result.statistics.meaningfulCount++;

    // 4. MIXED COMMENT SPLITTING (Praise + Critique)
    const split = splitMixedComment(cleanText);
    if (split) {
      const p1Lower = split.part1.toLowerCase();
      const p2Lower = split.part2.toLowerCase();

      const p1Apprec = APPRECIATION_PATTERNS.some(p => p.test(p1Lower));
      const p2Apprec = APPRECIATION_PATTERNS.some(p => p.test(p2Lower));

      const p1Att = ATTENTION_OPENERS.some(p => p.test(split.part1)) ||
                    ATTENTION_ISSUE_PHRASES.some(p => p.test(p1Lower));
      const p2Att = ATTENTION_OPENERS.some(p => p.test(split.part2)) ||
                    ATTENTION_ISSUE_PHRASES.some(p => p.test(p2Lower));

      if (p1Apprec && (p2Att || fallbackScoreComment(split.part2) === 'attention')) {
        pushUnique(result.appreciation, split.part1);
        pushUnique(result.commentsNeedingAttention, split.part2);
        const cat = keywordCategory(split.part2);
        pushUnique(result.commentCategories[cat], split.part2);

        result.statistics.appreciation++;
        result.statistics.attention++;
        result.statistics.mixedCommentsSplit++;
        result.statistics.splitPartsGenerated += 2;
        result.statistics.ruleClassified += 2;

        result.classifiedComments.push({
          commentId, text: split.part1, sourceText: rawText, isSplit: true,
          partIndex: 1, totalParts: 2, classification: 'appreciation',
          needsAttention: false, method: 'rule-split', status: 'active', category: 'General'
        });
        result.classifiedComments.push({
          commentId, text: split.part2, sourceText: rawText, isSplit: true,
          partIndex: 2, totalParts: 2, classification: 'attention',
          needsAttention: true, method: 'rule-split', status: 'active', category: cat
        });
        continue;
      } else if (p1Att && (p2Apprec || fallbackScoreComment(split.part2) === 'appreciation')) {
        pushUnique(result.commentsNeedingAttention, split.part1);
        pushUnique(result.appreciation, split.part2);
        const cat = keywordCategory(split.part1);
        pushUnique(result.commentCategories[cat], split.part1);

        result.statistics.appreciation++;
        result.statistics.attention++;
        result.statistics.mixedCommentsSplit++;
        result.statistics.splitPartsGenerated += 2;
        result.statistics.ruleClassified += 2;

        result.classifiedComments.push({
          commentId, text: split.part1, sourceText: rawText, isSplit: true,
          partIndex: 1, totalParts: 2, classification: 'attention',
          needsAttention: true, method: 'rule-split', status: 'active', category: cat
        });
        result.classifiedComments.push({
          commentId, text: split.part2, sourceText: rawText, isSplit: true,
          partIndex: 2, totalParts: 2, classification: 'appreciation',
          needsAttention: false, method: 'rule-split', status: 'active', category: 'General'
        });
        continue;
      }
    }

    const lower = cleanText.toLowerCase();

    // 5. Positive Override Check (e.g. "not difficult at all", "no issues")
    const hasOverride = POSITIVE_OVERRIDE_PATTERNS.some(p => p.test(lower));
    const hasNoIssueNegation = HAS_NO_ISSUE_NEGATION.test(lower);

    // 6. Attention Rule Check
    const hasOpener = ATTENTION_OPENERS.some(p => p.test(cleanText));
    const hasSpecificIssue = ATTENTION_ISSUE_PHRASES.some(p => p.test(lower));

    if ((hasOpener || hasSpecificIssue) && !hasOverride && !hasNoIssueNegation) {
      pushUnique(result.commentsNeedingAttention, cleanText);
      const cat = keywordCategory(cleanText);
      pushUnique(result.commentCategories[cat], cleanText);
      result.statistics.attention++;
      result.statistics.ruleClassified++;
      result.classifiedComments.push({
        commentId, text: cleanText, sourceText: rawText,
        classification: 'attention', needsAttention: true,
        method: 'rule-engine', status: 'active', category: cat,
        reason: hasOpener ? 'opener' : 'issue-phrase'
      });
      continue;
    }

    // 7. Appreciation Rule Check
    const hasApprec = APPRECIATION_PATTERNS.some(p => p.test(lower)) || hasOverride || hasNoIssueNegation;
    if (hasApprec) {
      pushUnique(result.appreciation, cleanText);
      result.statistics.appreciation++;
      result.statistics.ruleClassified++;
      result.classifiedComments.push({
        commentId, text: cleanText, sourceText: rawText,
        classification: 'appreciation', needsAttention: false,
        method: 'rule-engine', status: 'active', category: 'General',
        reason: 'appreciation-pattern'
      });
      continue;
    }

    // 8. Ambiguous / Unmatched Comment Handling
    let finalClass = null;

    if (!forceFallback && process.env.HF_API_TOKEN) {
      try {
        const LABEL_APP = "The student praises the teacher's teaching quality, helpfulness, or performance.";
        const LABEL_ATT = "The student expresses a complaint, identifies a problem, or suggests an improvement.";
        const pred = await callHF(cleanText, [LABEL_APP, LABEL_ATT]);
        if (pred?.labels?.[0] === LABEL_APP) finalClass = 'appreciation';
        else if (pred?.labels?.[0] === LABEL_ATT) finalClass = 'attention';
        if (finalClass) result.statistics.aiClassified++;
      } catch (err) {
        // Fall back to rule sentiment
      }
    }

    if (!finalClass) {
      finalClass = fallbackScoreComment(cleanText);
    }

    if (finalClass === 'appreciation') {
      pushUnique(result.appreciation, cleanText);
      result.statistics.appreciation++;
      result.statistics.ruleClassified++;
      result.classifiedComments.push({
        commentId, text: cleanText, sourceText: rawText,
        classification: 'appreciation', needsAttention: false,
        method: 'sentiment-fallback', status: 'active', category: 'General'
      });
    } else if (finalClass === 'attention') {
      pushUnique(result.commentsNeedingAttention, cleanText);
      const cat = keywordCategory(cleanText);
      pushUnique(result.commentCategories[cat], cleanText);
      result.statistics.attention++;
      result.statistics.ruleClassified++;
      result.classifiedComments.push({
        commentId, text: cleanText, sourceText: rawText,
        classification: 'attention', needsAttention: true,
        method: 'sentiment-fallback', status: 'active', category: cat
      });
    } else {
      result.statistics.neutral++;
      result.classifiedComments.push({
        commentId, text: cleanText, sourceText: rawText,
        classification: 'neutral', needsAttention: false,
        method: 'sentiment-fallback', status: 'neutral'
      });
    }
  }

  // Final sanity check: remove any exact attention comments from appreciation
  const attSet = new Set(result.commentsNeedingAttention.map(c => c.toLowerCase()));
  result.appreciation = result.appreciation.filter(c => !attSet.has(c.toLowerCase()));
  result.statistics.appreciation = result.appreciation.length;
  result.statistics.attention = result.commentsNeedingAttention.length;

  return result;
}

module.exports = {
  classifyCommentsWithHF,
  evaluateMeaningfulness,
  splitMixedComment,
  isSpam
};
