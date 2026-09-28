// ============================================================
// FINAL COMMENT ANALYZER
// ============================================================
// IMPORTANT:
// - NEVER split the original student comment.
// - Positive + actionable negative = NEED ATTENTION.
// - Preserve the complete original comment.
// - Do not silently delete unknown comments.
// - English + Hinglish patterns from the existing classifier
//   are still used.
// ============================================================

let pipeline = null;
let pipelineLoading = false;

// Sentiment patterns
const POSITIVE_PATTERNS = [
  // Very strong positive only
  /\b(excellent|outstanding|amazing|wonderful|fantastic|superb|brilliant|perfect|exceptional|extraordinary)\b/i,
  
  // Strong appreciation
  /\b(love|loved|enjoyed|appreciate|grateful|thank|thanks|thankful)\b/i,
  
  // Specific positive teaching qualities
  /\b(very\s+(?:good|helpful|clear|patient|knowledgeable|experienced|dedicated))\b/i,
  /\b(extremely\s+(?:good|helpful|supportive|knowledgeable))\b/i,
  /\b(best\s+(?:teacher|faculty|professor|explanation|teaching))\b/i,
  
  // Strong Hindi positive
  /\b(bahut\s+(?:accha|achha|badhiya)|zabardast|kamaal|behtareen)\b/i,
  
  // Well + strong verb
  /\b(very\s+well\s+(?:explained|taught|organized|structured))\b/i,
  /\b(extremely\s+well\s+(?:explained|taught))\b/i
];

const NEGATIVE_PATTERNS = [
  // Direct criticism
  /\b(improve|need|should|must|better|lack|lacking|insufficient|inadequate)\b/i,
  
  // Quality issues
  /\b(poor|bad|worst|terrible|horrible|useless|waste|boring|dull|monotonous)\b/i,
  
  // Speed/pace issues
  /\b(too\s+(?:fast|slow|quick|rushed)|very\s+(?:fast|slow)|so\s+(?:fast|slow))\b/i,
  
  // Understanding issues
  /\b(difficult|hard|confusing|unclear|complicated|not\s+clear|doesn'?t\s+explain|can'?t\s+understand)\b/i,
  
  // Quantity issues
  /\b(more\s+(?:time|examples|practice|attention|explanation|details|classes)|less\s+(?:time|attention)|not\s+enough)\b/i,
  
  // Negative comparisons
  /\b(not\s+(?:good|helpful|available|punctual|organized|satisfied|happy))\b/i,
  /\b(doesn'?t\s+(?:explain|teach|provide|help|come|attend|give))\b/i,
  /\b(didn'?t\s+(?:understand|cover|explain|teach|give|provide))\b/i,
  
  // Behavioral issues
  /\b(rude|arrogant|biased|unfair|partial|angry|harsh|strict|mean)\b/i,
  /\b(absent|late|irregular|unavailable|never\s+available|rarely\s+available)\b/i,
  
  // Hindi negative patterns
  /\b(nahi|nahin|bahut\s+kam|thoda|improve\s+karo|samajh\s+nahi\s+aaya|accha\s+nahi)\b/i,
  
  // Suggestions (even polite ones = need attention)
  /\b(could\s+(?:improve|do|give|provide)|would\s+be\s+better|might\s+want\s+to|try\s+to)\b/i,
  
  // Mixed sentiment markers (good BUT...)
  /\b(but|however|although|though)\b/i
];

const SKIP_PATTERNS = [
  /^(no|none|na|nahi|nil|n\.?a\.?|\.{3,}|-{3,}|_{3,})$/i,
  /^.{1,3}$/
];

const NEUTRAL_SKIP_PATTERNS = [
  /^(ok|okay|fine|average|normal|moderate|alright|decent)$/i
];

const CATEGORY_PATTERNS = {
  Teaching: /\b(teach|explain|lecture|class|concept)\b/i,
  Communication: /\b(communicate|talk|speak|language)\b/i,
  Availability: /\b(available|accessible|office|hours)\b/i,
  Materials: /\b(notes|slides|material|book|resource)\b/i,
  Assessment: /\b(exam|test|quiz|grade|mark|assignment)\b/i,
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
  if (pipeline) return pipeline;
  if (pipelineLoading) {
    while (pipelineLoading) await new Promise(r => setTimeout(r, 100));
    return pipeline;
  }
  pipelineLoading = true;
  try {
    // Use require instead of dynamic import for better compatibility
    const { pipeline: createPipeline } = require('@xenova/transformers');
    pipeline = await createPipeline('sentiment-analysis', 'Xenova/distilbert-base-uncased-finetuned-sst-2-english');
    console.log('[AI] HuggingFace sentiment model loaded');
  } catch (err) {
    console.error('[AI] Failed to load HuggingFace model:', err.message);
    // Don't throw - fall back to rule-based classification only
    pipeline = null;
  } finally {
    pipelineLoading = false;
  }
  return pipeline;
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
  // GENERIC NEGATIVE / ACTIONABLE CHECK
  // ==========================================================

  function hasGenericNegative(text) {
    const negativeIndicators = [
      /\bnot\s+(good|clear|helpful|enough|available|punctual|organized)\b/i,
      /\bdoesn'?t\s+(explain|teach|provide|help|come|attend)\b/i,
      /\bdidn'?t\s+(understand|cover|explain|teach|give|provide)\b/i,
      /\bcan'?t\s+(understand|follow|hear|see)\b/i,
      /\bwon'?t\s+(help|explain|answer|respond)\b/i,
      /\b(never|hardly|rarely|barely|seldom)\s+(available|present|comes|helps|explains)\b/i,
      /\b(too\s+fast|too\s+slow|too\s+difficult|too\s+easy|too\s+much|too\s+less)\b/i,
      /\b(less|poor|lack|insufficient|inadequate|absent|late|rude|biased|unfair|boring|waste)\b/i
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
