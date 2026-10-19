const fs = require('fs');
const path = require('path');

// 1. Extract tuned appreciation patterns
const tuneCode = fs.readFileSync(path.join(__dirname, 'tune_appreciation.js'), 'utf8');
const match = tuneCode.match(/const APPRECIATION_PATTERNS = \[([\s\S]*?)\];/);
const TUNED_APPREC = eval('[' + match[1] + ']');

const EXTRA_APPRECIATION = [
  /\b(the\s+)?(teacher|faculty|instructor|professor|sir|ma'?am|lecturer)\s+(is|are)\s+(supportive|helpful|friendly|polite|patient|approachable|dedicated|experienced|respectful|encouraging|committed|knowledgeable|fair|good|positive)\b/i,
  /\b(the\s+)?(classes?|class|course|subject|lab|lectures?|notes?|materials?|tasks?|exercises?|sessions?|resources?|atmosphere)\s+(is|are|has|have|were)\s+.*?\b(good|useful|helpful|informative|interesting|engaging|valuable|productive|relevant|clear|detailed|positive|strong|comprehensive|understandable)\b/i,
  /\b(the\s+)?(teaching|teaching\s+style)\s+is\s+(good|clear|effective|helpful|engaging|interactive|supportive)\b/i,
  /\b(the\s+)?(course|classes?|class|lectures?)\s+is\s+well\s+(organized|planned|designed|delivered|structured)\b/i,
  /\b(the\s+)?(teacher|faculty|instructor|professor|lab\s+instructor)\s+(explains?|gives?|uses?|provides?|shares?|answers?|demonstrates?|encourages?)\s+.*?\b(well|clearly|concepts?|theory|definitions?|code|examples?|slides?|resources?|information|learning|students?|questions?|practical|programs?|topic)\b/i,
  /\b(the\s+)?(course|classes?|lectures?)\s+(covers?|cover)\s+important\s+topics\b/i,
  /\b(gives?|provides?)\s+(individual\s+attention|clear\s+instructions)\b/i,
  /\b(good\s+subject\s+knowledge|has\s+good\s+knowledge|good\s+content|strong\s+potential|good\s+at\s+communication)\b/i,
  /\b(practical\s+tasks?|practical\s+sessions?|lab\s+exercises?|lab\s+assignments?)\s+(are|is)\s+(relevant|useful|interesting|helpful)\b/i,
];

const ALL_APPRECIATION = [...TUNED_APPREC, ...EXTRA_APPRECIATION];

// 2. Extra issue patterns
const NEW_ISSUE_PATTERNS = [
  // Pace & speed
  /\b(pace\s+is\s+too\s+fast|teaching\s+pace\s+is\s+too\s+fast|pace\s+changes?\s+suddenly|concepts?\s+are\s+rushed|syllabus\s+is\s+rushed|too\s+many\s+topics\s+are\s+covered|direct\s+advanced\s+topic|basic\s+se\s+explain\s+nahi)\b/i,
  // Notes & materials late/missing/unclear/errors
  /\b(notes?\s+are\s+shared\s+too\s+late|shared\s+too\s+late|shared\s+late|material\s+arrives?\s+just\s+before|important\s+topics?\s+are\s+missing|missing\s+from\s+the\s+notes?|notes?\s+do\s+not\s+match|slides?\s+contain\s+errors|definitions?\s+and\s+formulas?\s+are\s+hard\s+to\s+find|files?\s+are\s+difficult\s+to\s+locate|difficult\s+to\s+revise|poorly\s+organized|slides?\s+contain\s+too\s+much\s+text|few\s+diagrams|relies?\s+too\s+much\s+on\s+powerpoint)\b/i,
  // Time insufficient
  /\b(not\s+(given\s+)?enough\s+time|allotted\s+lab\s+time\s+is\s+insufficient|leaves?\s+too\s+little\s+time|little\s+time\s+to|assessment\s+time\s+is\s+too\s+short|no\s+time\s+is\s+reserved|ends?\s+before\s+the\s+exercise\s+is\s+completed|students?\s+get\s+little\s+time)\b/i,
  // Practical / Lab issues
  /\b(too\s+little\s+hands[\s-]on|more\s+practical\s+examples\s+are\s+needed|too\s+few\s+lab\s+sessions|lab\s+is\s+conducted\s+mostly\s+like\s+a\s+theory|lab\s+activities?\s+are\s+not\s+aligned|lab\s+schedule\s+does\s+not\s+match|not\s+enough\s+experiments|experiments\s+kam\s+hote|theory\s+zyada\s+hoti|copy\s+code\s+instead\s+of\s+writing|debugging\s+is\s+not\s+demonstrated|finding\s+and\s+fixing\s+errors\s+is\s+not\s+covered|develop\s+a\s+solution\s+from\s+scratch|memorize\s+content\s+instead\s+of\s+practising)\b/i,
  // Questions / Doubts / Interaction
  /\b(not\s+get\s+enough\s+time\s+to\s+ask|no\s+regular\s+doubt[\s-]clearing|questions?.*left\s+unanswered|uncomfortable\s+asking\s+doubts|lessons?\s+are\s+not\s+interactive|not\s+given\s+opportunities?\s+to\s+participate|follow[\s-]up\s+questions?\s+are\s+(often\s+)?discouraged|doubts?\s+are\s+not\s+resolved|hesitant\s+to\s+raise\s+concerns|not\s+encouraged\s+to\s+discuss|only\s+a\s+few\s+students\s+receive\s+guidance|individual\s+support\s+is\s+limited)\b/i,
  // Explanations / Teaching quality issues
  /\b(explanation\s+of\s+advanced\s+topics\s+is\s+unclear|steps?\s+are\s+skipped|skips?\s+important\s+intermediate\s+steps|does?\s+not\s+show\s+enough\s+step[\s-]by[\s-]step|moves?\s+to\s+the\s+next\s+topic\s+before|does?\s+not\s+check\s+whether\s+students?\s+understand|moves?\s+ahead\s+without\s+checking\s+understanding|content\s+is\s+read\s+aloud\s+without\s+enough\s+explanation|does?\s+not\s+explain\s+how\s+to\s+apply|does?\s+not\s+explain\s+the\s+reasoning|not\s+explained\s+using\s+simpler|no\s+clear\s+summary\s+is\s+provided|they\s+sometimes\s+do\s+not\s+match|examples?\s+are\s+too\s+limited|examples?\s+from\s+real[\s-]world.*rarely\s+included|instructions?\s+are\s+confusing)\b/i,
  // Hardware / Facilities
  /\b(computers?\s+frequently\s+stop\s+working|internet\s+connection\s+interrupts|required\s+software\s+is\s+missing|too\s+few\s+working\s+computers|sound\s+system\s+does\s+not\s+work|projector\s+display\s+is\s+difficult|speaks?\s+too\s+softly|difficulty\s+hearing|systems?\s+are\s+too\s+slow|technical\s+problems?\s+waste)\b/i,
  // Syllabus & Planning
  /\b(syllabus\s+was\s+not\s+completed|revision\s+is\s+skipped|no\s+revision\s+before|not\s+revised\s+before|prerequisite\s+concepts?\s+are\s+not\s+revised|schedule\s+changes?\s+are\s+communicated\s+too\s+late|important\s+announcements?\s+are\s+shared\s+late|syllabus\s+progress\s+is\s+not\s+communicated|important\s+units?\s+are\s+left\s+until\s+the\s+end)\b/i,
  // Assignments & Assessment
  /\b(assignment\s+instructions?\s+are\s+often\s+unclear|marking\s+scheme\s+is\s+not\s+explained|feedback\s+on\s+assignments?\s+is\s+not\s+provided|topics?\s+not\s+taught\s+in\s+class|answer\s+key\s+is\s+not\s+discussed|deadlines?\s+are\s+announced\s+at\s+the\s+last\s+moment|not\s+receive\s+clear\s+feedback|no\s+topic[\s-]wise\s+practice\s+questions|concerns?\s+are\s+not\s+followed\s+up|submission\s+requirements?\s+are\s+often\s+incomplete|criteria\s+for\s+awarding\s+marks\s+are\s+unclear|assessment\s+coverage\s+in\s+advance|instructions?\s+change\s+without\s+notice|not\s+receive\s+solutions|outside\s+the\s+announced\s+syllabus|feedback\s+does\s+not\s+explain\s+how\s+to\s+improve)\b/i
];

// Pivot regex for mixed comments
const MIXED_PIVOT_REGEX = /,\s+(?:but|however|although|though|yet)\s+|\s+(?:but|however)\s+|;\s*however,\s*/i;

function splitMixedComment(text) {
  const match = text.match(MIXED_PIVOT_REGEX);
  if (!match) return null;
  const pivotIdx = match.index;
  const part1 = text.substring(0, pivotIdx).trim().replace(/[,;\s]+$/, '');
  let part2 = text.substring(pivotIdx + match[0].length).trim();
  if (!part1 || !part2) return null;
  part2 = part2.charAt(0).toUpperCase() + part2.slice(1);
  return { part1, part2 };
}

// 3. Load datasets
const apprec1000 = fs.readFileSync(path.join(__dirname, '..', 'training_data', 'appreciation_1000.txt'), 'utf8')
  .split('\n').map(l => l.trim()).filter(Boolean);

const na1000 = fs.readFileSync(path.join(__dirname, '..', 'training_data', 'need_attention_1000.txt'), 'utf8')
  .split('\n').map(l => l.replace(/^NA2-\d+:\s*/i, '').trim()).filter(Boolean);

const mixed100 = fs.readFileSync(path.join(__dirname, '..', 'training_data', 'mixed_100.txt'), 'utf8')
  .split('\n').map(l => l.replace(/^MIX-\d+:\s*/i, '').trim()).filter(Boolean);

console.log('Testing Apprec 1000...');
let apprecMatches = 0;
let apprecUnmatched = [];
apprec1000.forEach((c, idx) => {
  if (ALL_APPRECIATION.some(p => p.test(c))) apprecMatches++;
  else apprecUnmatched.push({ idx: idx + 1, c });
});
console.log(`Apprec 1000: ${apprecMatches} / ${apprec1000.length} (${(apprecMatches/apprec1000.length*100).toFixed(1)}%)`);

console.log('Testing Mixed 100 Splitting...');
let mixedApprec = 0;
let mixedAtt = 0;
mixed100.forEach((m, idx) => {
  const split = splitMixedComment(m);
  if (split) {
    if (ALL_APPRECIATION.some(p => p.test(split.part1))) mixedApprec++;
    if (NEW_ISSUE_PATTERNS.some(p => p.test(split.part2))) mixedAtt++;
  }
});
console.log(`Mixed 100 Part1 Appreciation: ${mixedApprec} / ${mixed100.length}`);
console.log(`Mixed 100 Part2 Attention:    ${mixedAtt} / ${mixed100.length}`);
