// ============================================================
// FINAL COMMENT ANALYZER — v2 (Precise Patterns)
// ============================================================
// KEY RULES:
// - NEGATIVE has priority over POSITIVE (mixed = attention)
// - Patterns must be SPECIFIC — no loose single words
// - "but/however" alone is NOT enough — needs actual criticism
// - "improve" alone is NOT enough — needs context
// - Hinglish patterns preserved
// ============================================================

let pipeline = null;
let pipelineLoading = false;

// ── POSITIVE PATTERNS (only genuinely positive signals) ──────────────────────
const POSITIVE_PATTERNS = [
  // Superlatives and strong praise
  /\b(excellent|outstanding|amazing|wonderful|fantastic|superb|brilliant|perfect|exceptional|extraordinary|tremendous|marvelous|splendid)\b/i,

  // Appreciation verbs
  /\b(love|loved|enjoy|enjoyed|appreciate|appreciated|grateful|thankful|thank\s+you|thanks\s+for)\b/i,

  // Very/extremely + positive quality
  /\bvery\s+(good|helpful|clear|patient|knowledgeable|experienced|dedicated|supportive|effective|interactive|engaging|understanding|cooperative)\b/i,
  /\bextremely\s+(good|helpful|supportive|knowledgeable|clear|effective)\b/i,
  /\bhighly\s+(recommend|knowledgeable|effective|skilled|experienced)\b/i,

  // Best teacher / best faculty
  /\bbest\s+(teacher|faculty|professor|sir|ma'?am|lecturer|mentor)\b/i,

  // Well explained / well taught (strong form)
  /\bvery\s+well\s+(explained|taught|organized|structured|presented|communicated)\b/i,
  /\bextremely\s+well\s+(explained|taught|presented)\b/i,
  /\bperfectly\s+(explained|taught|clear)\b/i,

  // Great/good teaching qualities (strong adjective required)
  /\b(great|good|nice)\s+(teacher|teaching|explanation|faculty|professor|sir|ma'?am|mentor)\b/i,
  /\b(clear|effective|interactive|engaging|inspiring|motivating)\s+(teaching|explanation|style|method|approach|lecture)\b/i,

  // Specific positive outcomes
  /\b(understood|understand)\s+(everything|all|concepts|well|clearly|easily|perfectly)\b/i,
  /\b(learned|learnt)\s+(a\s+lot|so\s+much|very\s+much|greatly)\b/i,
  /\b(satisfied|happy|impressed|pleased)\s+(with|by)?\s*(the|this|his|her|their)?\s*(teaching|explanation|faculty|class|lecture)?\b/i,

  // Hinglish strong positive
  /\b(bahut\s+(accha|achha|badhiya|badia)|zabardast|kamaal|behtareen|mast\s+padhate|shandar)\b/i,

  // Simple strong positive phrases
  /\b(no\s+(complaints?|issues?|problems?)|everything\s+(is\s+)?(good|fine|great|excellent|perfect))\b/i,
  /\b(keep\s+(it\s+up|up\s+the\s+good\s+work)|well\s+done|good\s+job|great\s+job)\b/i,
];

// ── NEGATIVE PATTERNS (specific, not single loose words) ─────────────────────
const NEGATIVE_PATTERNS = [
  // Direct improvement requests
  /\b(should\s+improve|need[s]?\s+to\s+improve|must\s+improve|needs?\s+improvement|please\s+improve)\b/i,
  /\b(should\s+(focus|give|provide|increase|explain|teach|cover|be|come|start|stop))\b/i,
  /\b(must\s+(explain|cover|provide|give|attend|be|come))\b/i,
  /\b(need[s]?\s+(more|to\s+give|to\s+explain|to\s+cover|to\s+provide|to\s+focus|to\s+be))\b/i,
  /\b(please\s+(explain|provide|give|cover|focus|teach|speak|slow|improve|increase))\b/i,

  // Bad quality descriptors
  /\b(poor|bad|worst|terrible|horrible|useless|waste|boring|dull|monotonous|pathetic)\s+(teaching|explanation|class|lecture|method|faculty|teacher|performance|style|approach)\b/i,
  /\b(very\s+(poor|bad|boring|dull|slow|fast|unclear|rough|rude|strict|harsh))\b/i,
  /\b(not\s+(good|clear|helpful|available|punctual|organized|effective|satisfactory|understandable|interactive|engaging))\b/i,

  // Speed problems (specific)
  /\b(too\s+(fast|slow|quick|rushed|rapid))\s*(in\s+(teaching|explaining|speaking|class))?\b/i,
  /\b(speaks?\s+too\s+(fast|slow|quickly|slowly))\b/i,
  /\b(teaching\s+(speed|pace)\s+is\s+(too\s+)?(fast|slow|high|low))\b/i,
  /\b(very\s+(fast|slow)\s+(teaching|explanation|speaking|pace|speed))\b/i,

  // Clarity problems
  /\b(not\s+clear|unclear|confusing|confused|hard\s+to\s+understand|difficult\s+to\s+understand|difficult\s+to\s+follow)\b/i,
  /\b(doesn'?t\s+(explain|teach|make\s+it\s+clear|help\s+understand))\b/i,
  /\b(didn'?t\s+(explain|understand|cover|teach|give|provide))\b/i,
  /\b(can'?t\s+(understand|follow|hear|grasp|comprehend))\b/i,
  /\b(unable\s+to\s+(understand|follow|comprehend|grasp))\b/i,

  // More examples / practice requests (specific phrasing)
  /\b(more\s+(practical|examples?|practice|exercises?|problems?|attention|interaction|activities|case\s+studies))\b/i,
  /\b(give\s+(more|enough)\s+(examples?|time|attention|explanation|practice|problems?))\b/i,
  /\b(need\s+(more\s+)?(examples?|practice|exercises?|interaction|attention|explanations?))\b/i,
  /\b(less\s+(theory|theory\s+and|lecture))\b/i,
  /\b(not\s+enough\s+(examples?|practice|time|explanation|interaction))\b/i,

  // Availability/punctuality issues
  /\b(absent|irregular|late|not\s+punctual|never\s+on\s+time|always\s+late|often\s+absent)\b/i,
  /\b(never\s+(available|present|comes?|helps?|explains?|answers?))\b/i,
  /\b(rarely\s+(available|present|comes?|helps?|explains?))\b/i,
  /\b(hardly\s+(available|present|comes?|explains?|helps?))\b/i,
  /\b(not\s+(available|present|accessible)\s+(for\s+)?(doubts?|questions?|help|students?))\b/i,

  // Behavioral issues
  /\b(rude|arrogant|biased|unfair|partial|harsh|disrespectful|condescending)\b/i,
  /\b(doesn'?t\s+(help|answer|respond|listen|attend|come|give\s+attention))\b/i,
  /\b(ignores?\s+(students?|questions?|doubts?))\b/i,

  // Syllabus/coverage issues
  /\b(didn'?t\s+(complete|finish|cover)\s+(the\s+)?(syllabus|course|topics?|curriculum))\b/i,
  /\b(syllabus\s+(not\s+completed?|incomplete|not\s+covered|pending))\b/i,
  /\b(topics?\s+(not\s+covered|skipped|incomplete|left\s+out|not\s+taught))\b/i,

  // Notes/materials issues
  /\b(no\s+(notes?|material|resources?|slides?|study\s+material))\b/i,
  /\b(doesn'?t\s+(provide|share|give)\s+(notes?|material|slides?|resources?))\b/i,
  /\b(need[s]?\s+(notes?|study\s+material|slides?|resources?))\b/i,

  // Hinglish negative (specific phrases)
  /\b(samajh\s+(nahi|nahin)\s+(aaya|aati|aata)|samajh\s+nahi\s+aaya)\b/i,
  /\b(bahut\s+(fast|slow|mushkil|bura|bori|boring)|bahut\s+tez\s+padhate)\b/i,
  /\b(improve\s+karo|theek\s+nahi|accha\s+nahi|bilkul\s+nahi\s+samjha)\b/i,
  /\b(padhana\s+(theek\s+nahi|accha\s+nahi|bahut\s+fast|bahut\s+slow))\b/i,

  // Explicit dissatisfaction
  /\b(not\s+satisfied|unsatisfied|dissatisfied|unhappy\s+with)\b/i,
  /\b(could\s+be\s+better|room\s+for\s+improvement|much\s+to\s+improve)\b/i,
  /\b(below\s+(average|expectation|standard)|below\s+par)\b/i,
];

const SKIP_PATTERNS = [
  /^(no|none|na|nahi|nil|n\.?a\.?|\.{3,}|-{3,}|_{3,})$/i,
  /^.{1,3}$/
];

const NEUTRAL_SKIP_PATTERNS = [
  /^(ok|okay|fine|average|normal|moderate|alright|decent|good)$/i,
];

const CATEGORY_PATTERNS = {
  Teaching: /\b(teach|explain|lecture|class|concept|syllabus|cover|topic)\b/i,
  Communication: /\b(communicate|talk|speak|language|speed|pace|fast|slow|clear)\b/i,
  Availability: /\b(available|accessible|office|hours|present|absent|punctual|regular)\b/i,
  Materials: /\b(notes?|slides?|material|book|resource|pdf|study\s+material)\b/i,
  Assessment: /\b(exam|test|quiz|grade|mark|assignment|project)\b/i,
  General: /.*/
};

function deduplicateComments(comments) {
  const seen = new Set();
  const unique = [];
  for (const comment of comments) {
    const key = String(comment || '').toLowerCase().trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      unique.push(comment);
    }
  }
  return unique;
}

async function getSentimentPipeline() {
  // DISABLED: HuggingFace models crash on Render free tier
  // Always use rule-based classification instead
  console.log('[AI] Using rule-based classification (HuggingFace disabled to prevent crashes)');
  return null;
}

// Patterns and classification logic
async function classifyComments(rawComments) {
  const result = {
    appreciation: [],
    commentsNeedingAttention: [],
    commentCategories: {
      Teaching: [],
      Communication: [],
      Availability: [],
      Materials: [],
      Assessment: [],
      General: []
    },
    classifiedComments: [],
    statistics: {
      totalReceived: 0,
      appreciation: 0,
      attention: 0,
      neutral: 0,
      skipped: 0,
      aiClassified: 0
    }
  };


  // ==========================================================
  // VALIDATE INPUT
  // ==========================================================

  if (
    !Array.isArray(rawComments)
  ) {

    console.warn(
      '[AI] rawComments is not an array'
    );

    return result;

  }


  result.statistics.totalReceived =
    rawComments.length;


  // ==========================================================
  // NORMALIZE TEXT
  // ==========================================================

  function normalizeComment(text) {

    return String(text || '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  }


  // ==========================================================
  // DUPLICATE KEY
  // ==========================================================

  function duplicateKey(text) {

    return normalizeComment(text)
      .toLowerCase()
      .replace(/[“”‘’"'`]/g, '')
      .replace(/[.,;:!?()[\]{}]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  }


  // ==========================================================
  // CATEGORY
  // ==========================================================

  function addToCategory(
    text
  ) {

    let foundCategory = false;


    for (
      const [category, regex]
      of Object.entries(CATEGORY_PATTERNS)
    ) {

      if (
        regex.test(text)
      ) {

        if (
          !result.commentCategories[category]
        ) {

          result.commentCategories[category] = [];

        }


        if (
          !result.commentCategories[category]
            .some(
              existing =>
                duplicateKey(existing) ===
                duplicateKey(text)
            )
        ) {

          result.commentCategories[category]
            .push(text);

        }


        foundCategory = true;

      }

    }


    if (!foundCategory) {

      if (
        !result.commentCategories.General
          .some(
            existing =>
              duplicateKey(existing) ===
              duplicateKey(text)
          )
      ) {

        result.commentCategories.General
          .push(text);

      }

    }

  }


  // ==========================================================
  // ADD ATTENTION COMMENT
  // ==========================================================

  function addAttention(
    text
  ) {

    if (
      !result.commentsNeedingAttention
        .some(
          existing =>
            duplicateKey(existing) ===
            duplicateKey(text)
        )
    ) {

      result.commentsNeedingAttention
        .push(text);

    }


    addToCategory(text);

  }


  // ==========================================================
  // ADD APPRECIATION COMMENT
  // ==========================================================

  function addAppreciation(
    text
  ) {

    if (
      !result.appreciation
        .some(
          existing =>
            duplicateKey(existing) ===
            duplicateKey(text)
        )
    ) {

      result.appreciation
        .push(text);

    }

  }


  // ==========================================================
  // GENERIC NEGATIVE / ACTIONABLE CHECK (extra safety net)
  // ==========================================================

  function hasGenericNegative(text) {
    const negativeIndicators = [
      // Specific negation + quality word
      /\bnot\s+(good|clear|helpful|available|punctual|organized|effective|understandable|satisfactory)\b/i,
      /\bdoesn'?t\s+(explain|teach|provide|help|come|attend|listen|respond|answer)\b/i,
      /\bdidn'?t\s+(understand|cover|explain|teach|give|provide|complete|finish)\b/i,
      /\bcan'?t\s+(understand|follow|hear|grasp|comprehend)\b/i,
      /\b(never|hardly|rarely|barely)\s+(available|present|comes?|helps?|explains?|answers?)\b/i,
      // Specific speed complaints
      /\btoo\s+(fast|slow|quick|rushed)\b/i,
      /\bspeaks?\s+very\s+(fast|slow|quickly|slowly)\b/i,
      // Explicit dissatisfaction (not standalone loose words)
      /\b(not\s+satisfied|dissatisfied|unsatisfied)\b/i,
      /\b(very\s+poor|very\s+bad|very\s+boring|very\s+dull|very\s+rude|very\s+harsh)\b/i,
      /\b(absent|irregular|late\s+to\s+class|not\s+punctual)\b/i,
    ];
    return negativeIndicators.some(pattern => pattern.test(text));
  }


  // ==========================================================
  // PROCESS EVERY ORIGINAL COMMENT
  // ==========================================================

  for (
    const originalComment
    of rawComments
  ) {

    // --------------------------------------------------------
    // Invalid input
    // --------------------------------------------------------

    if (
      !originalComment ||
      typeof originalComment !== 'string'
    ) {

      result.statistics.skipped++;

      continue;

    }


    // --------------------------------------------------------
    // VERY IMPORTANT:
    //
    // Do NOT do this:
    //
    // originalComment.split(SPLIT_REGEX)
    //
    // The complete student comment must remain intact.
    // --------------------------------------------------------

    const text =
      normalizeComment(
        originalComment
      );


    if (!text) {

      result.statistics.skipped++;

      continue;

    }


    // ========================================================
    // SKIP EMPTY / INVALID
    // ========================================================

    if (
      SKIP_PATTERNS.some(
        pattern =>
          pattern.test(text)
      )
    ) {

      result.statistics.skipped++;


      result.classifiedComments.push({

        text,

        classification:
          'skipped',

        needsAttention:
          false,

        reason:
          'empty-or-filler'

      });


      continue;

    }


    // ========================================================
    // SKIP NEUTRAL FILLER
    // ========================================================

    if (
      NEUTRAL_SKIP_PATTERNS.some(
        pattern =>
          pattern.test(
            text.toLowerCase()
          )
      )
    ) {

      result.statistics.skipped++;


      result.classifiedComments.push({

        text,

        classification:
          'neutral',

        needsAttention:
          false,

        reason:
          'neutral-filler'

      });


      continue;

    }


    const lower =
      text.toLowerCase();


    // ========================================================
    // DETECT POSITIVE
    // ========================================================

    const hasPositive =
      POSITIVE_PATTERNS.some(
        pattern =>
          pattern.test(lower)
      );


    // ========================================================
    // DETECT ACTIONABLE NEGATIVE
    // ========================================================

    const hasNegative =
      NEGATIVE_PATTERNS.some(
        pattern =>
          pattern.test(lower)
      );
    
    const hasGenericNeg = hasGenericNegative(text);


    // ========================================================
    // RULE #1
    //
    // NEGATIVE ALWAYS HAS PRIORITY
    //
    // This solves:
    //
    // "Faculty teaches very well but does not provide
    // enough practical examples."
    //
    // Positive = YES
    // Negative = YES
    // Final = NEED ATTENTION
    // 
    // BUT: If comment is purely positive (multiple positive words,
    // no strong negative), don't mis-classify
    // ========================================================

    if (
      hasNegative || hasGenericNeg
    ) {

      addAttention(text);


      result.statistics.attention++;


      result.classifiedComments.push({

        text,

        classification:
          'attention',

        needsAttention:
          true,

        mixedSentiment:
          hasPositive,

        reason:
          hasPositive
            ? 'mixed-with-criticism'
            : 'needs-improvement'

      });


      continue;

    }


    // ========================================================
    // RULE #2: PURE POSITIVE ONLY
    //
    // Only appreciation if NO negative words detected
    // ========================================================

    if (
      hasPositive
    ) {

      addAppreciation(text);


      result.statistics.appreciation++;


      result.classifiedComments.push({

        text,

        classification:
          'appreciation',

        needsAttention:
          false,

        mixedSentiment:
          false,

        reason:
          'purely-positive'

      });


      continue;

    }


    // ========================================================
    // RULE #3
    //
    // LONG UNKNOWN COMMENT
    //
    // Let HuggingFace help, but NEVER let it override an
    // actionable negative already detected above.
    // ========================================================

    if (
      text.split(/\s+/).length > 5
    ) {

      try {

        const model =
          await getSentimentPipeline();


        if (model) {

          const aiResult =
            await model(text);


          const label =
            String(
              aiResult?.[0]?.label || ''
            ).toUpperCase();


          const score =
            Number(
              aiResult?.[0]?.score || 0
            );


          // --------------------------------------------------
          // AI NEGATIVE
          // --------------------------------------------------

          if (
            label === 'NEGATIVE' &&
            score >= 0.70
          ) {

            addAttention(text);


            result.statistics.attention++;

            result.statistics.aiClassified++;


            result.classifiedComments.push({

              text,

              classification:
                'attention',

              needsAttention:
                true,

              confidence:
                score,

              reason:
                'huggingface-negative'

            });


            continue;

          }


          // --------------------------------------------------
          // AI POSITIVE
          // --------------------------------------------------

          if (
            label === 'POSITIVE' &&
            score >= 0.70
          ) {

            addAppreciation(text);


            result.statistics.appreciation++;

            result.statistics.aiClassified++;


            result.classifiedComments.push({

              text,

              classification:
                'appreciation',

              needsAttention:
                false,

              confidence:
                score,

              reason:
                'huggingface-positive'

            });


            continue;

          }

        }

      } catch (error) {

        console.warn(
          '[AI] HuggingFace fallback failed:',
          error.message
        );

      }

    }


    // ========================================================
    // RULE #4
    //
    // UNKNOWN COMMENT
    //
    // IMPORTANT:
    // Don't throw it away.
    //
    // Keep it in classifiedComments as neutral so you can
    // inspect it later.
    // ========================================================

    result.statistics.neutral++;


    result.classifiedComments.push({

      text,

      classification:
        'neutral',

      needsAttention:
        false,

      reason:
        'uncertain'

    });

  }


  // ==========================================================
  // FINAL DEDUPLICATION
  // ==========================================================

  result.appreciation =
    deduplicateComments(
      result.appreciation
    );


  result.commentsNeedingAttention =
    deduplicateComments(
      result.commentsNeedingAttention
    );


  // ==========================================================
  // IMPORTANT:
  //
  // If the same comment somehow appears in both lists,
  // NEED ATTENTION WINS.
  // ==========================================================

  const attentionKeys =
    new Set(
      result.commentsNeedingAttention
        .map(
          comment =>
            duplicateKey(comment)
        )
    );


  result.appreciation =
    result.appreciation.filter(
      comment =>
        !attentionKeys.has(
          duplicateKey(comment)
        )
    );


  // ==========================================================
  // FINAL COUNTS
  // ==========================================================

  result.statistics.appreciation =
    result.appreciation.length;


  result.statistics.attention =
    result.commentsNeedingAttention.length;


  // ==========================================================
  // LOG
  // ==========================================================

  console.log(
    '[AI] ========================================'
  );

  console.log(
    '[AI] Comment analysis completed'
  );

  console.log(
    `[AI] Received: ${rawComments.length}`
  );

  console.log(
    `[AI] Appreciation: ${result.appreciation.length}`
  );

  console.log(
    `[AI] Need Attention: ${result.commentsNeedingAttention.length}`
  );

  console.log(
    `[AI] Neutral/uncertain: ${result.statistics.neutral}`
  );

  console.log(
    `[AI] Skipped: ${result.statistics.skipped}`
  );

  console.log(
    `[AI] AI classified: ${result.statistics.aiClassified}`
  );

  console.log(
    '[AI] ========================================'
  );


  return result;
}


// Export the main function
module.exports = {
  classifyComments,
  testGeminiConnection: async () => {
    try {
      await getSentimentPipeline();
      return { ok: true, engine: 'HuggingFace Transformers' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
};
