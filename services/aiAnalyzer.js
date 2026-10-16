// ============================================================
// COLLEGE FEEDBACK INTELLIGENCE — v3
// Built from real student comment analysis
// ============================================================
//
// CLASSIFICATION LOGIC:
//
//  1. SKIP   — garbage, random chars, too short, pure filler
//  2. ATTENTION — anything requesting change, improvement,
//                 expressing dissatisfaction, mixed praise+issue
//  3. APPRECIATION — purely positive, no suggestion/issue at all
//  4. NEUTRAL — uncertain, short neutral, left unclassified
//
// PRIORITY: ATTENTION > APPRECIATION > NEUTRAL
//
// KEY INSIGHT from real data:
//   Students write long polite suggestions like:
//   "It would be helpful if..." / "Could you please..."
//   "More examples should be included..."
//   "I think this should be taught slowly..."
//   These MUST go to ATTENTION — they are improvement requests
//   even when phrased politely.
// ============================================================

// ── SKIP PATTERNS — garbage / meaningless input ──────────────────────────────
const SKIP_PATTERNS = [
  /^[^a-zA-Z\u0900-\u097F]{0,10}$/,          // no real letters at all
  /^(.)\1{3,}$/,                               // repeated single char: "aaaa"
  /^[a-zA-Z]{1,3}$/,                          // 1-3 random letters: "jb", "ok"
  /^(no|none|na|nahi|nil|n\.?a\.?|nothing|no\s+comment|no\s+remark|no\s+suggestion)s?\.?$/i,
  /^(\.{2,}|-{2,}|_{2,}|\*{2,}|#{2,})$/,     // dots/dashes only
  /^[^a-zA-Z\u0900-\u097F\s]{1,20}$/,         // symbols/numbers only
];

// ── PURE NEUTRAL SKIP — very short generic fillers ───────────────────────────
const NEUTRAL_FILLER_PATTERNS = [
  /^(ok|okay|fine|average|normal|moderate|alright|decent|good|nice|great|well)\.?$/i,
  /^(everything\s+(is\s+)?(fine|good|ok|okay|great|nice|well|perfect))\.?$/i,
  /^(no\s+(need|problem|issue|complaint|remark|change))s?\.?$/i,
  /^(all\s+(good|fine|ok|okay|great|nice|is\s+well))\.?$/i,
  /^(satisfactory|satisfied|content|happy)\.?$/i,
];

// ── STRONG ATTENTION SIGNALS ─────────────────────────────────────────────────
// These ALWAYS classify as ATTENTION regardless of positive context around them

const ATTENTION_PATTERNS = [

  // ── 1. POLITE REQUESTS & SUGGESTIONS (most common in real data) ──
  /\b(could\s+you\s+(please\s+)?(explain|teach|provide|give|cover|focus|try|start|improve|speak|slow|be))\b/i,
  /\b(please\s+(explain|provide|give|cover|focus|teach|speak|slow\s+down|improve|try|be\s+more|increase|add|include|change|assign|upload|check))\b/i,
  /\b(it\s+would\s+(be\s+)?(helpful|great|better|nice|good)\s+(if|to|for))\b/i,
  /\b(would\s+be\s+(helpful|better|great|nice|good|more\s+effective)\s+(if|to|for))\b/i,
  /\b(if\s+(possible|maam?|sir|you\s+can|you\s+could),?\s+please)\b/i,
  /\b(i\s+(think|feel|believe|suggest|request|hope)\s+(this|it|the|that|we|sir|maam?))/i,
  /\b(in\s+my\s+opinion|according\s+to\s+me)\b/i,
  /\b(explained\s+in\s+a\s+more\s+(unique|engaging|interactive|interesting|creative|different|better)\s+way)\b/i,
  /\b(topics?\s+(were?|are|could\s+be|should\s+be)\s+(explained|taught|covered)\s+(in\s+a\s+more|more|better|differently))\b/i,
  /\b(make\s+(the\s+)?(classes?|lectures?|topics?|concepts?|subject)\s+more\s+(interesting|engaging|interactive|effective))\b/i,

  // ── 2. IMPROVEMENT REQUESTS ──
  /\b(need[s]?\s+(to\s+)?(improve|be\s+improved|more|better|to\s+cover|to\s+explain|to\s+focus))\b/i,
  /\b(should\s+(improve|be\s+improved|focus|give|provide|explain|cover|try|use|include|change|start|teach|conduct|assign|add))\b/i,
  /\b(must\s+(improve|explain|cover|provide|give|attend|focus|include|add))\b/i,
  /\b(can\s+be\s+(improved|better|more\s+(clear|effective|interactive|engaging|organized)))\b/i,
  /\b(scope\s+for\s+improvement|room\s+for\s+improvement|could\s+be\s+(better|improved|more))\b/i,
  /\b(needs?\s+improvement|needs?\s+to\s+be\s+(improved|better|more|changed))\b/i,
  /\b(improve\s+(the|their|his|her|teaching|explanation|notes|material|lab|class|interaction|method|speed|style))\b/i,
  /\b(improve\s+karo|sudhar|better\s+karo)\b/i,

  // ── 3. "MORE" REQUESTS — students asking for more of something ──
  /\b(more\s+(examples?|practice|exercises?|problems?|interaction|real[\s-]world|practical|hands[\s-]on|time|attention|explanation|clarity|details?|topics?|coverage|activities|discussion|problem[\s-]solving|coding|case[\s-]studies?))\b/i,
  /\b(should\s+(include|add|give|provide|use)\s+(more|enough|additional|some)\s+(examples?|practice|interaction|time|details?|exercises?))\b/i,
  /\b(give\s+(more|enough|additional|some)\s+(time|examples?|attention|practice|explanation|problems?|exercises?))\b/i,
  /\b(add\s+(more|some|additional)\s+(examples?|practice|problems?|diagrams?|visuals?|real[\s-]world))\b/i,

  // ── 4. CONCISE/EASY REQUEST — notes, material issues ──
  /\b(keep\s+(the\s+)?(notes?|material|content|ppt|explanation)\s+(concise|short|simple|easy|clear|brief))\b/i,
  /\b(notes?\s+(are|is|contain|has|have)\s+(too\s+(long|much|difficult)|a\s+lot|very\s+(hard|difficult|long)))\b/i,
  /\b(material\s+(is|are)\s+(not\s+)?(good|clear|enough|provided|available|helpful))\b/i,
  /\b(no\s+(notes?|material|resources?|slides?|study\s+material|pdf))\b/i,
  /\b(doesn'?t\s+(provide|share|give|upload)\s+(notes?|material|slides?|resources?|pdf))\b/i,
  /\b(notes?\s+(not\s+)?(provided|available|uploaded|shared|given|complete))\b/i,
  /\b(include\s+(diagrams?|flowcharts?|visuals?|examples?|relevant|practical)\s+(in\s+)?(the\s+)?(ppt|notes?|slides?|material))\b/i,

  // ── 5. PACE / SPEED ISSUES ──
  /\b(too\s+(fast|slow|quick|rushed|rapid|brief|detailed))\b/i,
  /\b(speaks?\s+(too\s+)?(very\s+)?(fast|slow|quickly|slowly|rapidly))\b/i,
  /\b(teaches?\s+(too\s+)?(fast|slow|quickly|slowly|rapidly|at\s+a\s+(quick|fast|slow)\s+pace))\b/i,
  /\b(pace\s+is\s+(too\s+)?(fast|slow|high|low|very\s+(fast|slow)))\b/i,
  /\b(quick\s+pace|fast\s+pace|slow\s+pace)\b/i,
  /\b(things?\s+(goes?|go)\s+out\s+of\s+head)\b/i,
  /\b(taught\s+(slowly|clearly|properly|step\s+by\s+step))\b/i, // "must be taught slowly" = issue

  // ── 6. CLARITY / UNDERSTANDING ISSUES ──
  /\b(not\s+(clear|easy\s+to\s+understand|understandable|helpful|satisfactory|effective|interactive|engaging|organized|available))\b/i,
  /\b(difficult\s+to\s+(understand|follow|grasp|comprehend|remember|read))\b/i,
  /\b(hard\s+to\s+(understand|follow|grasp|comprehend|read))\b/i,
  /\b(can'?t\s+(understand|follow|hear|grasp|comprehend|read|see))\b/i,
  /\b(unable\s+to\s+(understand|follow|grasp|comprehend))\b/i,
  /\b(didn'?t\s+(understand|cover|explain|teach|complete|finish|give|provide))\b/i,
  /\b(doesn'?t\s+(explain|teach|help|provide|give|come|attend|answer|listen|respond|make\s+it\s+clear))\b/i,
  /\b(concepts?\s+(are|is)\s+(not\s+)?(clear|easy|understandable|well\s+explained))\b/i,
  /\b(explain\s+(from\s+)?(the\s+)?(basics?|scratch|beginning|fundamentals?)\b)/i,
  /\b(explained\s+(in\s+a\s+)?(more\s+)?(unique|engaging|better|interactive|different|creative)\s+way)\b/i,
  /\b(easier\s+to\s+(understand|follow|grasp|remember|study))\b/i,
  /\b(make\s+(the\s+)?(concepts?|topics?|subject|class|lecture)\s+(easier|clearer|more\s+(interesting|engaging|interactive|effective)))\b/i,

  // ── 7. BAD QUALITY DESCRIPTORS ──
  /\b(poor|bad|worst|terrible|horrible|useless|waste|boring|dull|monotonous|pathetic|average|below\s+average)\s+(teaching|explanation|class|lecture|method|faculty|teacher|performance|style|approach|lab|session|notes?|material)\b/i,
  /\b(very\s+(poor|bad|boring|dull|slow|fast|unclear|rough|rude|strict|harsh|average))\b/i,
  /\b(not\s+(good|satisf|effective|helpful|engaging|interactive|organized|punctual|available)\w*)\b/i,
  /\b(overall\s+(bad|poor|average|below\s+average|not\s+good|unsatisf\w*))\b/i,
  /\b(just\s+(copy\s+paste|copying|mugging)\b)/i,
  /\b(learn\s+nothing|nothing\s+(new|learned|learnt))\b/i,
  /\b(students?\s+(just\s+)?(copy|paste|copy[\s-]paste))\b/i,

  // ── 8. AVAILABILITY / PUNCTUALITY ISSUES ──
  /\b(absent|irregular|not\s+punctual|always\s+late|often\s+absent|frequently\s+absent)\b/i,
  /\b(never\s+(available|present|comes?|helps?|explains?|answers?|attends?))\b/i,
  /\b(rarely\s+(available|present|comes?|helps?|explains?|attends?))\b/i,
  /\b(hardly\s+(available|present|comes?|explains?|helps?|attends?))\b/i,

  // ── 9. BEHAVIORAL / FAIRNESS ISSUES ──
  /\b(rude|arrogant|biased|unfair|partial|harsh|disrespectful|condescending|strict\s+with)\b/i,
  /\b(very\s+partial|very\s+biased|always\s+partial)\b/i,
  /\b(pls?\s+(don'?t\s+assign|change|remove|replace)\s+(her|him|this|the)\s+(faculty|teacher|ma'?am|sir))\b/i,
  /\b(change\s+(the\s+)?(faculty|teacher|ma'?am|sir))\b/i,
  /\b(ignores?\s+(students?|questions?|doubts?))\b/i,

  // ── 10. SYLLABUS / COVERAGE ISSUES ──
  /\b(syllabus\s+(not\s+)?(complete[d]?|covered|finished|done|pending|incomplete))\b/i,
  /\b(topics?\s+(not\s+)?(covered|taught|explained|completed|finished|skipped|left\s+out))\b/i,
  /\b(didn'?t\s+(complete|finish|cover)\s+(the\s+)?(syllabus|course|topics?|curriculum))\b/i,
  /\b(complete\s+(the\s+)?(syllabus|course|topics?|curriculum))\b/i,

  // ── 11. LAB / PRACTICAL ISSUES ──
  /\b(lab\s+(is|are|sessions?\s+(are|is))\s+(not\s+)?(interactive|engaging|helpful|effective|organized|well[\s-]explained|average|boring))\b/i,
  /\b(no\s+(discussion|explanation|guidance|help)\s+(on|during|in|for)\s+(lab|practical|problem|solution|experiment))\b/i,
  /\b(lab\s+(not\s+)?(interactive|engaging|helpful|well[\s-]conducted|properly\s+explained))\b/i,
  /\b(more\s+(hands[\s-]on|lab|practical)\s+(practice|time|sessions?|work|exercises?))\b/i,
  /\b(network\s+issue|upload\s+issue|technical\s+issue)\s+(in\s+)?(lab|class|assignment)?\b/i,

  // ── 12. HINGLISH NEGATIVE ──
  /\b(samajh\s+(nahi|nahin|nhi)\s*(aaya|aati|aata|aa|raha)?)\b/i,
  /\b(samajh\s+(mein|me)\s+(nahi|nahin|nhi)\s*(aaya|aati|aata)?)\b/i,
  /\b(kuch\s+(bhi\s+)?(samajh\s+(nahi|nhi)|pata\s+nahi))\b/i,
  /\b(bahut\s+(fast|slow|tez|dhire|mushkil|bura|bori|boring|problem|pareshani))\b/i,
  /\b(bahut\s+tez\s+(padhate|bolte|chalate|sikhate))\b/i,
  /\b(improve\s+karo|sudhar\s+lo|theek\s+karo|better\s+karo)\b/i,
  /\b(theek\s+(se\s+)?(nahi|nahin|nhi)\s*(padhate|sikhate|bolte|samjhate)?)\b/i,
  /\b(accha\s+(nahi|nahin|nhi)\s*(padhate|sikhate|lagta)?)\b/i,
  /\b(zyada\s+(accha|helpful|clear)\s+nahi)\b/i,
  /\b(numerical\s+(part\s+)?(aur|or)\s+(acche\s+se|properly|clearly)\s+(krayo|karo|explain))\b/i,
  /\b(hame\s+(hi\s+)?(samajh\s+(nahi|nhi)|pata\s+nahi))\b/i,
  /\b(padhana\s+(theek\s+nahi|accha\s+nahi|bahut\s+fast|bahut\s+slow))\b/i,

  // ── 13. EXPLICIT DISSATISFACTION ──
  /\b(not\s+satisfied|unsatisfied|dissatisfied)\b/i,
  /\b(below\s+(average|expectation|standard|par))\b/i,
  /\b(not\s+at\s+all\s+(helpful|good|clear|effective|satisfied))\b/i,
];

// ── PURE APPRECIATION PATTERNS ────────────────────────────────────────────────
// Only fire if NO attention signal found

const APPRECIATION_PATTERNS = [
  // Superlatives
  /\b(excellent|outstanding|amazing|wonderful|fantastic|superb|brilliant|exceptional|extraordinary|tremendous|marvelous|splendid)\b/i,

  // Love / enjoy / appreciate
  /\b(love|loved|enjoy|enjoyed|appreciate|appreciated|grateful|thankful|thank\s+you|thanks\s+for)\b/i,

  // Best teacher
  /\bbest\s+(teacher|faculty|professor|sir|ma'?am|lecturer|mentor|in\s+(the\s+)?(department|college|class))\b/i,

  // Very / extremely / highly positive
  /\bvery\s+(good|helpful|clear|patient|knowledgeable|experienced|dedicated|supportive|effective|interactive|engaging|understanding|cooperative|informative|organized)\b/i,
  /\bextremely\s+(good|helpful|supportive|knowledgeable|clear|effective|patient|dedicated)\b/i,
  /\bhighly\s+(recommend|knowledgeable|effective|skilled|experienced|helpful|dedicated)\b/i,

  // Well explained (strong qualifier)
  /\bvery\s+well\s+(explained|taught|organized|structured|presented|communicated|covered)\b/i,
  /\bextremely\s+well\s+(explained|taught|presented)\b/i,
  /\bperfectly\s+(explained|taught|clear|understood)\b/i,
  /\bwell\s+(explained|taught|covered|organized|structured|presented|communicated)\b/i,

  // Great/good teacher (direct compliment)
  /\b(great|good|nice|wonderful)\s+(teacher|teaching|faculty|professor|sir|ma'?am|mentor|lecturer)\b/i,

  // Positive outcomes
  /\b(understood|understand)\s+(everything|all|concepts|well|clearly|easily|perfectly)\b/i,
  /\b(learned|learnt)\s+(a\s+lot|so\s+much|very\s+much|greatly|everything)\b/i,

  // Clear explanation
  /\b(explains?\s+(clearly|well|perfectly|easily|nicely|properly|very\s+well|very\s+clearly))\b/i,
  /\b(clear(ly)?\s+(explains?|teaches?|covers?|communicates?))\b/i,
  /\b(concepts?\s+(are|is|were)\s+(clear|well\s+explained|explained\s+well|easy\s+to\s+understand|very\s+clear))\b/i,

  // Satisfaction
  /\b(very\s+)?(satisfied|satisfying|satisfactory)\b/i,
  /\b(happy\s+with|impressed\s+(by|with)|pleased\s+with)\b/i,

  // Supportive / helpful (strong)
  /\b(very\s+)?(supportive|helpful|cooperative|understanding|patient|dedicated|interactive|engaging|inspiring|motivating)\s+(teacher|faculty|sir|ma'?am|professor|mentor)?\b/i,
  /\b(clears?\s+(all\s+)?(doubts?|queries|questions)\s*(well|properly|patiently|clearly|easily)?\b)/i,
  /\b(always\s+(helpful|available|supportive|cooperative|prepared|ready\s+to\s+help))\b/i,

  // Hinglish strong positive
  /\b(bahut\s+(accha|achha|badhiya|badia)\s*(padhate|sikhate|hai|hain)?)\b/i,
  /\b(zabardast|kamaal|behtareen|shandar|mast\s+padhate)\b/i,
  /\b(bahut\s+badhiya\s+(teacher|faculty|sir|ma'?am)?)\b/i,

  // Keep it up / well done
  /\b(keep\s+(it\s+up|up\s+the\s+good\s+work)|well\s+done|good\s+job|great\s+job|excellent\s+work)\b/i,
];

// ── OVERRIDE: MIXED COMMENT SIGNALS ──────────────────────────────────────────
// These phrases definitively signal a mixed comment (positive + issue)
// → ALWAYS goes to ATTENTION even if positive patterns found

const MIXED_SIGNAL_PATTERNS = [
  /\b(good\s+but|nice\s+but|great\s+but|best\s+but|excellent\s+but)\b/i,
  /\b(however,?\s+(some|the|more|it|this|there))\b/i,
  /\b(but\s+(some|the|more|it|this|there|please|sir|maam?|could|should|needs?|the\s+notes?))\b/i,
  /\b(although|even\s+though|despite\s+(this|that|being))\b/i,
  /\b(overall\s+(good|great|nice|fine)\s*(,|but|however|though|although|except))\b/i,
  /\b(scope\s+for|room\s+for)\s+improvement\b/i,
  /\b(some\s+(topics?|concepts?|experiments?|parts?)\s+could\s+be)\b/i,
  /\b(could\s+(use|do\s+with)\s+(more|some|better|a\s+bit))\b/i,
];

// ── GARBAGE DETECTION — random character strings ─────────────────────────────
function isGarbage(text) {
  const words = text.trim().split(/\s+/);
  // If all words are < 2 chars or look like keyboard mashing
  const realWords = words.filter(w => w.length >= 3 && /[aeiou]/i.test(w));
  if (words.length <= 3 && realWords.length === 0) return true;
  // High ratio of consonants with no vowels = keyboard mash
  const noVowelWords = words.filter(w => w.length > 3 && !/[aeiou]/i.test(w));
  if (noVowelWords.length >= words.length * 0.7) return true;
  return false;
}

function deduplicateComments(comments) {
  const seen = new Set();
  return comments.filter(c => {
    const key = String(c || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function duplicateKey(text) {
  return String(text || '').toLowerCase()
    .replace(/[""''"'`]/g, '')
    .replace(/[.,;:!?()[\]{}]/g, '')
    .replace(/\s+/g, ' ').trim();
}

async function getSentimentPipeline() {
  return null; // HuggingFace disabled on Render free tier
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

  if (!Array.isArray(rawComments)) {
    console.warn('[AI] rawComments is not an array');
    return result;
  }

  result.statistics.totalReceived = rawComments.length;

  const CATEGORY_PATTERNS = {
    Teaching:      /\b(teach|explain|lecture|class|concept|syllabus|topic|course)\b/i,
    Communication: /\b(communicate|speak|language|speed|pace|fast|slow|clear|voice)\b/i,
    Availability:  /\b(available|accessible|present|absent|punctual|regular|office)\b/i,
    Materials:     /\b(notes?|slides?|material|book|resource|pdf|ppt|study)\b/i,
    Assessment:    /\b(exam|test|quiz|grade|mark|assignment|project|lab)\b/i,
    General:       /.*/
  };

  function addToCategory(text) {
    let added = false;
    for (const [cat, rx] of Object.entries(CATEGORY_PATTERNS)) {
      if (cat === 'General') continue;
      if (rx.test(text)) {
        if (!result.commentCategories[cat].some(e => duplicateKey(e) === duplicateKey(text))) {
          result.commentCategories[cat].push(text);
        }
        added = true;
      }
    }
    if (!added) {
      if (!result.commentCategories.General.some(e => duplicateKey(e) === duplicateKey(text))) {
        result.commentCategories.General.push(text);
      }
    }
  }

  function addAttention(text) {
    if (!result.commentsNeedingAttention.some(e => duplicateKey(e) === duplicateKey(text))) {
      result.commentsNeedingAttention.push(text);
    }
    addToCategory(text);
  }

  function addAppreciation(text) {
    if (!result.appreciation.some(e => duplicateKey(e) === duplicateKey(text))) {
      result.appreciation.push(text);
    }
  }

  for (const originalComment of rawComments) {
    if (!originalComment || typeof originalComment !== 'string') {
      result.statistics.skipped++;
      continue;
    }

    const text = String(originalComment).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) { result.statistics.skipped++; continue; }

    // ── STEP 1: Skip garbage / meaningless ──
    if (SKIP_PATTERNS.some(p => p.test(text)) || isGarbage(text)) {
      result.statistics.skipped++;
      result.classifiedComments.push({ text, classification: 'skipped', needsAttention: false, reason: 'garbage-or-empty' });
      continue;
    }

    // ── STEP 2: Skip pure neutral fillers ──
    if (NEUTRAL_FILLER_PATTERNS.some(p => p.test(text.toLowerCase()))) {
      result.statistics.skipped++;
      result.classifiedComments.push({ text, classification: 'neutral', needsAttention: false, reason: 'neutral-filler' });
      continue;
    }

    const lower = text.toLowerCase();

    // ── STEP 3: Check for MIXED SIGNALS first (positive+issue) ──
    const hasMixedSignal = MIXED_SIGNAL_PATTERNS.some(p => p.test(lower));

    // ── STEP 4: Check for ATTENTION patterns ──
    const hasAttention = ATTENTION_PATTERNS.some(p => p.test(lower));

    // ── STEP 5: Check for APPRECIATION patterns ──
    const hasAppreciation = APPRECIATION_PATTERNS.some(p => p.test(lower));

    // ── CLASSIFICATION DECISION TREE ──

    // ATTENTION wins always
    if (hasAttention || hasMixedSignal) {
      addAttention(text);
      result.statistics.attention++;
      result.classifiedComments.push({
        text, classification: 'attention', needsAttention: true,
        mixedSentiment: hasAppreciation,
        reason: hasMixedSignal ? 'mixed-positive-and-issue'
              : hasAppreciation ? 'improvement-request-with-praise'
              : 'needs-improvement'
      });
      continue;
    }

    // Pure appreciation
    if (hasAppreciation) {
      addAppreciation(text);
      result.statistics.appreciation++;
      result.classifiedComments.push({
        text, classification: 'appreciation', needsAttention: false,
        mixedSentiment: false, reason: 'purely-positive'
      });
      continue;
    }

    // Unknown but long — keep for review
    result.statistics.neutral++;
    result.classifiedComments.push({
      text, classification: 'neutral', needsAttention: false, reason: 'uncertain'
    });
  }

  // ── FINAL DEDUPLICATION ──
  result.appreciation             = deduplicateComments(result.appreciation);
  result.commentsNeedingAttention = deduplicateComments(result.commentsNeedingAttention);

  // ATTENTION WINS if same comment ends up in both
  const attentionKeys = new Set(result.commentsNeedingAttention.map(duplicateKey));
  result.appreciation = result.appreciation.filter(c => !attentionKeys.has(duplicateKey(c)));

  result.statistics.appreciation = result.appreciation.length;
  result.statistics.attention    = result.commentsNeedingAttention.length;

  console.log('[AI] ========================================');
  console.log('[AI] Comment analysis v3 completed');
  console.log(`[AI] Received  : ${rawComments.length}`);
  console.log(`[AI] Attention : ${result.commentsNeedingAttention.length}`);
  console.log(`[AI] Appreciate: ${result.appreciation.length}`);
  console.log(`[AI] Neutral   : ${result.statistics.neutral}`);
  console.log(`[AI] Skipped   : ${result.statistics.skipped}`);
  console.log('[AI] ========================================');

  return result;
}

module.exports = {
  classifyComments,
  analyzeCommentsWithAI: classifyComments,
  testGeminiConnection: async () => ({ ok: true, engine: 'Rule-Based v3 (College-Specific)' }),
};
