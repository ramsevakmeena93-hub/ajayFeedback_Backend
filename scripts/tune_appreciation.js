const fs = require('fs');
const path = require('path');

const appreciationComments = fs.readFileSync(
  path.join(__dirname, '..', 'training_data', 'appreciation_1000.txt'), 'utf8'
).split('\n').map(l => l.trim()).filter(Boolean);

const APPRECIATION_PATTERNS = [
  // ── 1. Classic Superlatives & Pure Praise Words ──
  /\b(excellent|outstanding|amazing|wonderful|fantastic|superb|brilliant|exceptional|extraordinary|tremendous|marvelous|splendid|fabulous|terrific|first[\s-]class)\b/i,
  /\b(love|loved|loving|enjoy|enjoyed|appreciate|appreciated|grateful|thankful|thank\s+you|thanks\s+for)\b/i,
  /\bbest\s+(teacher|faculty|professor|sir|ma'?am|lecturer|mentor|department|college|class)\b/i,
  /\b(great|good|nice|wonderful|splendid)\s+(teacher|teaching|faculty|professor|sir|ma'?am|mentor|lecturer|class|classes|session|sessions|lecture|lectures|course|guidance|work|job|atmosphere|experience)\b/i,
  /\b(keep\s+(it\s+up|up\s+the\s+good\s+work)|well\s+done|good\s+job|great\s+job|excellent\s+work)\b/i,
  /\b(bahut\s+(accha|achha|badhiya|badia)|zabardast|kamaal|behtareen|shandar|mast\s+padhate)\b/i,

  // ── 2. Intensifier + Positive Quality ──
  /\b(very|extremely|highly|thoroughly|deeply|immensely|truly|exceptionally|genuinely|consistently|really)\s+(good|helpful|clear|patient|knowledgeable|experienced|dedicated|supportive|effective|interactive|engaging|understanding|cooperative|informative|organized|structured|prepared|encouraging|approachable|rewarding|valuable|accessible|professional|rewarding)\b/i,
  /\b(very|extremely|perfectly|exceptionally|impressively)\s+well\b/i,
  /\bwell\s+(explained|taught|covered|organized|structured|presented|communicated|planned|delivered|managed|handled|designed|articulated)\b/i,
  /\bperfectly\s+(explained|taught|clear|understood)\b/i,

  // ── 3. Positive Faculty / Teacher Attributes ──
  /\b(approachable|supportive|encouraging|dedicated|enthusiastic|passionate|patient|attentive|considerate|student[\s-]friendly|welcoming|cooperative|knowledgeable|experienced|respectful|professional|well[\s-]prepared)\b/i,
  /\b(subject\s+knowledge|subject\s+expertise|command\s+of\s+the\s+subject|command\s+over|conceptual\s+clarity|teaching\s+skills?|passion\s+for\s+teaching|dedication\s+to|genuine\s+(effort|interest|commitment))\b/i,
  /\bcomes?\s+prepared\b/i,
  /\b(takes?\s+teaching\s+responsibilities\s+seriously|sincerity\s+and\s+care|commitment\s+to\s+learning|committed\s+to\s+helping)\b/i,
  /\b(professionalism\s+in\s+every\s+class|professionalism\s+with\s+approachability|positive\s+example\s+of\s+professionalism)\b/i,

  // ── 4. Positive Course / Class / Lecture / Lab Attributes ──
  /\b(interactive|informative|well[\s-]organized|well[\s-]structured|well[\s-]planned|thoughtful|productive|rewarding|valuable|meaningful|accessible|manageable|enriching|insightful|delightful|commendable|stimulating|purposeful)\b/i,
  /\b(healthy|positive|friendly|comfortable|collaborative|welcoming|productive|lively)\s+(environment|atmosphere|culture|presence|classroom|interaction)\b/i,
  /\b(positive\s+attitude|mutual\s+respect|positive\s+relationship|student[\s-]teacher\s+interaction)\b/i,
  /\b(friendly\s+and\s+focused|atmosphere\s+of\s+academic\s+encouragement|effective\s+laboratory\s+learning\s+environment)\b/i,

  // ── 5. Clear Explanations & Effective Teaching Verbs ──
  /\b(explains?|teaches?|taught|clarifies?|presents?|demonstrates?|covers?|delivers?|communicates?|summarizes?|reinforces?|structures?|solves?)\s+.*?\b(clearly|step\s+by\s+step|thoroughly|patiently|logically|systematically|well|in\s+detail|with\s+clarity|with\s+patience|with\s+confidence|with\s+enthusiasm|with\s+care|simply|effectively|properly|smoothly|interactively|engagingly|memorably|methodically|efficiently|straightforward|calmly|carefully)\b/i,
  /\b(clearly|patiently|systematically|logically|effectively|thoroughly|smoothly|expertly|gradually|consistently|progressively|productively|carefully)\s+(explains?|teaches?|presents?|demonstrates?|delivers?|communicates?|guides?|answers?|builds?|covers?|uses?|structures?)\b/i,
  /\b(clear|effective|patient|structured|logical|systematic|thoughtful|detailed|accessible|informative|insightful|memorable|straightforward|coherent|readable)\s+(explanations?|teaching|lectures?|instructions?|directions?|guidance|demonstrations?|illustrations?|examples?|notes?|feedback|format|voice|manner|teaching\s+plan)\b/i,
  /\b(gives?|provides?|offers?)\s+.*?\b(clear|helpful|useful|thoughtful|proper|valuable|constructive|reassuring|actionable|solid|strong|effective)\s+(explanations?|guidance|instructions?|feedback|answers?|support|attention|direction|context|examples?|reassurance|foundation|recaps?|basis|clarification)\b/i,
  /\b(clear\s+flow\s+of\s+explanation|clear,\s+coherent,\s+and\s+engaging|clear\s+progression)\b/i,
  /\b(teaching|faculty|teacher)\s+is\s+(clear[,\s]+consistent|consistent|clear)\b/i,

  // ── 6. Positive Reasoning, Examples & Depth ──
  /\b(explains?|gives?|uses?|presents?|balances?|combines?)\s+.*?\b(reasoning|logic|purpose|relevance|significance|bigger\s+picture|practical\s+importance|fundamentals?|simple\s+examples|relevant\s+examples|real[\s-]world|everyday\s+examples|practical\s+illustrations?|step\s+by\s+step|smaller\s+steps|verbal\s+explanations|organized\s+notes|understandable\s+steps)\b/i,
  /\b(relevant|meaningful|practical|relatable|appropriate|effective|simple|useful|understandable|industry[\s-]related)\s+(examples|illustrations?)\b/i,
  /\b(practical\s+demonstrations?|practical\s+applications?|real[\s-]world\s+examples?|practical\s+sessions?|practical\s+exercises?|practical\s+assignments?|practical\s+knowledge|practical\s+learning|hands[\s-]on|practical\s+tasks?|practical\s+problems?|organized\s+practical\s+schedule)\b/i,
  /\bconnects?\s+.*?\b(practical|real[\s-]world|applications?|advanced|concepts?|modern\s+technology|everyday|implementation|clearly)\b/i,
  /\b(balance\s+between\s+theory\s+and\s+practical|good\s+balance|balances?\s+explanation|balances?\s+explanations?\s+with\s+classroom\s+interaction)\b/i,

  // ── 7. Makes Things Easy / Understandable / Engaging ──
  /\bmakes?\s+.*?\b(easier|easy|simple|simpler|clear|interesting|manageable|accessible|engaging|enjoyable|understandable|worthwhile|memorable|comfortable|interactive|productive|intuitive|relatable|purposeful|collaborative|straightforward|discussions?\s+relevant|each\s+discussion\s+relevant)\b/i,
  /\bbecome[s]?\s+(easier|easy|simple|manageable|clear|interesting|intuitive)\b/i,
  /\b(easy|easier|simple)\s+to\s+(understand|follow|grasp|learn|remember|revise|recall|visualize|process|comprehend)\b/i,
  /\beasy[\s-]to[\s-]follow\b/i,
  /\b(makes?\s+(students?|us|everyone)\s+(feel\s+)?(more\s+interested|interested|comfortable|confident|valued|respected|motivated|included))\b/i,

  // ── 8. Student Impact, Help & Growth ──
  /\b(helps?|supports?|motivates?|inspires?|encourages?|promotes?|guides?)\s+.*?\b(students?|us|learning|curiosity|participation|discussion|independent|thinking|confidence|understanding|foundation|skills?|progress|growth|curiosity|retention|experimentation|analytical|reasoning|problem[\s-]solving|exploration|creativity|active\s+thinking|logical\s+approaches?|careful\s+observation|careful\s+examination)\b/i,
  /\b(builds?|develops?|strengthens?|reinforces?|promotes?)\s+.*?\b(confidence|understanding|foundation|conceptual\s+clarity|strong\s+basics?|skills?|curiosity|independent|retention|progress|abilities|mindset|habits?|logical\s+reasoning|mathematical\s+concepts?)\b/i,
  /\b(understood|understand|understands?)\s+(everything|all|concepts?|logic|well|clearly|easily|process|fundamentals|topics?\s+more\s+deeply)\b/i,
  /\b(learned|learnt)\s+(a\s+lot|so\s+much|greatly|effectively|well)\b/i,
  /\b(improves?|improved)\s+(my|our|students?')?\s*(understanding|knowledge|skills?|confidence|learning|problem[\s-]solving|programming\s+confidence)\b/i,
  /\b(gives?\s+context\s+before|prepares?\s+students?\s+for\s+upcoming|gives?\s+students?\s+room)\b/i,

  // ── 9. Doubts & Questions Resolved Well ──
  /\b(clears?|clearing)\s+.*?\b(doubts?|queries|questions)\b/i,
  /\banswers?\s+.*?\b(doubts?|questions?|queries)\b/i,
  /\b(handles?\s+questions?|values?\s+questions?|values?\s+student\s+participation|welcoming\s+toward|welcomes?\s+different|listens?\s+carefully|responds?\s+thoughtfully|responds?\s+with\s+care|responds?\s+constructively|responds?\s+to\s+questions?\s+with\s+care\s+and\s+clarity)\b/i,
  /\b(comfortable|free|natural)\s+.*?\b(asking\s+questions|asking\s+doubts|sharing\s+doubts|participat)\b/i,
  /\b(shows?\s+patience|demonstrates?\s+patience|provides?\s+reassurance)\b/i,

  // ── 10. Learning Experience & Classroom Presence ──
  /\b(learning\s+experience|teaching\s+approach|teaching\s+style|teaching\s+method)\s+(is|are|has|makes?|provides?)\s+.*?\b(rewarding|positive|effective|practical|supportive|interactive|encouraging|student[\s-]friendly|engaging|meaningful|valuable|enriching)\b/i,
  /\b(overall[,\s]+.*?\b(excellent|good|rewarding|valuable|effective|learning\s+experience))\b/i,
  /\b(not\s+difficult|not\s+boring|never\s+boring|does\s+not\s+waste\s+time)\b/i,
  /\bwe\s+actually\s+(write|understand|code|apply|practice|learn|develop|run|implement)\b/i,

  // ── 11. Additional Specific Patterns for 1000 Dataset ──
  /\bin\s+(a\s+|an\s+)?(organized|focused|simple|logical|clear|systematic|structured|helpful|student[\s-]friendly|considerate|calm|understandable|practical|straightforward|friendly)\s+(manner|way|sequence|progression|order|voice)\b/i,
  /\b(in|with|using)\s+(a\s+)?(simple|understandable|accessible|clear).*?\b(language|words|terms|demonstrations?|steps|way)\b/i,
  /\bwith\s+(impressive|remarkable|exceptional|great|clear|practical|appropriate|useful|organized|care\s+and)\s+(clarity|patience|enthusiasm|relevance|context|insight|detail|steps|notes|emphasis|illustrations?|background|depth|demonstrations?)\b/i,
  /\bwith\s+attention\s+to\s+detail\b/i,
  /\b(making\s+it\s+easy|makes?\s+it\s+easy)\s+to\b/i,
  /\b(less\s+intimidating|without\s+rushing|without\s+unnecessary\s+complexity|without\s+losing|without\s+making\s+it\s+confusing|without\s+unnecessary\s+jargon)\b/i,
  /\bcontributes?\s+meaningfully\b/i,
  /\b(conceptual\s+foundation|conceptual\s+development|conceptual\s+understanding|conceptual\s+approach|conceptual\s+connections|conceptual\s+foundations?)\b/i,
  /\b(good\s+use\s+of\s+examples|good\s+use\s+of\s+classroom\s+time|uses?\s+examples\s+to\s+reinforce|uses?\s+examples\s+that\s+complement)\b/i,
  /\b(intellectually\s+stimulating|intellectually\s+engaging)\b/i,
  /\b(help\s+me\s+understand|helps?\s+me\s+remember|helps?\s+reinforce|helps?\s+clarify)\b/i,
  /\b(practical\s+relevance|practical\s+importance|practical\s+context|practical\s+value|practical\s+situations?)\b/i,
  /\b(solid\s+basis|solid\s+foundation|strong\s+basis|strong\s+foundation|strong\s+networking|strong\s+conceptual|solid\s+algorithmic|strong\s+understanding)\b/i,
  /\b(meaningful\s+context|meaningful\s+sequence|meaningful\s+exchange|meaningfully|practical\s+meaning)\b/i,
  /\b(active\s+engagement|active\s+listening|active\s+participation|active\s+thinking)\b/i,
  /\b(participate\s+(confidently|actively)|participat\w*\s+feel\s+natural|involves?\s+students|keeps?\s+students?\s+involved)\b/i,
  /\b(explore\s+concepts?|explore\s+new\s+ideas|explore\s+unfamiliar|think\s+beyond|think\s+aloud)\b/i,
  /\b(depth\s+and\s+clarity|clarity\s+and\s+purpose|clarity,\s+expertise|clarity\s+and\s+confidence|speaks?\s+with\s+clarity|energy\s+and\s+clarity|maintains?\s+clarity)\b/i,
  /\b(memorable\s+way|easy\s+to\s+recall|effective\s+explanations)\b/i,
  /\b(classroom\s+conversations|classroom\s+recaps|collaborative\s+learning)\b/i,
  /\b(academic\s+progress|academic\s+excellence|academic\s+confidence|academic\s+direction|academic\s+preparation|academic\s+development|academic\s+growth|academic\s+instructions?|constructive\s+academic\s+guidance)\b/i,
  /\b(reassuring\s+classroom\s+presence|welcoming\s+attitude|considerate\s+toward)\b/i,
  /\b(delivers?\s+informative\s+lectures|informative\s+lectures|informative\s+and\s+well)\b/i,
  /\b(teaches?\s+with\s+(patience|dedication|confidence|enthusiasm|care|sincerity))\b/i,
  /\b(brings?\s+(energy|valuable\s+knowledge)\s+to)\b/i,
  /\b(sets?\s+a\s+positive\s+academic\s+example|passion\s+for\s+teaching)\b/i,
  /\b(adapts?\s+explanations|focus\s+on\s+learning\s+outcomes|focus\s+on\s+learning|in\s+focus|keeps?\s+the\s+lecture\s+focused)\b/i,
  /\b(clarify\s+difficult|clarify\s+complicated|clarifies?\s+concepts?|reinforce\s+the\s+concepts|reinforces?\s+learning|reinforce\s+concepts|reinforce\s+key\s+ideas|reinforce\s+theoretical\s+ideas?)\b/i,
  /\b(explains?\s+.*?\bbefore\s+(introducing|detailed|implementing|independent|advanced))\b/i,
  /\b(add(s)?\s+value|positive\s+learning\s+difference)\b/i,
  /\b(work\s+in\s+practice|work\s+together|working\s+code)\b/i,
  /\b(guides?\s+students?\s+through|gives?\s+students?\s+confidence)\b/i,
  /\b(simple\s+demonstrations?|everyday\s+technology|diagrams\s+to\s+clarify|diagrams\s+to\s+explain|diagrams\s+useful)\b/i,
  /\b(useful\s+because|useful\s+programming|useful\s+illustrations?|useful\s+recaps?|useful\s+demonstrations?)\b/i,
  /\b(teaches?\s+in\s+a\s+calm|encourages?\s+experimentation)\b/i,
  /\b(understand\s+topics\s+more\s+deeply|connect\s+different\s+topics|connect\s+across\s+units)\b/i,
  /\b(understanding\s+over\s+rote|application[\s-]oriented\s+learning|solve\s+real\s+problems)\b/i,
  /\b(relatable\s+everyday|everyday\s+life|familiar\s+situations?|familiar\s+scenarios?|relatable\s+situations?)\b/i,
  /\b(clear\s+path\s+through\s+the\s+syllabus|steady\s+and\s+understandable|builds?\s+knowledge\s+progressively)\b/i,
  /\b(highlights?\s+important\s+concepts?|highlights?\s+the\s+connections)\b/i,
  /\b(uses?\s+(lecture|classroom)\s+time\s+productively|uses?\s+classroom\s+presentations?\s+effectively|effective\s+use\s+of\s+classroom\s+time|manages?\s+(lecture\s+)?time\s+effectively)\b/i,
  /\b(organizes?\s+(classroom\s+material|learning\s+resources?|information)\s+(thoughtfully|effectively|for\s+easy)|keeps?\s+the\s+learning\s+process\s+organized)\b/i,
  /\b(presents?\s+(learning\s+materials?|key\s+concepts?)\s+(professionally|using\s+organized))\b/i,
  /\b(more\s+intuitive|more\s+relatable|more\s+participatory|deeper\s+interest)\b/i,
  /\b(creates?\s+opportunities\s+for\s+students|integrates?\s+interaction)\b/i,
  /\b(effective\s+classroom\s+communication|coherent\s+and\s+engaging|coherent\s+whole|coherent\s+and\s+focused)\b/i,
  /\b(transparently|break\s+problems\s+into\s+steps|approaches?\s+to\s+solving\s+problems|multiple\s+approaches?|approach\s+unfamiliar\s+problems?)\b/i,
  /\b(precise\s+language|meaning\s+behind\s+important\s+terms)\b/i,
  /\b(engage\s+comfortably|respects?\s+different\s+learning|communicates?\s+expectations?\s+respectfully)\b/i,
  /\b(continuity\s+between\s+related\s+topics|consistent\s+teaching\s+structure|carefully\s+planned\s+sequence)\b/i,
  /\b(relationship\s+between\s+different\s+chapters|structure\s+of\s+each\s+lesson)\b/i,
  /\b(purposefully|combines?\s+examples?\s+and\s+explanations?\s+effectively|beyond\s+(their\s+)?basic\s+definitions?|beyond\s+surface[\s-]level)\b/i,
  /\b(why\s+each\s+method\s+is\s+useful|why\s+particular\s+methods?\s+are\s+effective|used\s+professionally|value\s+of\s+each\s+concept)\b/i,
  /\b(where\s+different\s+methods\s+can\s+be\s+used|relevant\s+beyond\s+examinations?|apply\s+in\s+real\s+projects?|in\s+context|relevant\s+to\s+real\s+applications?)\b/i,
  /\b(real\s+engineering\s+challenges?|useful\s+through\s+application|relevance\s+of\s+classroom\s+concepts?|applications?\s+alongside\s+theory)\b/i,
  /\b(an\s+important\s+part\s+of\s+learning|steps?\s+behind\s+complex\s+solutions?|communication\s+between\s+teacher\s+and\s+students?\s+effective|effective\s+part\s+of\s+teaching)\b/i,
  /\b(important\s+relationships?\s+between\s+ideas?|confident\s+examination\s+preparation|course\s+revision\s+more\s+effective|balanced\s+and\s+engaging)\b/i,
  /\b(demonstrates?\s+experiments?|principles?\s+behind|expected\s+outcomes?|and\s+their\s+functions?|through\s+demonstrations?|effective\s+preparation|effective\s+full[\s-]stack)\b/i,
  /\b(combines?\s+demonstration|builds?\s+mathematical\s+concepts?\s+from\s+the\s+fundamentals?|follows?\s+a\s+clear\s+and\s+organized)\b/i
];

let matched = 0;
const unmatched = [];
appreciationComments.forEach((c, idx) => {
  const isMatch = APPRECIATION_PATTERNS.some(p => p.test(c));
  if (isMatch) matched++;
  else unmatched.push({ idx: idx + 1, text: c });
});

console.log(`Matched: ${matched} / ${appreciationComments.length} (${(matched / appreciationComments.length * 100).toFixed(1)}%)`);
console.log(`Unmatched count: ${unmatched.length}`);
if (unmatched.length > 0) {
  console.log('Unmatched samples:');
  unmatched.slice(0, 30).forEach(u => console.log(`${u.idx}: "${u.text}"`));
}
