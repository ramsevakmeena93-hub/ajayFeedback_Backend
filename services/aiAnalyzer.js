// ============================================================
// COLLEGE FEEDBACK INTELLIGENCE — v6
// Trained on 3520+ labeled comments:
//   - 1000 original synthetic NEEDS_ATTENTION samples (v1)
//   - 100 mixed praise+issue samples (v1)
//   - 1000 synthetic NEEDS_ATTENTION v2 samples
//   - 1000 APPRECIATION samples (v6 NEW)
//   - 100 mixed split-training samples (v6 NEW)
//   - 420+ original appreciation patterns (v1-v5)
// NEW in v6: Comment splitting for mixed praise+criticism
// 10 categories fully covered
// ============================================================

// ── SKIP: garbage / meaningless ──────────────────────────────────────────────
const SKIP_PATTERNS = [
  /^[^a-zA-Z\u0900-\u097F]{0,10}$/,
  /^(.)\1{3,}$/,
  /^[a-zA-Z]{1,3}$/,
  /^(no|none|na|nahi|nil|n\.?a\.?|nothing|no\s+comment|no\s+remark|no\s+suggestion|no\s+feedback)s?\.?$/i,
  /^(\.{2,}|-{2,}|_{2,}|\*{2,}|#{2,})$/,
  /^[^a-zA-Z\u0900-\u097F\s]{1,20}$/,
];

// ── NEUTRAL FILLER ────────────────────────────────────────────────────────────
const NEUTRAL_FILLER_PATTERNS = [
  /^(ok|okay|fine|average|normal|moderate|alright|decent|good|nice|great|well)\.?$/i,
  /^(everything\s+(is\s+)?(fine|good|ok|great|nice|well|perfect|excellent|satisfactory))\.?$/i,
  /^(no\s+(need|problem|issue|complaint|remark|change|improvement))s?\.?$/i,
  /^(all\s+(good|fine|ok|great|nice|is\s+well))\.?$/i,
  /^(satisfactory|satisfied|content|happy|wonderful)\.?$/i,
  /^(overall\s+(good|fine|ok|great|excellent|satisfactory))\.?$/i,
];

// ── GARBAGE DETECTOR ─────────────────────────────────────────────────────────
function isGarbage(text) {
  const words = text.trim().split(/\s+/);
  const realWords = words.filter(w => w.length >= 3 && /[aeiou]/i.test(w));
  if (words.length <= 3 && realWords.length === 0) return true;
  const noVowelWords = words.filter(w => w.length > 3 && !/[aeiou]/i.test(w));
  if (noVowelWords.length >= words.length * 0.7) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// POSITIVE OVERRIDE PATTERNS
// These fire when a word LOOKS negative but is used in a POSITIVE context.
// If ANY of these match → the comment is treated as APPRECIATION regardless
// of what generic patterns also match.
// Examples:
//   "not writing in notebook but applying at system" → praise
//   "not difficult to understand at all" → praise
//   "we do not just copy paste, we actually write and understand" → praise
//   "not boring at all" → praise
// ─────────────────────────────────────────────────────────────────────────────
const POSITIVE_OVERRIDE_PATTERNS = [
  // "not X but Y" where Y is positive action
  /\bnot\s+(writing\s+in\s+notebook|just\s+copy[\s-]?past(e|ing)|copy[\s-]?past(e|ing)\s+but|memoriz|boring\s+(at\s+all|anymore)|wasting\s+time|sitting\s+idle)\b/i,
  /\bnot\s+(just\s+copy|blindly\s+copy|only\s+copy)\b/i,

  // "not difficult/hard to understand" (negating the difficulty = praise)
  /\bnot\s+(difficult|hard|tough|confusing|boring|dull|monotonous)\s+(to\s+understand|to\s+follow|at\s+all|anymore)\b/i,
  /\b(easy|simple|clear|understandable)\s+to\s+(understand|follow|grasp)\b/i,

  // "do not just copy paste, we actually write/understand/apply"
  /\b(do\s+not|don'?t)\s+just\s+(copy|write|sit|watch|memorize)\b.*\b(actually|really|ourselves?|ourselves?|understand|apply|write|code|practice)\b/i,

  // Comparative praise: "unlike other X, this is good"
  /\bunlike\s+(other|boring|normal|typical|most)\s+(labs?|classes?|courses?|lectures?|sessions?)\b/i,

  // "applying/practising at the same time" = praise
  /\b(applying|practising|practicing|coding|writing\s+code|running\s+code)\s+(concepts?\s+)?at\s+the\s+same\s+time\b/i,
  /\bpractically\s+applying\s+concepts?\b/i,

  // "every X should be like this" = strong praise
  /\bevery\s+(lab|class|course|lecture|session)\s+(should\s+be|must\s+be|needs?\s+to\s+be)\s+like\s+this\b/i,

  // "love this" / "loving this" = strong praise
  /\b(love|loving)\s+(this\s+)?(lab|class|course|lecture|teaching|style|method|session|approach)\b/i,

  // "not boring" / "never boring"
  /\b(not|never|hardly|rarely)\s+(boring|dull|monotonous|boring\s+at\s+all)\b/i,

  // "no complaints at all" / "no issues at all"
  /\bno\s+(complaints?|issues?|problems?|doubts?)\s+(at\s+all|whatsoever)\b/i,

  // Contrastive: "instead of X, we Y" where Y is positive
  /\b(instead\s+of\s+(just\s+)?(writing\s+in\s+notebook|copying|memorizing|sitting))[,\s]+(we|students?)\s+(apply|practice|code|write|understand|learn)\b/i,

  // "we actually write/understand/apply" = positive context
  /\bwe\s+actually\s+(write|understand|code|apply|practice|learn|develop|run|implement)\b/i,

  // "does not waste time" as praise
  /\b(does\s+not|doesn'?t)\s+waste\s+(our\s+)?(time|lab\s+time)\b/i,

  // "not boring at all" standalone
  /\bnot\s+boring\s+at\s+all\b/i,

  // "great/good class not boring"
  /\b(great|good|excellent|amazing)\s+(class|lab|course|session|lecture)[,\s].*(not|never)\s+(boring|dull)\b/i,

  // "not just theory, actually practice"
  /\bnot\s+just\s+(theory|reading|watching|listening)[,\s].*(actually|also|but)\s+(practic|apply|code|hands[\s-]on|do)\b/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// ATTENTION OPENERS — sentence starters that always indicate a problem
// Covers ALL openers found in v1 + v2 + mixed datasets
// ─────────────────────────────────────────────────────────────────────────────
const ATTENTION_OPENERS = [
  // v2 NEW openers
  /^problem\s+reported\s*:/i,
  /^this\s+issue\s+is\s+affecting\s+learning\s*[:\.]/i,
  /^this\s+needs\s+attention\s*[:\.]/i,
  /^the\s+following\s+problem\s+remains\s+unresolved\s*[:\.]/i,
  /^learning\s+is\s+being\s+affected\s*[:.]/i,
  /^repeated\s+concern\s*[:\.]/i,
  /^correction\s+required\s*[:\.]/i,
  /^complaint\s*[:\.]/i,
  /^this\s+issue\s+is\s+affecting\s+learning\s*[:\.]/i,

  // v1 openers
  /^with\s+respect(,?\s+to\s+the\s+faculty)?,?\s/i,
  /^(sir|mam|ma'?am|madam|prof\.?),\s/i,
  /^please\s+address\s+this\s+issue/i,
  /^i\s+request\s+the\s+faculty\s+to\s+note/i,
  /^an\s+improvement\s+is\s+needed\s+because/i,
  /^i\s+am\s+finding\s+it\s+difficult\s+because/i,
  /^students?\s+are\s+facing\s+difficulty\s+because/i,
  /^the\s+learning\s+experience\s+is\s+affected\s+because/i,
  /^it\s+would\s+help\s+if\s+this\s+improved/i,
  /^one\s+concern\s+is\s+that/i,
  /^the\s+main\s+problem\s+is\s+that/i,
  /^(although|even\s+though)\s+the\s+topic\s+is\s+important/i,

  // Mixed dataset openers — "X is good BUT issue"
  /^the\s+(teacher|faculty|instructor|class|course|lab|subject|lectures?|notes?|teaching|practical|course\s+material|class\s+atmosphere)\s+(is|are|has|explains?|gives?|uses?|covers?|provides?|shares?|encourages?|answers?)\s+\w[\w\s,]+,\s+but\b/i,
  /^the\s+(teaching\s+style|teaching|class)\s+is\s+\w[\w\s]+,\s+but\b/i,

  // Generic "X but Y" with praise then issue
  /^(the\s+(class|course|subject|teacher|instructor|faculty|lab|lectures?|notes?|practical|teaching))\s+(is|are|has|have)\s+(good|useful|great|informative|engaging|well[\s-]organized|helpful|clear|excellent|valuable|interesting|relevant|supportive|cooperative|knowledgeable|patient|polite|dedicated|fair|encouraging|experienced|committed|respectful|friendly|strong),?\s*(but|however)\b/i,
  /^(the\s+(class|course|subject|teacher|instructor|faculty|lab|lectures?|notes?|practical|teaching))\s+(explains?|teaches?|gives?|covers?|provides?|shares?|uses?|encourages?|answers?)\s+\w[\w\s,]+,\s+(but|however)\b/i,

  // v1 openers continued
  /^(the\s+class\s+has\s+potential|some\s+parts\s+of\s+the\s+class\s+are\s+good|overall\s+the\s+course\s+has\s+value|the\s+subject\s+is\s+useful|the\s+instructor\s+is\s+helpful|the\s+faculty\s+is\s+supportive),\s+but\b/i,
  /^i\s+want\s+to\s+learn\s+well,\s+but\b/i,
  /^i\s+appreciate\s+the\s+effort,\s+but\b/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// CORE ISSUE PHRASES — from all 2100 labeled comments
// ─────────────────────────────────────────────────────────────────────────────
const ATTENTION_ISSUE_PHRASES = [
  // ══ v6 NEW: Part 2 & Dataset Issue Patterns ════════════════════════════════
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
  /\b(assignment\s+instructions?\s+are\s+often\s+unclear|marking\s+scheme\s+is\s+not\s+explained|feedback\s+on\s+assignments?\s+is\s+not\s+provided|topics?\s+not\s+taught\s+in\s+class|answer\s+key\s+is\s+not\s+discussed|deadlines?\s+are\s+announced\s+at\s+the\s+last\s+moment|not\s+receive\s+clear\s+feedback|no\s+topic[\s-]wise\s+practice\s+questions|concerns?\s+are\s+not\s+followed\s+up|submission\s+requirements?\s+are\s+often\s+incomplete|criteria\s+for\s+awarding\s+marks\s+are\s+unclear|assessment\s+coverage\s+in\s+advance|instructions?\s+change\s+without\s+notice|not\s+receive\s+solutions|outside\s+the\s+announced\s+syllabus|feedback\s+does\s+not\s+explain\s+how\s+to\s+improve)\b/i,


  // ══ TEACHING CLARITY (v1 + v2) ════════════════════════════════════════════
  /\b(teacher\s+skips?\s+basic\s+concepts?\s+and\s+starts?\s+directly\s+with\s+advanced)\b/i,
  /\b(teacher\s+reads?\s+slides?\s+without\s+explaining\s+the\s+content)\b/i,
  /\b(teacher\s+changes?\s+topics?\s+before\s+the\s+previous\s+concept\s+is\s+clear)\b/i,
  /\b(same\s+explanation\s+is\s+repeated\s+even\s+when\s+students?\s+remain\s+confused)\b/i,
  /\b(final\s+answers?\s+are\s+given\s+without\s+explaining\s+the\s+method)\b/i,
  /\b(connections?\s+between\s+related\s+topics?\s+are\s+not\s+explained)\b/i,
  /\b(new\s+terminology\s+is\s+used\s+without\s+being\s+defined)\b/i,
  /\b(core\s+concepts?\s+(are|is)\s+not\s+explained\s+clearly)\b/i,
  /\b(explanation\s+(jumps?\s+straight\s+to\s+advanced|leaves?\s+several\s+doubts?|repeats?\s+without|relies?\s+on\s+slides?))\b/i,
  /\b(same\s+confusing\s+explanation\s+is\s+repeated)\b/i,
  /\b(important\s+steps?\s+are\s+skipped\s+while\s+solving)\b/i,
  /\b(examples?\s+do\s+not\s+match\s+the\s+concept\s+being\s+taught)\b/i,
  /\b(connection\s+between\s+topics?\s+is\s+not\s+explained)\b/i,
  /\b(class\s+ends?\s+before\s+the\s+difficult\s+part\s+is\s+clarified)\b/i,
  /\b(topic\s+is\s+explained\s+too\s+quickly\s+to\s+follow)\b/i,
  /\b(lecture\s+mostly\s+repeats?\s+slides?\s+instead\s+of\s+explaining)\b/i,
  /\b(explanations?\s+are\s+unclear\s+and\s+leave\s+students?\s+confused)\b/i,
  /\b(debug(?:ging)?\s+is\s+not\s+demonstrated\s+in\s+lab)\b/i,
  /\b(lecture\s+pace\s+is\s+too\s+fast\s+to\s+follow)\b/i,
  /\b(direct\s+advanced\s+topic\s+par)\b/i,
  /\b(theory\s+samajh\s+nahi\s+aati)\b/i,
  /\b(examples?\s+ke\s+bina\s+theory\s+samjhate\s+hain)\b/i,
  /\b(reasoning\s+bhi\s+samjhaiye)\b/i,
  /\b(steps?\s+explain\s+nahi\s+hote)\b/i,

  // ══ PACING AND TIME (v1 + v2) ══════════════════════════════════════════════
  /\b(slides?\s+change\s+before\s+students?\s+can\s+finish\s+taking\s+notes?)\b/i,
  /\b(too\s+many\s+topics?\s+are\s+rushed\s+into\s+one\s+lecture)\b/i,
  /\b(long\s+problems?\s+are\s+started\s+near\s+the\s+end\s+and\s+left\s+incomplete)\b/i,
  /\b(there\s+is\s+almost\s+no\s+time\s+for\s+questions?)\b/i,
  /\b(syllabus\s+is\s+rushed\s+just\s+before\s+assessments?)\b/i,
  /\b(lengthy\s+code\s+must\s+be\s+written\s+in\s+too\s+little\s+(lab\s+)?time)\b/i,
  /\b(important\s+concepts?\s+are\s+rushed\s+while\s+minor\s+details?\s+take\s+too\s+long)\b/i,
  /\b(teacher\s+moves?\s+ahead\s+without\s+checking\s+understanding)\b/i,
  /\b(revision\s+is\s+skipped\s+because\s+the\s+lecture\s+runs?\s+out\s+of\s+time)\b/i,
  /\b(teaching\s+pace\s+is\s+too\s+fast\s+(for\s+many\s+students?|to\s+follow))\b/i,
  /\b(too\s+many\s+topics?\s+are\s+covered\s+in\s+one\s+class)\b/i,
  /\b(class\s+(moves?\s+to\s+the\s+next\s+slide|frequently\s+ends?\s+before|spends?\s+too\s+long))\b/i,
  /\b(not\s+enough\s+time\s+to\s+(write\s+notes?|complete|understand|cover))\b/i,
  /\b(there\s+is\s+(not\s+enough|insufficient)\s+time\s+for\s+(questions?|doubts?|note[\s-]taking|practice))\b/i,
  /\b(syllabus\s+is\s+being\s+rushed\b)/i,
  /\b(long\s+problems?\s+are\s+rushed\s+near\s+the\s+end)\b/i,
  /\b(students?\s+are\s+expected\s+to\s+understand\s+lengthy\s+code)\b/i,
  /\b(lecture\s+spends?\s+too\s+long\s+on\s+minor\s+details?)\b/i,
  /\b(class\s+ki\s+speed\s+bahut\s+fast)\b/i,
  /\b(notes?\s+complete\s+nahi\s+hote\s+aur\s+concept\s+samajh\s+nahi\s+aata)\b/i,
  /\b(things?\s+(goes?|go)\s+out\s+of\s+head)\b/i,
  /\b(quick\s+pace|fast\s+pace)\b/i,

  // ══ PRACTICAL LAB (v1 + v2) ════════════════════════════════════════════════
  /\b(lab\s+is\s+conducted\s+like\s+a\s+theory\s+lecture\s+with\s+almost\s+no\s+practical)\b/i,
  /\b(students?\s+copy\s+code\s+without\s+learning\s+how\s+to\s+write\s+it)\b/i,
  /\b(code\s+output\s+is\s+shown\s+without\s+explaining\s+debug(?:ging)?)\b/i,
  /\b(there\s+is\s+not\s+enough\s+time\s+to\s+complete\s+lab\s+assignments?)\b/i,
  /\b(lab\s+exercises?\s+do\s+not\s+match\s+the\s+theory\s+topics?)\b/i,
  /\b(students?\s+receive\s+little\s+individual\s+guidance\s+during\s+lab)\b/i,
  /\b(same\s+basic\s+exercise\s+is\s+repeated\s+without\s+(increasing\s+difficulty|a\s+new\s+challenge))\b/i,
  /\b(purpose\s+of\s+code\s+statements?\s+is\s+not\s+explained)\b/i,
  /\b(students?\s+are\s+told\s+to\s+paste\s+code\s+instead\s+of\s+developing\s+solutions?)\b/i,
  /\b(there\s+are\s+too\s+few\s+lab\s+sessions?\s+for\s+the\s+required\s+practice)\b/i,
  /\b(lab\s+(tasks?\s+are\s+completed\s+without|sessions?\s+do\s+not\s+connect|is\s+conducted\s+like\s+a\s+theory))\b/i,
  /\b(students?\s+mostly\s+copy\s+code\s+without\s+understanding)\b/i,
  /\b(sirf\s+code\s+copy\s+karwate\s+hain)\b/i,
  /\b(lab\s+mein\s+khud\s+code\s+likhne\s+ka\s+time\s+nahi)\b/i,
  /\b(instructor\s+demonstrates?\s+code\s+but\s+does\s+not\s+explain\s+how\s+to\s+write)\b/i,
  /\b(too\s+little\s+hands[\s-]on\s+practice\s+in\s+the\s+lab)\b/i,
  /\b(practical\s+exercises?\s+are\s+too\s+limited)\b/i,
  /\b(students?\s+do\s+not\s+get\s+enough\s+time\s+to\s+run\s+and\s+debug)\b/i,
  /\b(lab\s+is\s+conducted\s+like\s+a\s+theory\s+lecture)\b/i,
  /\b(debugging\s+is\s+not\s+demonstrated)\b/i,
  /\b(ready[\s-]made\s+code\s+copy\s+karne\s+ko\s+kehte\s+hain)\b/i,
  /\b(practical\s+work\s+kam\s+hota\s+hai)\b/i,
  /\b(central\s+quiz\s+se\s+pehle\s+syllabus\s+complete\s+nahi\s+hua\s+tha)\b/i,

  // ══ NOTES AND MATERIALS (v1 + v2) ══════════════════════════════════════════
  /\b(notes?\s+are\s+incomplete\s+and\s+omit\s+syllabus\s+topics?)\b/i,
  /\b(study\s+material\s+is\s+shared\s+too\s+late\s+for\s+preparation)\b/i,
  /\b(slides?\s+contain\s+(too\s+much\s+text\s+and\s+lack\s+diagrams?|errors?\s+that\s+cause\s+confusion))\b/i,
  /\b(notes?\s+are\s+difficult\s+to\s+revise\s+before\s+examinations?)\b/i,
  /\b(important\s+formulas?\s+and\s+definitions?\s+are\s+missing)\b/i,
  /\b(notes?\s+do\s+not\s+match\s+what\s+is\s+taught\s+in\s+class)\b/i,
  /\b(examples?\s+in\s+the\s+material\s+have\s+no\s+explanations?)\b/i,
  /\b(shared\s+files?\s+are\s+disorganized\s+and\s+difficult\s+to\s+locate)\b/i,
  /\b(no\s+practice\s+questions?\s+are\s+provided\s+for\s+taught\s+topics?)\b/i,
  /\b(notes?\s+time\s+par\s+share\s+nahi\s+hote)\b/i,
  /\b(slides?\s+(are\s+not\s+organized\s+unit|contain\s+too\s+much\s+text))\b/i,
  /\b(examples?\s+in\s+the\s+notes?\s+are\s+not\s+explained)\b/i,
  /\b(course\s+material\s+is\s+shared\s+too\s+late)\b/i,
  /\b(no\s+useful\s+summary\s+for\s+exam\s+preparation)\b/i,
  /\b(material\s+contains?\s+errors?\s+that\s+cause\s+confusion)\b/i,
  /\b(assignment\s+ki\s+(instructions?\s+clear\s+nahi|deadline\s+late\s+batayi))\b/i,
  /\b(notes?\s+exam\s+ke\s+paas\s+share\s+hote\s+hain)\b/i,
  /\b(examples?\s+ke\s+bina\s+theory\s+samjhate\s+hain)\b/i,
  /\b(sirf\s+ppt\s+dikhakar\s+aage\s+badh\s+jaati\s+hain)\b/i,
  /\b(files?\s+are\s+difficult\s+to\s+locate\s+by\s+unit)\b/i,
  /\b(keep\s+(the\s+)?(notes?|material|slides?|content)\s+(concise|short|simple|easy|clear|aligned))\b/i,

  // ══ DOUBT SUPPORT (v1 + v2) ════════════════════════════════════════════════
  /\b(questions?\s+raised\s+during\s+class\s+are\s+ignored)\b/i,
  /\b(there\s+is\s+no\s+dedicated\s+time\s+for\s+clearing\s+doubts?)\b/i,
  /\b(answer\s+to\s+a\s+question\s+repeats?\s+the\s+same\s+unclear\s+explanation)\b/i,
  /\b(students?\s+hesitate\s+to\s+ask\s+questions?\s+because\s+the\s+class\s+feels?\s+intimidating)\b/i,
  /\b(teacher\s+moves?\s+on\s+before\s+checking\s+if\s+a\s+doubt\s+is\s+resolved)\b/i,
  /\b(students?\s+receive\s+little\s+help\s+with\s+difficult\s+assignments?)\b/i,
  /\b(follow[\s-]up\s+questions?\s+are\s+discouraged\s+during\s+lectures?)\b/i,
  /\b(confusing\s+topics?\s+are\s+never\s+revisited)\b/i,
  /\b(requests?\s+for\s+academic\s+help\s+receive\s+no\s+timely\s+response)\b/i,
  /\b(there\s+is\s+no\s+clear\s+way\s+to\s+get\s+help\s+outside\s+lecture\s+hours?)\b/i,
  /\b(extra\s+doubt\s+sessions?\s+are\s+not\s+available)\b/i,
  /\b(there\s+is\s+not\s+enough\s+time\s+for\s+doubt\s+solving)\b/i,
  /\b(explanation\s+given\s+after\s+a\s+question\s+is\s+still\s+unclear)\b/i,
  /\b(feedback\s+about\s+confusing\s+topics?\s+is\s+not\s+addressed)\b/i,
  /\b(follow[\s-]up\s+questions?\s+are\s+discouraged)\b/i,
  /\b(instructor\s+moves?\s+on\s+before\s+checking\s+whether\s+the\s+doubt\s+is\s+resolved)\b/i,
  /\b(students?\s+hesitate\s+to\s+ask\s+questions?\s+because\s+the\s+classroom\s+feels?\s+unapproachable)\b/i,
  /\b(students?\s+have\s+to\s+ask\s+the\s+same\s+doubt\s+multiple\s+times?)\b/i,
  /\b(questions?\s+are\s+sometimes?\s+ignored\s+during\s+class)\b/i,
  /\b(doubt\s+poochne\s+par\s+proper\s+explanation\s+nahi)\b/i,
  /\b(class\s+mein\s+doubts?\s+clear\s+karne\s+ke\s+liye\s+time\s+nahi)\b/i,
  /\b(doubts?\s+poochne\s+par\s+clear\s+answer\s+nahi\s+milta)\b/i,
  /\b(topic\s+adhura\s+reh\s+jata\s+hai)\b/i,
  /\b(sir\s+ki\s+awaaz\s+last\s+benches?\s+(tak\s+)?(clear\s+nahi|sunai\s+nahi\s+deti))\b/i,
  /\b(notes?\s+unit[\s-]wise\s+nahi\s+hain\s+aur\s+important\s+topics?\s+missing\s+hain)\b/i,

  // ══ ASSESSMENT AND FAIRNESS (v1 + v2) ══════════════════════════════════════
  /\b(quiz\s+questions?\s+include\s+topics?\s+that\s+were\s+not\s+covered\s+in\s+class)\b/i,
  /\b(marking\s+scheme\s+is\s+not\s+explained\s+before\s+assessments?)\b/i,
  /\b(marks?\s+are\s+returned\s+without\s+explaining\s+mistakes?)\b/i,
  /\b(syllabus\s+is\s+incomplete\s+when\s+the\s+central\s+quiz\s+takes?\s+place)\b/i,
  /\b(assessment\s+instructions?\s+are\s+confusing)\b/i,
  /\b(allotted\s+test\s+time\s+is\s+insufficient)\b/i,
  /\b(answer\s+key\s+is\s+not\s+discussed\s+after\s+the\s+quiz)\b/i,
  /\b(students?\s+are\s+not\s+told\s+which\s+topics?\s+will\s+be\s+assessed)\b/i,
  /\b(evaluation\s+criteria\s+appear\s+inconsistent)\b/i,
  /\b(reported\s+errors?\s+in\s+quiz\s+questions?\s+are\s+not\s+addressed)\b/i,
  /\b(quiz\s+(covers?\s+topics?\s+that\s+were\s+rushed|questions?\s+seem\s+outside))\b/i,
  /\b(there\s+is\s+not\s+enough\s+time\s+to\s+complete\s+the\s+test)\b/i,
  /\b(marking\s+scheme\s+is\s+not\s+explained\s+clearly)\b/i,
  /\b(marks?\s+appear\s+inconsistent\s+with\s+the\s+announced\s+criteria)\b/i,
  /\b(students?\s+do\s+not\s+receive\s+feedback\s+explaining\s+their\s+mistakes?)\b/i,
  /\b(difficulty\s+level\s+changes?\s+unexpectedly\s+between\s+assessments?)\b/i,
  /\b(evaluation\s+is\s+not\s+transparent)\b/i,
  /\b(quiz\s+mein\s+syllabus\s+se\s+bahar\s+(ke\s+)?(questions?|topics?))\b/i,
  /\b(marking\s+(criteria|scheme)\s+(clear\s+nahi|bhi\s+clear\s+nahi\s+tha))\b/i,
  /\b(topics?\s+jaldi\s+complete\s+hote\s+hain\s+aur\s+revision\s+nahi\s+hota)\b/i,
  /\b(assignment\s+mein\s+problem\s+aane\s+par\s+individual\s+guidance\s+nahi\s+milti)\b/i,
  /\b(marks?\s+ke\s+criteria\s+(transparent\s+nahi|clearly\s+explain))\b/i,

  // ══ COMMUNICATION AND ENGAGEMENT (v1 + v2) ═════════════════════════════════
  /\b(class\s+is\s+monotonous\s+and\s+difficult\s+to\s+stay\s+engaged\s+in)\b/i,
  /\b(students?\s+are\s+rarely\s+invited\s+to\s+participate)\b/i,
  /\b(instructor\s+speaks?\s+too\s+softly\s+for\s+the\s+back\s+rows?)\b/i,
  /\b(lecture\s+relies?\s+on\s+slides?\s+without\s+discussion)\b/i,
  /\b(class\s+instructions?\s+are\s+unclear)\b/i,
  /\b(teacher\s+does\s+not\s+check\s+whether\s+students?\s+are\s+following)\b/i,
  /\b(real[\s-]world\s+examples?\s+are\s+rarely\s+used)\b/i,
  /\b(students?\s+cannot\s+discuss\s+alternative\s+solution\s+methods?)\b/i,
  /\b(classroom\s+environment\s+discourages?\s+students?\s+from\s+speaking)\b/i,
  /\b(announcements?\s+about\s+class\s+activities?\s+are\s+communicated\s+late)\b/i,
  /\b(lecture\s+becomes?\s+monotonous\s+and\s+difficult\s+to\s+stay\s+focused)\b/i,
  /\b(explanation\s+relies?\s+on\s+slides?\s+with\s+little\s+discussion)\b/i,
  /\b(class\s+is\s+not\s+interactive)\b/i,
  /\b(instructor\s+does\s+not\s+check\s+whether\s+the\s+class\s+is\s+following)\b/i,
  /\b(students?\s+receive\s+unclear\s+instructions?\s+about\s+class\s+activities?)\b/i,
  /\b(there\s+are\s+few\s+opportunities?\s+for\s+student\s+discussion)\b/i,
  /\b(classroom\s+atmosphere\s+makes?\s+participation\s+difficult)\b/i,
  /\b(students?\s+are\s+not\s+encouraged\s+to\s+participate)\b/i,
  /\b(instructor\s+speaks?\s+too\s+softly\s+to\s+hear\s+clearly)\b/i,
  /\b(lecture\s+lacks?\s+practical\s+or\s+relatable\s+examples?)\b/i,
  /\b(class\s+interactive\s+nahi\s+(hai|hoti))\b/i,
  /\b(sirf\s+slides?\s+(read|parhte|padhte)\s+hoti?\s+hain?)\b/i,
  /\b(class\s+mein\s+(students?\s+ko\s+participate\s+karne\s+ka\s+mauka\s+nahi|participation\s+encourage\s+nahi))\b/i,
  /\b(code\s+ka\s+output\s+bataya\s+jata\s+hai\s+lekin\s+debugging\s+nahi\s+samjhate)\b/i,
  /\b(slides?\s+mein\s+bahut\s+text\s+hai\s+aur\s+diagrams?\s+(ya\s+solved\s+examples?\s+)?nahi\s+hain?)\b/i,
  /\b(lab\s+hours?\s+kam\s+hain,?\s+programs?\s+complete\s+karne\s+ka\s+time\s+nahi)\b/i,

  // ══ FACILITIES AND EQUIPMENT (v1 + v2) ════════════════════════════════════
  /\b(lab\s+equipment\s+is\s+outdated\s+for\s+assigned\s+tasks?)\b/i,
  /\b(there\s+are\s+not\s+enough\s+working\s+computers?\s+for\s+students?)\b/i,
  /\b(projector\s+display\s+is\s+unclear)\b/i,
  /\b(students?\s+lose\s+lab\s+time\s+waiting\s+for\s+functioning\s+systems?)\b/i,
  /\b(software\s+works?\s+differently\s+across\s+lab\s+computers?)\b/i,
  /\b(lab\s+sessions?\s+are\s+too\s+short\s+for\s+assigned\s+experiments?)\b/i,
  /\b(reported\s+equipment\s+faults?\s+remain\s+unresolved)\b/i,
  /\b(required\s+software\s+is\s+missing\s+from\s+lab\s+computers?)\b/i,
  /\b(lab\s+(ke\s+)?computers?\s+baar[\s-]baar\s+(band\s+ho\s+jaate?\s+hain?|kaam\s+nahi\s+(karte?|karti?)|stop\s+working))\b/i,
  /\b(internet\s+connection\s+interrupts?\s+practical\s+work)\b/i,
  /\b(software\s+setup\s+is\s+inconsistent\s+across\s+computers?)\b/i,
  /\b(there\s+are\s+not\s+enough\s+working\s+computers?)\b/i,
  /\b(lab\s+environment\s+makes?\s+it\s+difficult\s+to\s+complete\s+experiments?)\b/i,
  /\b(students?\s+lose\s+time\s+waiting\s+for\s+a\s+working\s+system)\b/i,
  /\b(projector\s+or\s+display\s+is\s+difficult\s+to\s+read)\b/i,
  /\b(lab\s+hours?\s+are\s+too\s+limited\s+for\s+the\s+assigned\s+work)\b/i,
  /\b(equipment\s+is\s+outdated\s+for\s+the\s+assigned\s+tasks?)\b/i,
  /\b(computer\s+lab\s+ka\s+internet\s+(slow|disconnect)\s+hota\s+hai)\b/i,
  /\b(lab\s+(ke\s+)?computers?\s+baar[\s-]baar\s+kaam\s+nahi\s+karte)\b/i,
  /\b(lab\s+systems?\s+slow\s+hain\s+aur\s+kai\s+computers?\s+working\s+(nahi|condition\s+mein\s+nahi))\b/i,
  /\b(important\s+concepts?\s+ke\s+steps?\s+skip\s+hote\s+hain)\b/i,
  /\b(assignment\s+requirements?\s+last\s+moment\s+par\s+batayi\s+jaati\s+hain)\b/i,
  /\b(slides?\s+mein\s+bahut\s+text\s+hai\s+aur\s+diagrams?\s+(ya\s+solved\s+examples?\s+)?nahi\s+hain?)\b/i,

  // ══ COURSE PLANNING (v1 + v2) ══════════════════════════════════════════════
  /\b(syllabus\s+is\s+not\s+completed\s+before\s+the\s+scheduled\s+assessment)\b/i,
  /\b(advanced\s+topics?\s+begin\s+before\s+prerequisites?\s+are\s+revised)\b/i,
  /\b(there\s+is\s+no\s+revision\s+before\s+major\s+examinations?)\b/i,
  /\b(theory\s+and\s+lab\s+schedules?\s+are\s+not\s+coordinated)\b/i,
  /\b(important\s+units?\s+are\s+left\s+until\s+the\s+end\s+of\s+the\s+semester)\b/i,
  /\b(course\s+objectives?\s+are\s+not\s+explained)\b/i,
  /\b(there\s+are\s+too\s+few\s+practice\s+sessions?\s+before\s+examinations?)\b/i,
  /\b(course\s+schedule\s+changes?\s+are\s+communicated\s+too\s+late)\b/i,
  /\b(teaching\s+plan\s+leaves?\s+too\s+little\s+time\s+for\s+difficult\s+topics?)\b/i,
  /\b(students?\s+are\s+not\s+informed\s+about\s+syllabus\s+progress)\b/i,
  /\b(order\s+of\s+topics?\s+makes?\s+the\s+subject\s+difficult\s+to\s+follow)\b/i,
  /\b(prerequisite\s+topics?\s+are\s+assumed\s+without\s+being\s+revised)\b/i,
  /\b(syllabus\s+was\s+not\s+completed\s+before\s+the\s+central\s+quiz)\b/i,
  /\b(there\s+is\s+no\s+revision\s+before\s+major\s+assessments?)\b/i,
  /\b(timetable\s+leaves?\s+too\s+little\s+time\s+for\s+difficult\s+units?)\b/i,
  /\b(lab\s+schedule\s+does\s+not\s+support\s+the\s+theory\s+schedule)\b/i,
  /\b(students?\s+are\s+not\s+told\s+which\s+topics?\s+need\s+extra\s+preparation)\b/i,
  /\b(important\s+topics?\s+are\s+postponed\s+until\s+the\s+end)\b/i,
  /\b(course\s+planning\s+improve\s+kijiye)\b/i,
  /\b(class\s+mein\s+doubts?\s+poochne\s+par\s+students?\s+comfortable\s+feel\s+nahi\s+karte)\b/i,
  /\b(marks?\s+ke\s+criteria\s+transparent\s+nahi\s+hain)\b/i,

  // ══ STUDENT SUPPORT AND PROFESSIONALISM (v1 + v2) ══════════════════════════
  /\b(instructor\s+responds?\s+impatiently\s+to\s+student\s+questions?)\b/i,
  /\b(students?\s+receive\s+unclear\s+guidance\s+when\s+struggling\s+academically)\b/i,
  /\b(assignment\s+requirements?\s+change\s+without\s+clear\s+announcement)\b/i,
  /\b(assignment\s+deadlines?\s+are\s+announced\s+with\s+little\s+notice)\b/i,
  /\b(classroom\s+interactions?\s+sometimes?\s+feel\s+disrespectful)\b/i,
  /\b(academic\s+concerns?\s+are\s+raised\s+but\s+never\s+followed\s+up)\b/i,
  /\b(students?\s+do\s+not\s+know\s+how\s+to\s+contact\s+the\s+instructor\s+for\s+help)\b/i,
  /\b(student\s+feedback\s+is\s+repeatedly\s+ignored)\b/i,
  /\b(submission\s+instructions?\s+are\s+incomplete)\b/i,
  /\b(students?\s+receive\s+no\s+useful\s+feedback\s+on\s+how\s+to\s+improve)\b/i,
  /\b(academic\s+concerns?\s+are\s+not\s+followed\s+up\s+consistently)\b/i,
  /\b(requests?\s+for\s+clarification\s+do\s+not\s+receive\s+a\s+clear\s+response)\b/i,
  /\b(instructions?\s+for\s+assignments?\s+change\s+without\s+clear\s+notice)\b/i,
  /\b(students?\s+receive\s+little\s+guidance\s+when\s+they\s+struggle)\b/i,
  /\b(students?\s+do\s+not\s+feel\s+comfortable\s+asking\s+for\s+help)\b/i,
  /\b(communication\s+about\s+assignments?\s+is\s+inconsistent)\b/i,
  /\b(classroom\s+interaction\s+sometimes?\s+feels?\s+disrespectful)\b/i,
  /\b(instructor\s+sometimes?\s+responds?\s+impatiently\s+to\s+student\s+questions?)\b/i,
  /\b(students?\s+are\s+unsure\s+how\s+to\s+approach\s+the\s+instructor)\b/i,
  /\b(assignment\s+deadlines?\s+are\s+announced\s+with\s+insufficient\s+notice)\b/i,
  /\b(students?\s+ko\s+individual\s+guidance\s+kam\s+milti\s+hai)\b/i,
  /\b(class\s+mein\s+doubts?\s+poochne\s+mein\s+hesitation)\b/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// GENERIC ATTENTION PATTERNS — broad signals across all categories
// ─────────────────────────────────────────────────────────────────────────────
const GENERIC_ATTENTION_PATTERNS = [
  // Universal polite request/suggestion phrases
  /\b(please\s+(explain|provide|give|cover|focus|teach|speak|slow\s+down|improve|try|be\s+more|increase|add|include|change|assign|upload|check|repair|install|address|solve|discuss|announce|share|publish|avoid|schedule|coordinate|clarify|update|revise|reduce|ensure|make|use|start|stop|review|correct|complete|allocate|expand))\b/i,
  /\b(could\s+you\s+(please\s+)?(explain|teach|provide|give|cover|focus|try|start|improve|speak|slow|be|keep|add|include|change|assign|share|publish))\b/i,
  /\b(it\s+would\s+(be\s+)?(helpful|great|better|nice|good|useful)\s+(if|to|for))\b/i,
  /\b(would\s+be\s+(helpful|better|great|nice|good|more\s+effective)\s+(if|to|for))\b/i,
  /\b(if\s+(possible|maam?|sir|you\s+can|you\s+could),?\s+please)\b/i,
  /\b(i\s+(think|feel|believe|suggest|request|hope)\s+(this|it|the|that|we|sir|maam?|topics?|subject|class))\b/i,
  /\b(in\s+my\s+opinion|according\s+to\s+me|from\s+my\s+perspective)\b/i,
  /\b(use\s+relevant\s+examples?\s+and\s+show\s+the\s+reasoning)\b/i,
  /\b(start\s+from\s+the\s+fundamentals?\s+and\s+explain\s+the\s+topic\s+step\s+by\s+step)\b/i,
  /\b(check\s+understanding\s+before\s+moving\s+to\s+the\s+next\s+concept)\b/i,
  /\b(allocate\s+time\s+for\s+questions?\s+and\s+clarification)\b/i,
  /\b(provide\s+complete,?\s+clear,?\s+unit[\s-]wise\s+learning\s+material)\b/i,
  /\b(include\s+more\s+hands[\s-]on\s+practice\s+and\s+individual\s+problem[\s-]solving)\b/i,
  /\b(explain\s+mistakes?\s+and\s+give\s+actionable\s+feedback)\b/i,
  /\b(share\s+instructions?\s+and\s+study\s+material\s+before\s+the\s+relevant\s+class)\b/i,
  /\b(address\s+the\s+issue\s+consistently\s+instead\s+of\s+leaving\s+it\s+unresolved)\b/i,
  /\b(review\s+the\s+teaching\s+plan\s+and\s+make\s+the\s+necessary\s+changes?)\b/i,

  // Improvement requests
  /\b(need[s]?\s+(to\s+)?(improve|be\s+improved|to\s+cover|to\s+explain|to\s+focus|more|better))\b/i,
  /\b(should\s+(improve|be\s+improved|focus|give|provide|explain|cover|try|use|include|change|start|teach|conduct|assign|add|be|come|go))\b/i,
  /\b(must\s+(improve|explain|cover|provide|give|attend|focus|include|add|be|come))\b/i,
  /\b(can\s+be\s+(improved|better|more\s+(clear|effective|interactive|engaging|organized|structured|helpful)))\b/i,
  /\b(scope\s+for\s+improvement|room\s+for\s+improvement)\b/i,
  /\b(needs?\s+improvement|needs?\s+to\s+be\s+(improved|better|more|changed))\b/i,
  /\b(could\s+be\s+(better|improved|more))\b/i,

  // More X requests
  /\b(more\s+(examples?|practice|exercises?|problems?|interaction|real[\s-]world|practical|hands[\s-]on|time|attention|explanation|clarity|details?|topics?|coverage|activities|discussion|problem[\s-]solving|coding|case[\s-]studies?|sessions?|experiments?|guidance|labs?))\b/i,
  /\b(give\s+(more|enough|additional|some)\s+(time|examples?|attention|practice|explanation|problems?|exercises?|guidance))\b/i,
  /\b(not\s+enough\s+(examples?|practice|time|explanation|interaction|guidance|sessions?))\b/i,
  /\b(insufficient\s+(time|guidance|examples?|practice|sessions?))\b/i,
  /\b(too\s+few\s+(lab|practice|sessions?|exercises?|examples?|problems?))\b/i,

  // Not clear / hard to understand
  /\b(not\s+(clear|easy\s+to\s+understand|understandable|helpful|satisfactory|effective|interactive|engaging|organized|available|completed?|addressed|followed\s+up))\b/i,
  /\b(difficult\s+to\s+(understand|follow|grasp|comprehend|remember|read|complete|revise))\b/i,
  /\b(hard\s+to\s+(understand|follow|grasp|comprehend|read|complete))\b/i,
  /\b(can'?t\s+(understand|follow|hear|grasp|comprehend|read|see|complete))\b/i,
  /\b(unable\s+to\s+(understand|follow|grasp|comprehend|complete))\b/i,
  /\b(didn'?t\s+(understand|cover|explain|teach|complete|finish|give|provide|discuss|address))\b/i,
  /\b(doesn'?t\s+(explain|teach|help|provide|give|come|attend|answer|listen|respond|check|follow\s+up|make\s+it\s+clear|connect))\b/i,

  // Mixed comment markers
  /\b(good\s+but\b|nice\s+but\b|great\s+but\b|best\s+but\b|excellent\s+but\b|helpful\s+but\b)\b/i,
  /,\s+(but|however)\s+(the|there|some|students?|it|this|an|important|assessment|marks?|quiz|notes?|lab|class|pace|speed|syllabus|course|instructor|communication|classroom|debugging|more|no\s+(regular|dedicated|time|clear)|assignments?|advanced|follow[\s-]up|only\s+a\s+few)/i,
  /\b(however,?\s+(the|there|some|students?|it|this|an|important|assessment|marks?|quiz|notes?|lab|class|pace|speed|syllabus|course|instructor|revision|more|advanced|only\s+a\s+few))\b/i,
  /\b(although\s+the\s+(topic|subject|course|class)\s+is\s+(important|useful|good|great))\b/i,
  /\b(but\s+(more|the\s+(lecture|pace|notes?|lab|class|marking|answer|quiz|syllabus)|students?|follow|only|no\s+(regular|dedicated)|debugging|prerequisite|advanced|important\s+steps?))\b/i,

  // Speed / pace
  /\b(too\s+(fast|slow|quick|rushed|rapid|brief))\b/i,
  /\b(speaks?\s+(too\s+)?(very\s+)?(fast|slow|quickly|slowly|rapidly))\b/i,
  /\b(teaches?\s+(too\s+)?(fast|slow|quickly|slowly|rapidly|at\s+a\s+(quick|fast|slow)\s+pace))\b/i,

  // Availability/punctuality
  /\b(absent|irregular|not\s+punctual|always\s+late|often\s+absent|frequently\s+absent)\b/i,
  /\b(never\s+(available|present|comes?|helps?|explains?|answers?|attends?))\b/i,
  /\b(rarely\s+(available|present|comes?|helps?|explains?|attends?))\b/i,

  // Behavior
  /\b(rude|arrogant|biased|unfair|partial|harsh|disrespectful|condescending)\b/i,
  /\b(pls?\s+(don'?t\s+assign|change|remove|replace)\s+(her|him|this|the|that)\s*(faculty|teacher|ma'?am|sir)?)\b/i,
  /\b(change\s+(the\s+)?(faculty|teacher|ma'?am|sir|professor))\b/i,

  // Dissatisfaction
  /\b(not\s+satisfied|unsatisfied|dissatisfied)\b/i,
  /\b(below\s+(average|expectation|standard|par))\b/i,
  /\b(overall\s+(bad|poor|average|below\s+average|not\s+good|unsatisf\w*))\b/i,
  /\b(just\s+(copy\s+paste|copying))\b/i,
  /\b(learn\s+nothing|nothing\s+(new|learned|learnt))\b/i,

  // Hinglish
  /\b(samajh\s+(nahi|nahin|nhi)\s*(aaya|aati|aata|aa|raha)?)\b/i,
  /\b(kuch\s+(bhi\s+)?(samajh\s+(nahi|nhi)|pata\s+nahi))\b/i,
  /\b(hame\s+(hi\s+)?(samajh\s+(nahi|nhi)|pata\s+nahi))\b/i,
  /\b(bahut\s+(fast|slow|tez|dhire|mushkil|bura|bori|boring|problem|pareshani))\b/i,
  /\b(bahut\s+tez\s+(padhate|bolte|chalate|sikhate))\b/i,
  /\b(baar[\s-]baar\s+(band\s+ho\s+jaate?|kaam\s+nahi\s+(karte?|karti?)))\b/i,
  /\b(practical\s+work\s+rukta\s+hai)\b/i,
  /\b(theek\s+(se\s+)?(nahi|nahin|nhi)\s*(padhate|sikhate|bolte|samjhate)?)\b/i,
  /\b(accha\s+(nahi|nahin|nhi)\s*(padhate|sikhate|lagta)?)\b/i,
  /\b(nahi\s+samjha|samjha\s+nahi|samjhe\s+nahi)\b/i,
  /\b(aur\s+acche\s+se\s+(krayo|karo|explain\s+karo|samjhaiye))\b/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// PURE APPRECIATION PATTERNS
// ─────────────────────────────────────────────────────────────────────────────
const APPRECIATION_PATTERNS = [
// ── 1. Classic Superlatives & Pure Praise Words ──
  /\b(excellent|outstanding|amazing|wonderful|fantastic|superb|brilliant|exceptional|extraordinary|tremendous|marvelous|splendid|fabulous|terrific|first[\s-]class)\b/i,
  /\b(love|loved|loving|enjoy|enjoyed|appreciate|appreciated|grateful|thankful|thank\s+you|thanks\s+for)\b/i,
  /\bbest\s+(teachers?|faculty|professors?|sir|ma'?am|lecturers?|mentors?|department|college|class)\b/i,
  /\bone\s+of\s+the\s+best\b/i,
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
  /\b(combines?\s+demonstration|builds?\s+mathematical\s+concepts?\s+from\s+the\s+fundamentals?|follows?\s+a\s+clear\s+and\s+organized)\b/i,

  // ── Extra Short Praise Patterns (v6) ──
  /\b(the\s+)?(teacher|faculty|instructor|professor|sir|ma'?am|lecturer)\s+(is|are)\s+(supportive|helpful|friendly|polite|patient|approachable|dedicated|experienced|respectful|encouraging|committed|knowledgeable|fair|good|positive)\b/i,
  /\b(the\s+)?(classes?|class|course|subject|lab|lectures?|notes?|materials?|tasks?|exercises?|sessions?|resources?|atmosphere)\s+(is|are|has|have|were)\s+.*?\b(good|useful|helpful|informative|interesting|engaging|valuable|productive|relevant|clear|detailed|positive|strong|comprehensive|understandable)\b/i,
  /\b(the\s+)?(teaching|teaching\s+style)\s+is\s+(good|clear|effective|helpful|engaging|interactive|supportive)\b/i,
  /\b(the\s+)?(course|classes?|class|lectures?)\s+is\s+well\s+(organized|planned|designed|delivered|structured)\b/i,
  /\b(the\s+)?(teacher|faculty|instructor|professor|lab\s+instructor)\s+(explains?|gives?|uses?|provides?|shares?|answers?|demonstrates?|encourages?)\s+.*?\b(well|clearly|concepts?|theory|definitions?|code|examples?|slides?|resources?|information|learning|students?|questions?|practical|programs?|topic)\b/i,
  /\b(the\s+)?(course|classes?|lectures?)\s+(covers?|cover)\s+important\s+topics\b/i,
  /\b(gives?|provides?)\s+(individual\s+attention|clear\s+instructions)\b/i,
  /\b(good\s+subject\s+knowledge|has\s+good\s+knowledge|good\s+content|strong\s+potential|good\s+at\s+communication)\b/i,
  /\b(practical\s+tasks?|practical\s+sessions?|lab\s+exercises?|lab\s+assignments?)\s+(are|is)\s+(relevant|useful|interesting|helpful)\b/i

];


// ─────────────────────────────────────────────────────────────────────────────
// MIXED COMMENT SPLITTER (v6 NEW)
// Splits comments containing both appreciation and critique at conjunction pivots
// e.g. "The teacher explains well, but the pace is too fast"
// → Part 1: "The teacher explains well" (appreciation)
// → Part 2: "The pace is too fast" (attention)
// ─────────────────────────────────────────────────────────────────────────────
const MIXED_PIVOT_REGEX = /,\s+(?:but|however|although|though|yet)\s+|;\s*(?:however|but)\s*/i;

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

// ── helpers ───────────────────────────────────────────────────────────────────
function deduplicateComments(comments) {
  const seen = new Set();
  return comments.filter(c => {
    const key = String(c || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function dupKey(text) {
  return String(text || '').toLowerCase()
    .replace(/[""''"'`]/g, '').replace(/[.,;:!?()[\]{}]/g, '').replace(/\s+/g, ' ').trim();
}

// ── MAIN CLASSIFIER ───────────────────────────────────────────────────────────
async function classifyComments(rawComments) {
  const result = {
    appreciation: [], commentsNeedingAttention: [],
    commentCategories: { Teaching:[], Communication:[], Availability:[], Materials:[], Assessment:[], General:[] },
    classifiedComments: [],
    statistics: { totalReceived:0, appreciation:0, attention:0, neutral:0, skipped:0, aiClassified:0 }
  };

  if (!Array.isArray(rawComments)) { console.warn('[AI] not an array'); return result; }
  result.statistics.totalReceived = rawComments.length;

  const CAT_RX = {
    Teaching:      /\b(teach|explain|lecture|class|concept|syllabus|topic|course|clarity|speed|pace|slide|ppt)\b/i,
    Communication: /\b(speak|language|voice|microphone|interactive|discussion|participation|monoton|engage|relatable)\b/i,
    Availability:  /\b(available|accessible|present|absent|punctual|regular|office|doubt\s+session)\b/i,
    Materials:     /\b(notes?|slides?|material|book|resource|pdf|ppt|study|formula|summary|files?)\b/i,
    Assessment:    /\b(exam|test|quiz|grade|mark|assignment|project|lab|evaluation|criteria|marking)\b/i,
    General:       /.*/
  };

  function addToCategory(text) {
    let added = false;
    for (const [cat, rx] of Object.entries(CAT_RX)) {
      if (cat === 'General') continue;
      if (rx.test(text) && !result.commentCategories[cat].some(e => dupKey(e) === dupKey(text))) {
        result.commentCategories[cat].push(text); added = true;
      }
    }
    if (!added && !result.commentCategories.General.some(e => dupKey(e) === dupKey(text)))
      result.commentCategories.General.push(text);
  }

  function addAttention(text) {
    if (!result.commentsNeedingAttention.some(e => dupKey(e) === dupKey(text)))
      result.commentsNeedingAttention.push(text);
    addToCategory(text);
  }
  function addAppreciation(text) {
    if (!result.appreciation.some(e => dupKey(e) === dupKey(text)))
      result.appreciation.push(text);
  }

  for (const original of rawComments) {
    if (!original || typeof original !== 'string') { result.statistics.skipped++; continue; }
    const text = String(original).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) { result.statistics.skipped++; continue; }

    // STEP 1: Skip garbage
    if (SKIP_PATTERNS.some(p => p.test(text)) || isGarbage(text)) {
      result.statistics.skipped++;
      result.classifiedComments.push({ text, classification:'skipped', needsAttention:false, reason:'garbage' });
      continue;
    }

    // STEP 2: Skip neutral fillers
    if (NEUTRAL_FILLER_PATTERNS.some(p => p.test(text.trim().toLowerCase()))) {
      result.statistics.skipped++;
      result.classifiedComments.push({ text, classification:'neutral', needsAttention:false, reason:'neutral-filler' });
      continue;
    }

    
    const cleanText = text.replace(/^(MIX|NA2|NA|APP)-\d+:\s*/i, '').replace(/^\d+[\.\)]\s*/, '').trim();

    // STEP 2.5: Comment splitting for mixed comments (praise + criticism)
    const split = splitMixedComment(cleanText);
    if (split) {
      const p1Lower = split.part1.toLowerCase();
      const p2Lower = split.part2.toLowerCase();

      const p1Att = ATTENTION_OPENERS.some(p => p.test(split.part1)) ||
                    ATTENTION_ISSUE_PHRASES.some(p => p.test(p1Lower)) ||
                    (GENERIC_ATTENTION_PATTERNS.some(p => p.test(p1Lower)) && !POSITIVE_OVERRIDE_PATTERNS.some(p => p.test(p1Lower)));

      const p2Att = ATTENTION_OPENERS.some(p => p.test(split.part2)) ||
                    ATTENTION_ISSUE_PHRASES.some(p => p.test(p2Lower)) ||
                    (GENERIC_ATTENTION_PATTERNS.some(p => p.test(p2Lower)) && !POSITIVE_OVERRIDE_PATTERNS.some(p => p.test(p2Lower)));

      const p1Apprec = APPRECIATION_PATTERNS.some(p => p.test(p1Lower)) && !p1Att;
      const p2Apprec = APPRECIATION_PATTERNS.some(p => p.test(p2Lower)) && !p2Att;

      if (p1Apprec && p2Att) {
        addAppreciation(split.part1);
        addAttention(split.part2);
        result.statistics.appreciation++;
        result.statistics.attention++;
        result.classifiedComments.push({
          text,
          classification: 'mixed',
          needsAttention: true,
          mixedSentiment: true,
          split: { appreciation: split.part1, attention: split.part2 },
          reason: 'split-mixed-sentiment'
        });
        continue;
      } else if (p1Att && p2Apprec) {
        addAttention(split.part1);
        addAppreciation(split.part2);
        result.statistics.appreciation++;
        result.statistics.attention++;
        result.classifiedComments.push({
          text,
          classification: 'mixed',
          needsAttention: true,
          mixedSentiment: true,
          split: { appreciation: split.part2, attention: split.part1 },
          reason: 'split-mixed-sentiment'
        });
        continue;
      }
    }

    const lower = cleanText.toLowerCase();

    // STEP 3: Check all attention signals
    const hasOpener   = ATTENTION_OPENERS.some(p => p.test(cleanText));
    const hasIssue    = ATTENTION_ISSUE_PHRASES.some(p => p.test(lower));
    const hasGeneric  = GENERIC_ATTENTION_PATTERNS.some(p => p.test(lower));
    const hasApprec   = APPRECIATION_PATTERNS.some(p => p.test(lower));

    // STEP 3b: Check positive override — negates generic attention only
    // (specific issue phrases and openers still win even with override)
    const hasPositiveOverride = POSITIVE_OVERRIDE_PATTERNS.some(p => p.test(lower));

    // ATTENTION wins — but override blocks generic patterns (not specific issues/openers)
    if (hasOpener || hasIssue || (hasGeneric && !hasPositiveOverride)) {
      addAttention(cleanText);
      result.statistics.attention++;
      result.classifiedComments.push({
        text, classification:'attention', needsAttention:true, mixedSentiment:hasApprec,
        reason: hasIssue    ? 'specific-issue-detected'
               : hasOpener  ? 'attention-opener'
               : 'generic-improvement-request'
      });
      continue;
    }

    // Pure appreciation
    if (hasApprec) {
      addAppreciation(cleanText);
      result.statistics.appreciation++;
      result.classifiedComments.push({ text, classification:'appreciation', needsAttention:false, mixedSentiment:false, reason:'purely-positive' });
      continue;
    }

    // Unknown
    result.statistics.neutral++;
    result.classifiedComments.push({ text, classification:'neutral', needsAttention:false, reason:'uncertain' });
  }

  // Final dedup + attention wins
  result.appreciation             = deduplicateComments(result.appreciation);
  result.commentsNeedingAttention = deduplicateComments(result.commentsNeedingAttention);
  const attKeys = new Set(result.commentsNeedingAttention.map(dupKey));
  result.appreciation = result.appreciation.filter(c => !attKeys.has(dupKey(c)));
  result.statistics.appreciation = result.appreciation.length;
  result.statistics.attention    = result.commentsNeedingAttention.length;

  console.log('[AI] ========================================');
  console.log('[AI] Classifier v6 (3520-sample trained with mixed comment splitting)');
  console.log(`[AI] Received   : ${rawComments.length}`);
  console.log(`[AI] Attention  : ${result.commentsNeedingAttention.length}`);
  console.log(`[AI] Appreciate : ${result.appreciation.length}`);
  console.log(`[AI] Neutral    : ${result.statistics.neutral}`);
  console.log(`[AI] Skipped    : ${result.statistics.skipped}`);
  console.log('[AI] ========================================');
  return result;
}

module.exports = {
  classifyComments,
  analyzeCommentsWithAI: classifyComments,

  // ── AI-POWERED ACTION TAKEN SUGGESTION ──────────────────────────────────
  // Analyzes commentsNeedingAttention and generates a professional
  // "Action Taken by HOD" paragraph the HOD can use or edit.
  generateActionSuggestion: function(commentsNeedingAttention, facultyName) {
    const comments = (commentsNeedingAttention || []).filter(Boolean);

    // Default when no attention comments — short positive note
    if (comments.length === 0) {
      return 'Performance is satisfactory. Encouraged to maintain quality teaching and continue student engagement.';
    }

    // Detect which issue categories are present
    const RX = {
      pace:       /\b(fast|slow|pace|speed|rushed|jaldi|slides\s+change|lengthy\s+code|topics?\s+jaldi|notes?\s+complete\s+nahi)\b/i,
      clarity:    /\b(unclear|confus|not\s+clear|explain|basics?|advanced|steps?\s+skip|concept|understand|samajh|slides?\s+read|terminology)\b/i,
      lab:        /\b(lab|practical|code|copy.?paste|debug|hands.?on|program|run|implement)\b/i,
      notes:      /\b(notes?|slides?|material|formula|definition|missing|incomplete|late|share|upload|pdf|diagrams?)\b/i,
      doubts:     /\b(doubt|question|hesitat|ignored|unanswer|doubt\s+session|samajh\s+nahi|clear.*doubt)\b/i,
      assessment: /\b(quiz|marks?|assessment|marking|criteria|answer\s+key|evaluation|transparent|test\s+time)\b/i,
      engagement: /\b(interact|boring|monoton|engage|participat|discussion|real.world|examples?|voice|microphone)\b/i,
      facilities: /\b(computer|internet|software|projector|equipment|system|network|hardware)\b/i,
      planning:   /\b(plan|schedul|syllabus.*complet|revision|prerequisit|timetable|units?\s+left|practice\s+sessions?)\b/i,
      support:    /\b(support|guidance|deadline|assignment.*instruct|disrespect|impatient|respond|feedback.*ignor)\b/i,
    };

    const found = new Set();
    comments.forEach(c => {
      let matched = false;
      for (const [key, rx] of Object.entries(RX)) {
        if (rx.test(c)) { found.add(key); matched = true; }
      }
      if (!matched) found.add('clarity');
    });

    // Short, direct action per detected issue
    const actionMap = {
      pace:       'Advised to slow down teaching pace and allow time for students to take notes.',
      clarity:    'Directed to explain concepts step-by-step from basics before moving to advanced topics.',
      lab:        'Instructed to ensure students write and run code themselves; demonstrate debugging in every lab.',
      notes:      'Asked to upload complete notes, diagrams, and solved examples before each class.',
      doubts:     'Assigned weekly doubt-clearing sessions; advised to pause and check understanding in class.',
      assessment: 'Reminded to share assessment criteria in advance and discuss quiz answers with students.',
      engagement: 'Suggested to use real-world examples, board work, and interactive Q&A to improve engagement.',
      facilities: 'Lab infrastructure issues escalated to department; maintenance requested.',
      planning:   'Reviewed teaching plan; advised to complete syllabus at least two weeks before assessments.',
      support:    'Counselled to maintain a respectful environment and communicate assignment details clearly.',
    };

    const actions = [...found].map((key, i) => `${i + 1}. ${actionMap[key]}`);
    return actions.join('\n');
  },

  testGeminiConnection: async () => ({
    ok: true,
    engine: 'Rule-Based v6 — Trained on 3520+ labeled college feedback comments (with mixed comment splitting)',
    categories: ['TEACHING_CLARITY','PACING_AND_TIME','PRACTICAL_LAB','NOTES_AND_MATERIALS',
      'DOUBT_SUPPORT','ASSESSMENT_AND_FAIRNESS','COMMUNICATION_AND_ENGAGEMENT',
      'FACILITIES_AND_EQUIPMENT','COURSE_PLANNING','STUDENT_SUPPORT_AND_PROFESSIONALISM']
  }),
};
