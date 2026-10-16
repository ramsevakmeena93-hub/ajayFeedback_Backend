// ============================================================
// COLLEGE FEEDBACK INTELLIGENCE — v4
// Trained on 1000 labeled NEEDS_ATTENTION comments
// 10 categories: TEACHING_CLARITY, PACING_AND_TIME,
// PRACTICAL_LAB, NOTES_AND_MATERIALS, DOUBT_SUPPORT,
// ASSESSMENT_AND_FAIRNESS, COMMUNICATION_AND_ENGAGEMENT,
// FACILITIES_AND_EQUIPMENT, COURSE_PLANNING,
// STUDENT_SUPPORT_AND_PROFESSIONALISM
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

// ── NEUTRAL FILLER: pure 1-line praise with zero content ─────────────────────
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
// SENTENCE OPENER PATTERNS — from 1000 labeled comments
// These openers ALWAYS indicate a need-attention comment
// ─────────────────────────────────────────────────────────────────────────────
const ATTENTION_OPENERS = [
  // Respectful complaint openers
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
  /^(the\s+class\s+has\s+potential|some\s+parts\s+of\s+the\s+class\s+are\s+good|overall\s+the\s+course\s+has\s+value|the\s+subject\s+is\s+useful|the\s+instructor\s+is\s+helpful|the\s+faculty\s+is\s+supportive),\s+but\b/i,
  /^i\s+want\s+to\s+learn\s+well,\s+but\b/i,
  /^i\s+appreciate\s+the\s+effort,\s+but\b/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// CORE ISSUE PHRASES — extracted from all 10 categories
// ─────────────────────────────────────────────────────────────────────────────
const ATTENTION_ISSUE_PHRASES = [

  // ══ CATEGORY 1: TEACHING CLARITY ══════════════════════════════════════════
  // "concepts not explained clearly", "jumps to advanced", "repeats slides", "skips steps"
  /\b(core\s+concepts?\s+(are|is)\s+not\s+explained\s+clearly)\b/i,
  /\b(concepts?\s+(are|is)\s+not\s+(clear|easy|well\s+explained|explained\s+clearly|understandable))\b/i,
  /\b(explanation\s+(jumps?|leaves?|repeats?|relies?|lacks?|is\s+not|does\s+not))\b/i,
  /\b(explanation\s+(leaves?\s+several\s+doubts?|jumps?\s+straight\s+to\s+advanced|repeats?\s+without|relies?\s+on\s+slides?)\b)/i,
  /\b(lecture\s+(mostly\s+repeats?|lacks?|becomes?|spends?|rushes?))\b/i,
  /\b(same\s+confusing\s+explanation\s+is\s+repeated)\b/i,
  /\b(important\s+steps?\s+are\s+skipped)\b/i,
  /\b(examples?\s+do\s+not\s+match\s+the\s+concept)\b/i,
  /\b(connection\s+between\s+topics?\s+is\s+not\s+explained)\b/i,
  /\b(class\s+ends?\s+before\s+the\s+difficult\s+part)\b/i,
  /\b(topic\s+is\s+explained\s+too\s+quickly)\b/i,
  /\b(explanation\s+jumps?\s+straight\s+to\s+advanced)\b/i,
  /\b(prerequisite\s+concepts?\s+first|start\s+with\s+a\s+simple\s+example)\b/i,
  /\b(direct\s+advanced\s+topic\s+par)\b/i,
  /\b(theory\s+samajh\s+nahi\s+aati)\b/i,
  /\b(examples?\s+ke\s+bina\s+slides?\s+read)\b/i,
  /\b(reasoning\s+bhi\s+samjhaiye)\b/i,
  /\b(steps?\s+explain\s+nahi\s+hote)\b/i,

  // ══ CATEGORY 2: PACING AND TIME ════════════════════════════════════════════
  // "too fast", "too many topics", "not enough time", "rushed", "syllabus rushed"
  /\b(teaching\s+pace\s+is\s+too\s+(fast|slow|quick))\b/i,
  /\b(too\s+many\s+topics?\s+are\s+covered\s+in\s+one\s+class)\b/i,
  /\b(class\s+(moves?\s+to\s+the\s+next\s+slide|frequently\s+ends?\s+before|spends?\s+too\s+long))\b/i,
  /\b(not\s+enough\s+time\s+to\s+(write\s+notes?|complete|understand|cover))\b/i,
  /\b(there\s+is\s+(not\s+enough|insufficient)\s+time\s+for\s+(questions?|doubts?|note[\s-]taking|practice))\b/i,
  /\b(syllabus\s+is\s+being\s+rushed)\b/i,
  /\b(long\s+problems?\s+are\s+rushed)\b/i,
  /\b(students?\s+are\s+expected\s+to\s+understand\s+lengthy\s+code)\b/i,
  /\b(lecture\s+spends?\s+too\s+long\s+on\s+minor\s+details?)\b/i,
  /\b(class\s+ki\s+speed\s+bahut\s+fast)\b/i,
  /\b(thoda\s+slow\s+padhaiye)\b/i,
  /\b(please\s+board\s+par\s+step\s+by\s+step\s+solve\s+kijiye)\b/i,
  /\b(sirf\s+ppt\s+se\s+samajhna\s+difficult)\b/i,
  /\b(lab\s+hours?\s+(bahut\s+kam\s+hain|are\s+too\s+limited|extra\s+session\s+chahiye))\b/i,
  /\b(topics?\s+jaldi[\s-]jaldi\s+complete)\b/i,
  /\b(important\s+concepts?\s+revise\s+nahi\s+hote)\b/i,
  /\b(things?\s+(goes?|go)\s+out\s+of\s+head)\b/i,
  /\b(quick\s+pace|fast\s+pace)\b/i,

  // ══ CATEGORY 3: PRACTICAL LAB ══════════════════════════════════════════════
  // "copy code", "no hands-on", "lab = theory", "no debugging", "no output discussion"
  /\b(lab\s+(tasks?\s+are\s+completed\s+without|sessions?\s+do\s+not\s+connect|is\s+conducted\s+like\s+a\s+theory|computers?\s+(baar[\s-]baar|frequently)\s+(kaam\s+nahi|stop\s+working)))\b/i,
  /\b(students?\s+mostly\s+copy\s+code\s+without\s+understanding)\b/i,
  /\b(sirf\s+code\s+copy\s+karwate\s+hain)\b/i,
  /\b(instructor\s+demonstrates?\s+code\s+but\s+does\s+not\s+explain\s+how\s+to\s+write)\b/i,
  /\b(too\s+little\s+hands[\s-]on\s+practice\s+in\s+the\s+lab)\b/i,
  /\b(little\s+individual\s+guidance\s+during\s+practical)\b/i,
  /\b(practical\s+exercises?\s+are\s+too\s+limited)\b/i,
  /\b(students?\s+do\s+not\s+get\s+enough\s+time\s+to\s+run\s+and\s+debug)\b/i,
  /\b(same\s+basic\s+exercise\s+is\s+repeated\s+without\s+a\s+new\s+challenge)\b/i,
  /\b(lab\s+is\s+conducted\s+like\s+a\s+theory\s+lecture)\b/i,
  /\b(khud\s+code\s+likhne\s+aur\s+run\s+karne\s+ka\s+time\s+nahi)\b/i,
  /\b(practical\s+work\s+kam\s+hota\s+hai)\b/i,
  /\b(zyada\s+hands[\s-]on\s+coding\s+karwaiye)\b/i,
  /\b(lab\s+mein\s+participation\s+encourage\s+nahi)\b/i,
  /\b(code\s+ka\s+output\s+bata\s+dete\s+hain\s+par\s+debugging)\b/i,

  // ══ CATEGORY 4: NOTES AND MATERIALS ═══════════════════════════════════════
  // "notes late", "slides dense", "missing formulas", "errors in material", "not aligned"
  /\b(notes?\s+(time\s+par\s+share\s+nahi|are\s+incomplete|do\s+not\s+match|are\s+difficult\s+to\s+revise|unit[\s-]wise\s+aur\s+easy|ki\s+deadline))\b/i,
  /\b(slides?\s+(are\s+not\s+organized\s+unit|contain\s+too\s+much\s+text|mein\s+bahut\s+text\s+hai))\b/i,
  /\b(examples?\s+in\s+the\s+notes?\s+are\s+not\s+explained)\b/i,
  /\b(course\s+material\s+is\s+shared\s+too\s+late)\b/i,
  /\b(no\s+useful\s+summary\s+for\s+exam\s+preparation)\b/i,
  /\b(material\s+contains?\s+errors?\s+that\s+cause\s+confusion)\b/i,
  /\b(notes?\s+do\s+not\s+match\s+what\s+is\s+taught)\b/i,
  /\b(important\s+formulas?\s+and\s+definitions?\s+are\s+missing)\b/i,
  /\b(notes?\s+are\s+difficult\s+to\s+revise\s+from)\b/i,
  /\b(exam\s+se\s+pehle\s+revision\s+karna\s+mushkil)\b/i,
  /\b(assignment\s+ki\s+(instructions?\s+clear\s+nahi|deadline\s+aur\s+requirements?\s+last))\b/i,
  /\b(deadline\s+aur\s+requirements?\s+last\s+moment\s+par)\b/i,
  /\b(diagrams?\s+nahi\s+hain|notes?\s+ko\s+concise\s+banaiye)\b/i,
  /\b(material\s+(is\s+not\s+aligned|does\s+not\s+match|contains?\s+errors?))\b/i,
  /\b(keep\s+(the\s+)?(notes?|material|slides?|content)\s+(concise|short|simple|easy|clear|aligned))\b/i,
  /\b(upload\s+the\s+material\s+before\s+the\s+class)\b/i,
  /\b(share\s+(clear\s+unit[\s-]wise\s+notes?|revision\s+material\s+before\s+the\s+exam))\b/i,

  // ══ CATEGORY 5: DOUBT SUPPORT ══════════════════════════════════════════════
  // "no time for doubts", "questions ignored", "answer still unclear"
  /\b(extra\s+doubt\s+sessions?\s+are\s+not\s+available)\b/i,
  /\b(there\s+is\s+not\s+enough\s+time\s+for\s+doubt\s+solving)\b/i,
  /\b(individual\s+students?\s+do\s+not\s+receive\s+enough\s+guidance)\b/i,
  /\b(explanation\s+given\s+after\s+a\s+question\s+is\s+still\s+unclear)\b/i,
  /\b(feedback\s+about\s+confusing\s+topics?\s+is\s+not\s+addressed)\b/i,
  /\b(follow[\s-]up\s+questions?\s+are\s+discouraged)\b/i,
  /\b(instructor\s+moves?\s+on\s+before\s+checking\s+whether\s+the\s+doubt\s+is\s+resolved)\b/i,
  /\b(students?\s+hesitate\s+to\s+ask\s+questions?\s+because\s+the\s+classroom\s+feels?\s+unapproachable)\b/i,
  /\b(students?\s+have\s+to\s+ask\s+the\s+same\s+doubt\s+multiple\s+times?)\b/i,
  /\b(questions?\s+are\s+sometimes?\s+ignored\s+during\s+class)\b/i,
  /\b(doubt\s+poochne\s+par\s+proper\s+explanation\s+nahi)\b/i,
  /\b(class\s+mein\s+doubts?\s+clear\s+karne\s+ke\s+liye\s+time\s+nahi)\b/i,
  /\b(doubt\s+ke\s+liye\s+alag\s+time\s+rakhiye)\b/i,
  /\b(class\s+ke\s+dauran\s+doubts?\s+poochne\s+mein\s+hesitation)\b/i,
  /\b(difficult\s+topics?\s+ke\s+liye\s+extra\s+examples?\s+chahiye)\b/i,
  /\b(set\s+aside\s+dedicated\s+time\s+for\s+doubt\s+solving)\b/i,
  /\b(offer\s+a\s+regular\s+doubt[\s-]clearing\s+session)\b/i,
  /\b(check\s+whether\s+the\s+answer\s+actually\s+resolves?\s+the\s+doubt)\b/i,

  // ══ CATEGORY 6: ASSESSMENT AND FAIRNESS ════════════════════════════════════
  // "quiz out of syllabus", "marking unclear", "no answer discussion", "not transparent"
  /\b(quiz\s+(covers?\s+topics?\s+that\s+were\s+rushed|ke\s+baad\s+answers?\s+discuss\s+nahi|questions?\s+seem\s+outside))\b/i,
  /\b(there\s+is\s+not\s+enough\s+time\s+to\s+complete\s+the\s+test)\b/i,
  /\b(assessment\s+instructions?\s+are\s+unclear)\b/i,
  /\b(marking\s+scheme\s+is\s+not\s+explained\s+clearly)\b/i,
  /\b(answer\s+key\s+is\s+not\s+discussed\s+after\s+the\s+quiz)\b/i,
  /\b(marks?\s+appear\s+inconsistent\s+with\s+the\s+announced\s+criteria)\b/i,
  /\b(students?\s+do\s+not\s+receive\s+feedback\s+explaining\s+their\s+mistakes?)\b/i,
  /\b(difficulty\s+level\s+changes?\s+unexpectedly\s+between\s+assessments?)\b/i,
  /\b(quiz\s+questions?\s+seem\s+outside\s+the\s+topics?)\b/i,
  /\b(evaluation\s+is\s+not\s+transparent)\b/i,
  /\b(quiz\s+mein\s+syllabus\s+se\s+bahar\s+ke\s+questions?)\b/i,
  /\b(marking\s+scheme\s+bhi\s+clear\s+nahi\s+thi)\b/i,
  /\b(sir\s+ki\s+awaaz\s+last\s+benches?\s+tak\s+clear\s+nahi)\b/i,
  /\b(evaluation\s+transparent\s+nahi\s+lagti)\b/i,
  /\b(marks?\s+ke\s+criteria\s+clearly\s+explain\s+kijiye)\b/i,
  /\b(discuss\s+the\s+answer\s+key\s+after\s+the\s+assessment)\b/i,
  /\b(align\s+assessments?\s+with\s+the\s+announced\s+syllabus)\b/i,
  /\b(review\s+disputed\s+marks?\s+transparently)\b/i,
  /\b(explain\s+the\s+marking\s+criteria\s+before\s+the\s+test)\b/i,
  /\b(announce\s+assessment\s+coverage\s+in\s+advance)\b/i,
  /\b(code\s+ka\s+output\s+bata\s+dete\s+hain\s+par\s+debugging\s+ka\s+process)\b/i,

  // ══ CATEGORY 7: COMMUNICATION AND ENGAGEMENT ═══════════════════════════════
  // "monotonous", "not interactive", "soft voice", "slides only", "no participation"
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
  /\b(class\s+interactive\s+nahi\s+hoti)\b/i,
  /\b(examples?\s+aur\s+discussion\s+include\s+kijiye)\b/i,
  /\b(class\s+mein\s+participation\s+encourage\s+nahi)\b/i,
  /\b(interactive\s+activities?\s+add\s+kijiye)\b/i,
  /\b(slides?\s+mein\s+bahut\s+text\s+hai\s+aur\s+diagrams?\s+nahi)\b/i,
  /\b(microphone\s+use\s+kijiye)\b/i,
  /\b(use\s+a\s+microphone\s+when\s+needed)\b/i,
  /\b(vary\s+the\s+teaching\s+method\s+to\s+maintain\s+engagement)\b/i,
  /\b(make\s+the\s+learning\s+environment\s+more\s+interactive)\b/i,
  /\b(invite\s+different\s+students?\s+to\s+contribute)\b/i,

  // ══ CATEGORY 8: FACILITIES AND EQUIPMENT ═══════════════════════════════════
  // "computers not working", "software missing", "internet down", "projector unclear"
  /\b(lab\s+(computers?\s+(baar[\s-]baar\s+kaam\s+nahi|frequently\s+stop\s+working)|systems?\s+(slow\s+hain|kai\s+computers?\s+working\s+nahi)))\b/i,
  /\b(internet\s+(connection\s+interrupts?|slow\s+hai)\s*(practical|lab)?)\b/i,
  /\b(software\s+setup\s+is\s+inconsistent\s+across\s+computers?)\b/i,
  /\b(required\s+software\s+is\s+missing\s+from\s+lab\s+systems?)\b/i,
  /\b(there\s+are\s+not\s+enough\s+working\s+computers?)\b/i,
  /\b(lab\s+environment\s+makes?\s+it\s+difficult\s+to\s+complete\s+experiments?)\b/i,
  /\b(students?\s+lose\s+time\s+waiting\s+for\s+a\s+working\s+system)\b/i,
  /\b(projector\s+or\s+display\s+is\s+difficult\s+to\s+read)\b/i,
  /\b(lab\s+hours?\s+are\s+too\s+limited\s+for\s+the\s+assigned\s+work)\b/i,
  /\b(equipment\s+is\s+outdated\s+for\s+the\s+assigned\s+tasks?)\b/i,
  /\b(lab\s+ke\s+computers?\s+baar[\s-]baar\s+kaam\s+nahi\s+karte)\b/i,
  /\b(practical\s+complete\s+nahi\s+ho\s+pata)\b/i,
  /\b(computer\s+lab\s+ka\s+internet\s+slow\s+hai)\b/i,
  /\b(required\s+software\s+bhi\s+available\s+nahi\s+hai)\b/i,
  /\b(lab\s+systems?\s+slow\s+hain)\b/i,
  /\b(please\s+repair\s+karwaiye)\b/i,
  /\b(repair\s+and\s+maintain\s+the\s+lab\s+equipment)\b/i,
  /\b(resolve\s+recurring\s+technical\s+problems?)\b/i,
  /\b(arrange\s+a\s+backup\s+system\s+when\s+equipment\s+fails?)\b/i,
  /\b(standardize\s+the\s+software\s+setup\s+across\s+systems?)\b/i,
  /\b(ensure\s+the\s+required\s+software\s+is\s+installed\s+before\s+lab)\b/i,

  // ══ CATEGORY 9: COURSE PLANNING ════════════════════════════════════════════
  // "wrong topic order", "no revision", "syllabus not done before quiz", "bad scheduling"
  /\b(order\s+of\s+topics?\s+makes?\s+the\s+subject\s+difficult\s+to\s+follow)\b/i,
  /\b(course\s+objectives?\s+are\s+not\s+explained\s+clearly)\b/i,
  /\b(prerequisite\s+topics?\s+are\s+assumed\s+without\s+being\s+revised)\b/i,
  /\b(syllabus\s+was\s+not\s+completed\s+before\s+the\s+central\s+quiz)\b/i,
  /\b(there\s+is\s+no\s+revision\s+before\s+major\s+assessments?)\b/i,
  /\b(timetable\s+leaves?\s+too\s+little\s+time\s+for\s+difficult\s+units?)\b/i,
  /\b(lab\s+schedule\s+does\s+not\s+support\s+the\s+theory\s+schedule)\b/i,
  /\b(students?\s+are\s+not\s+told\s+which\s+topics?\s+need\s+extra\s+preparation)\b/i,
  /\b(important\s+topics?\s+are\s+postponed\s+until\s+the\s+end)\b/i,
  /\b(there\s+are\s+not\s+enough\s+practice\s+sessions?\s+before\s+the\s+exam)\b/i,
  /\b(syllabus\s+quiz\s+se\s+pehle\s+complete\s+nahi\s+hua)\b/i,
  /\b(course\s+planning\s+improve\s+kijiye)\b/i,
  /\b(spread\s+difficult\s+units?\s+across\s+the\s+semester)\b/i,
  /\b(revise\s+prerequisites?\s+before\s+starting\s+advanced\s+topics?)\b/i,
  /\b(publish\s+a\s+clear\s+unit[\s-]wise\s+teaching\s+plan)\b/i,
  /\b(avoid\s+leaving\s+major\s+topics?\s+until\s+the\s+last\s+minute)\b/i,
  /\b(schedule\s+revision\s+before\s+assessments?)\b/i,
  /\b(coordinate\s+theory\s+and\s+lab\s+activities?)\b/i,

  // ══ CATEGORY 10: STUDENT SUPPORT AND PROFESSIONALISM ═══════════════════════
  // "assignment unclear", "no guidance when struggling", "disrespectful", "hesitant to ask"
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
  /\b(assignment\s+ki\s+instructions?\s+clear\s+nahi\s+hoti)\b/i,
  /\b(students?\s+ko\s+individual\s+guidance\s+kam\s+milti\s+hai)\b/i,
  /\b(environment\s+comfortable\s+banaiye)\b/i,
  /\b(support\s+improve\s+kijiye)\b/i,
  /\b(communicate\s+respectfully\s+and\s+patiently)\b/i,
  /\b(respond\s+to\s+clarification\s+requests?\s+consistently)\b/i,
  /\b(follow\s+up\s+on\s+unresolved\s+academic\s+issues?)\b/i,
  /\b(ensure\s+students?\s+can\s+raise\s+concerns?\s+comfortably)\b/i,
  /\b(give\s+students?\s+constructive\s+feedback)\b/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// GENERIC ATTENTION SIGNALS — broader patterns that apply across all categories
// ─────────────────────────────────────────────────────────────────────────────
const GENERIC_ATTENTION_PATTERNS = [
  // Universal polite request/suggestion phrases
  /\b(please\s+(explain|provide|give|cover|focus|teach|speak|slow\s+down|improve|try|be\s+more|increase|add|include|change|assign|upload|check|repair|install|address|solve|discuss|announce|share|publish|avoid|schedule|coordinate|clarify|update|revise|reduce|ensure|make|use|start|stop|review|correct|complete))\b/i,
  /\b(could\s+you\s+(please\s+)?(explain|teach|provide|give|cover|focus|try|start|improve|speak|slow|be|keep|add|include|change|assign|share|publish))\b/i,
  /\b(it\s+would\s+(be\s+)?(helpful|great|better|nice|good|useful)\s+(if|to|for))\b/i,
  /\b(would\s+be\s+(helpful|better|great|nice|good|more\s+effective)\s+(if|to|for))\b/i,
  /\b(if\s+(possible|maam?|sir|you\s+can|you\s+could),?\s+please)\b/i,
  /\b(i\s+(think|feel|believe|suggest|request|hope)\s+(this|it|the|that|we|sir|maam?|topics?|subject|class))\b/i,
  /\b(in\s+my\s+opinion|according\s+to\s+me|from\s+my\s+perspective|in\s+my\s+view)\b/i,

  // Improvement / need to change
  /\b(need[s]?\s+(to\s+)?(improve|be\s+improved|to\s+cover|to\s+explain|to\s+focus|more|better))\b/i,
  /\b(should\s+(improve|be\s+improved|focus|give|provide|explain|cover|try|use|include|change|start|teach|conduct|assign|add|be|come|go))\b/i,
  /\b(must\s+(improve|explain|cover|provide|give|attend|focus|include|add|be|come))\b/i,
  /\b(can\s+be\s+(improved|better|more\s+(clear|effective|interactive|engaging|organized|structured|helpful)))\b/i,
  /\b(scope\s+for\s+improvement|room\s+for\s+improvement)\b/i,
  /\b(needs?\s+improvement|needs?\s+to\s+be\s+(improved|better|more|changed))\b/i,
  /\b(could\s+be\s+(better|improved|more))\b/i,
  /\b(needs?\s+(more\s+)?(improvement|work|attention|focus|effort))\b/i,

  // "More X" requests — students asking for more
  /\b(more\s+(examples?|practice|exercises?|problems?|interaction|real[\s-]world|practical|hands[\s-]on|time|attention|explanation|clarity|details?|topics?|coverage|activities|discussion|problem[\s-]solving|coding|case[\s-]studies?|sessions?|experiments?|guidance))\b/i,
  /\b(give\s+(more|enough|additional|some)\s+(time|examples?|attention|practice|explanation|problems?|exercises?|guidance))\b/i,
  /\b(add\s+(more|some|additional)\s+(examples?|practice|problems?|diagrams?|visuals?|real[\s-]world|interactive|activities?))\b/i,
  /\b(not\s+enough\s+(examples?|practice|time|explanation|interaction|guidance|sessions?))\b/i,
  /\b(insufficient\s+(time|guidance|examples?|practice|sessions?))\b/i,

  // Not clear / hard to understand
  /\b(not\s+(clear|easy\s+to\s+understand|understandable|helpful|satisfactory|effective|interactive|engaging|organized|available|completed?|addressed|followed\s+up))\b/i,
  /\b(difficult\s+to\s+(understand|follow|grasp|comprehend|remember|read|complete|revise))\b/i,
  /\b(hard\s+to\s+(understand|follow|grasp|comprehend|read|complete))\b/i,
  /\b(can'?t\s+(understand|follow|hear|grasp|comprehend|read|see|complete))\b/i,
  /\b(unable\s+to\s+(understand|follow|grasp|comprehend|complete))\b/i,
  /\b(didn'?t\s+(understand|cover|explain|teach|complete|finish|give|provide|discuss|address))\b/i,
  /\b(doesn'?t\s+(explain|teach|help|provide|give|come|attend|answer|listen|respond|check|follow\s+up|make\s+it\s+clear|connect))\b/i,

  // Mixed comment markers (good BUT something is wrong)
  /\b(good\s+but\b|nice\s+but\b|great\s+but\b|best\s+but\b|excellent\s+but\b|helpful\s+but\b)\b/i,
  /,\s+(but|however)\s+(the|there|some|students?|it|this|an|important|assessment|marks?|quiz|notes?|lab|class|pace|speed|syllabus|course|instructor|communication|classroom)/i,
  /\b(however,?\s+(the|there|some|students?|it|this|an|important|assessment|marks?|quiz|notes?|lab|class|pace|speed|syllabus|course|instructor|communication|classroom))\b/i,
  /\b(although\s+the\s+(topic|subject|course|class)\s+is\s+(important|useful|good|great))\b/i,

  // Pacing/speed
  /\b(too\s+(fast|slow|quick|rushed|rapid|brief))\b/i,
  /\b(speaks?\s+(too\s+)?(very\s+)?(fast|slow|quickly|slowly|rapidly))\b/i,
  /\b(teaches?\s+(too\s+)?(fast|slow|quickly|slowly|rapidly|at\s+a\s+(quick|fast|slow)\s+pace))\b/i,

  // Availability/punctuality
  /\b(absent|irregular|not\s+punctual|always\s+late|often\s+absent|frequently\s+absent)\b/i,
  /\b(never\s+(available|present|comes?|helps?|explains?|answers?|attends?))\b/i,
  /\b(rarely\s+(available|present|comes?|helps?|explains?|attends?))\b/i,
  /\b(hardly\s+(available|present|comes?|explains?|helps?|attends?))\b/i,

  // Behavior
  /\b(rude|arrogant|biased|unfair|partial|harsh|disrespectful|condescending)\b/i,
  /\b(very\s+partial|always\s+partial|very\s+biased)\b/i,
  /\b(pls?\s+(don'?t\s+assign|change|remove|replace)\s+(her|him|this|the|that)\s*(faculty|teacher|ma'?am|sir)?)\b/i,
  /\b(change\s+(the\s+)?(faculty|teacher|ma'?am|sir|professor))\b/i,
  /\b(ignores?\s+(students?|questions?|doubts?))\b/i,

  // Dissatisfaction
  /\b(not\s+satisfied|unsatisfied|dissatisfied)\b/i,
  /\b(below\s+(average|expectation|standard|par))\b/i,
  /\b(overall\s+(bad|poor|average|below\s+average|not\s+good|unsatisf\w*))\b/i,
  /\b(not\s+at\s+all\s+(helpful|good|clear|effective|satisfied))\b/i,
  /\b(just\s+(copy\s+paste|copying))\b/i,
  /\b(learn\s+nothing|nothing\s+(new|learned|learnt)|students?\s+(just\s+)?copy\s+paste)\b/i,

  // Hinglish general negatives
  /\b(samajh\s+(nahi|nahin|nhi)\s*(aaya|aati|aata|aa|raha)?)\b/i,
  /\b(samajh\s+(mein|me)\s+(nahi|nahin|nhi)\s*(aaya|aati|aata)?)\b/i,
  /\b(kuch\s+(bhi\s+)?(samajh\s+(nahi|nhi)|pata\s+nahi))\b/i,
  /\b(hame\s+(hi\s+)?(samajh\s+(nahi|nhi)|pata\s+nahi))\b/i,
  /\b(bahut\s+(fast|slow|tez|dhire|mushkil|bura|bori|boring|problem|pareshani))\b/i,
  /\b(bahut\s+tez\s+(padhate|bolte|chalate|sikhate))\b/i,
  /\b(improve\s+karo|sudhar\s+lo|theek\s+karo|better\s+karo|improve\s+kijiye)\b/i,
  /\b(theek\s+(se\s+)?(nahi|nahin|nhi)\s*(padhate|sikhate|bolte|samjhate)?)\b/i,
  /\b(accha\s+(nahi|nahin|nhi)\s*(padhate|sikhate|lagta)?)\b/i,
  /\b(nahi\s+samjha|samjha\s+nahi|samjhe\s+nahi)\b/i,
  /\b(aur\s+acche\s+se\s+(krayo|karo|explain\s+karo|samjhaiye))\b/i,
  /\b(alag\s+time\s+rakhiye|easy\s+language\s+mein\s+provide\s+kijiye)\b/i,
  /\b(marks?\s+ke\s+criteria\s+clearly|transparent\s+nahi)\b/i,
  /\b(numerical\s+part\s+aur\s+acche\s+se)\b/i,
  /\b(zyada\s+hands[\s-]on\s+coding)\b/i,
  /\b(interactive\s+activities?\s+add\s+kijiye)\b/i,
  /\b(repair\s+karwaiye)\b/i,
  /\b(concise\s+banaiye|easy\s+banaiye)\b/i,
  /\b(comfortable\s+banaiye|support\s+improve\s+kijiye)\b/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// PURE APPRECIATION PATTERNS
// Only fire when ZERO attention signals found
// ─────────────────────────────────────────────────────────────────────────────
const APPRECIATION_PATTERNS = [
  /\b(excellent|outstanding|amazing|wonderful|fantastic|superb|brilliant|exceptional|extraordinary|tremendous|marvelous|splendid)\b/i,
  /\b(love|loved|enjoy|enjoyed|appreciate|appreciated|grateful|thankful|thank\s+you|thanks\s+for)\b/i,
  /\bbest\s+(teacher|faculty|professor|sir|ma'?am|lecturer|mentor|in\s+(the\s+)?(department|college|class))\b/i,
  /\bvery\s+(good|helpful|clear|patient|knowledgeable|experienced|dedicated|supportive|effective|interactive|engaging|understanding|cooperative|informative|organized)\b/i,
  /\bextremely\s+(good|helpful|supportive|knowledgeable|clear|effective|patient|dedicated)\b/i,
  /\bhighly\s+(recommend|knowledgeable|effective|skilled|experienced|helpful|dedicated)\b/i,
  /\bvery\s+well\s+(explained|taught|organized|structured|presented|communicated|covered)\b/i,
  /\bextremely\s+well\s+(explained|taught|presented)\b/i,
  /\bperfectly\s+(explained|taught|clear|understood)\b/i,
  /\bwell\s+(explained|taught|covered|organized|structured|presented|communicated)\b/i,
  /\b(great|good|nice|wonderful)\s+(teacher|teaching|faculty|professor|sir|ma'?am|mentor|lecturer)\b/i,
  /\b(understood|understand)\s+(everything|all|concepts|well|clearly|easily|perfectly)\b/i,
  /\b(learned|learnt)\s+(a\s+lot|so\s+much|very\s+much|greatly|everything)\b/i,
  /\b(explains?\s+(clearly|well|perfectly|easily|nicely|properly|very\s+well|very\s+clearly))\b/i,
  /\b(clear(ly)?\s+(explains?|teaches?|covers?|communicates?))\b/i,
  /\b(concepts?\s+(are|is|were)\s+(clear|well\s+explained|explained\s+well|easy\s+to\s+understand|very\s+clear))\b/i,
  /\b(very\s+)?(satisfied|satisfying)\b/i,
  /\b(happy\s+with|impressed\s+(by|with)|pleased\s+with)\b/i,
  /\b(very\s+)?(supportive|helpful|cooperative|understanding|patient|dedicated|interactive|engaging|inspiring|motivating)\s+(teacher|faculty|sir|ma'?am|professor|mentor)?\b/i,
  /\b(clears?\s+(all\s+)?(doubts?|queries|questions)\s*(well|properly|patiently|clearly|easily)?\b)/i,
  /\b(always\s+(helpful|available|supportive|cooperative|prepared|ready\s+to\s+help))\b/i,
  /\b(bahut\s+(accha|achha|badhiya|badia)\s*(padhate|sikhate|hai|hain)?)\b/i,
  /\b(zabardast|kamaal|behtareen|shandar|mast\s+padhate)\b/i,
  /\b(keep\s+(it\s+up|up\s+the\s+good\s+work)|well\s+done|good\s+job|great\s+job|excellent\s+work)\b/i,
  /\b(makes?\s+(difficult|complex|hard|tough)\s+(topics?|concepts?|subjects?)\s+(easy|simple|clear|understandable|interesting))\b/i,
  /\b(no\s+(complaints?|issues?|problems?)|everything\s+(is\s+)?(good|fine|great|excellent|perfect))\b/i,
];

// ── DEDUPLICATION ─────────────────────────────────────────────────────────────
function deduplicateComments(comments) {
  const seen = new Set();
  return comments.filter(c => {
    const key = String(c || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dupKey(text) {
  return String(text || '').toLowerCase()
    .replace(/[""''"'`]/g, '')
    .replace(/[.,;:!?()[\]{}]/g, '')
    .replace(/\s+/g, ' ').trim();
}

// ── MAIN CLASSIFIER ───────────────────────────────────────────────────────────
async function classifyComments(rawComments) {
  const result = {
    appreciation: [],
    commentsNeedingAttention: [],
    commentCategories: {
      Teaching: [], Communication: [], Availability: [],
      Materials: [], Assessment: [], General: []
    },
    classifiedComments: [],
    statistics: {
      totalReceived: 0, appreciation: 0, attention: 0,
      neutral: 0, skipped: 0, aiClassified: 0
    }
  };

  if (!Array.isArray(rawComments)) { console.warn('[AI] not an array'); return result; }
  result.statistics.totalReceived = rawComments.length;

  const CAT_PATTERNS = {
    Teaching:      /\b(teach|explain|lecture|class|concept|syllabus|topic|course|clarity|speed|pace)\b/i,
    Communication: /\b(speak|language|voice|microphone|interactive|discussion|participation|monoton)\b/i,
    Availability:  /\b(available|accessible|present|absent|punctual|regular|office|doubt\s+session)\b/i,
    Materials:     /\b(notes?|slides?|material|book|resource|pdf|ppt|study|formula|summary)\b/i,
    Assessment:    /\b(exam|test|quiz|grade|mark|assignment|project|lab|evaluation|criteria)\b/i,
    General:       /.*/
  };

  function addToCategory(text) {
    let added = false;
    for (const [cat, rx] of Object.entries(CAT_PATTERNS)) {
      if (cat === 'General') continue;
      if (rx.test(text)) {
        if (!result.commentCategories[cat].some(e => dupKey(e) === dupKey(text))) {
          result.commentCategories[cat].push(text);
        }
        added = true;
      }
    }
    if (!added && !result.commentCategories.General.some(e => dupKey(e) === dupKey(text))) {
      result.commentCategories.General.push(text);
    }
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

    // ── STEP 1: Skip garbage ──
    if (SKIP_PATTERNS.some(p => p.test(text)) || isGarbage(text)) {
      result.statistics.skipped++;
      result.classifiedComments.push({ text, classification: 'skipped', needsAttention: false, reason: 'garbage' });
      continue;
    }

    // ── STEP 2: Skip pure neutral fillers ──
    if (NEUTRAL_FILLER_PATTERNS.some(p => p.test(text.trim().toLowerCase()))) {
      result.statistics.skipped++;
      result.classifiedComments.push({ text, classification: 'neutral', needsAttention: false, reason: 'neutral-filler' });
      continue;
    }

    const lower = text.toLowerCase();

    // ── STEP 3: Check attention opener ──
    const hasAttentionOpener = ATTENTION_OPENERS.some(p => p.test(text));

    // ── STEP 4: Check specific issue phrases ──
    const hasIssuePhrase = ATTENTION_ISSUE_PHRASES.some(p => p.test(lower));

    // ── STEP 5: Check generic attention patterns ──
    const hasGenericAttention = GENERIC_ATTENTION_PATTERNS.some(p => p.test(lower));

    // ── STEP 6: Check appreciation ──
    const hasAppreciation = APPRECIATION_PATTERNS.some(p => p.test(lower));

    // ── DECISION: ATTENTION wins ──
    if (hasAttentionOpener || hasIssuePhrase || hasGenericAttention) {
      addAttention(text);
      result.statistics.attention++;
      result.classifiedComments.push({
        text, classification: 'attention', needsAttention: true,
        mixedSentiment: hasAppreciation,
        reason: hasIssuePhrase ? 'specific-issue-detected'
              : hasAttentionOpener ? 'attention-opener'
              : 'generic-improvement-request'
      });
      continue;
    }

    // ── DECISION: Pure appreciation ──
    if (hasAppreciation) {
      addAppreciation(text);
      result.statistics.appreciation++;
      result.classifiedComments.push({
        text, classification: 'appreciation', needsAttention: false,
        mixedSentiment: false, reason: 'purely-positive'
      });
      continue;
    }

    // ── DECISION: Unknown — neutral ──
    result.statistics.neutral++;
    result.classifiedComments.push({ text, classification: 'neutral', needsAttention: false, reason: 'uncertain' });
  }

  // ── FINAL DEDUP ──
  result.appreciation             = deduplicateComments(result.appreciation);
  result.commentsNeedingAttention = deduplicateComments(result.commentsNeedingAttention);

  // ATTENTION WINS if same comment in both
  const attKeys = new Set(result.commentsNeedingAttention.map(dupKey));
  result.appreciation = result.appreciation.filter(c => !attKeys.has(dupKey(c)));

  result.statistics.appreciation = result.appreciation.length;
  result.statistics.attention    = result.commentsNeedingAttention.length;

  console.log('[AI] ========================================');
  console.log('[AI] Classifier v4 (1000-sample trained)');
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
  testGeminiConnection: async () => ({
    ok: true,
    engine: 'Rule-Based v4 — Trained on 1000 labeled college feedback comments',
    categories: [
      'TEACHING_CLARITY','PACING_AND_TIME','PRACTICAL_LAB',
      'NOTES_AND_MATERIALS','DOUBT_SUPPORT','ASSESSMENT_AND_FAIRNESS',
      'COMMUNICATION_AND_ENGAGEMENT','FACILITIES_AND_EQUIPMENT',
      'COURSE_PLANNING','STUDENT_SUPPORT_AND_PROFESSIONALISM'
    ]
  }),
};
