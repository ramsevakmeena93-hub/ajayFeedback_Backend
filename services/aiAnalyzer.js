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
  /\b(excellent|outstanding|amazing|wonderful|fantastic|great|good|nice|best|helpful|clear|friendly|supportive)\b/i,
  /\b(achha|accha|badhiya|best|good|nice|helpful)\b/i
];

const NEGATIVE_PATTERNS = [
  /\b(improve|need|should|must|better|more|less|slow|fast|poor|bad|difficult)\b/i,
  /\b(nahi|nahin|bahut kam|thoda|improve karo)\b/i
];

const SKIP_PATTERNS = [
  /^(no|none|na|nahi|nil|\.{3,}|-{3,}|_{3,})$/i,
  /^.{1,3}$/
];

const NEUTRAL_SKIP_PATTERNS = [
  /^(ok|okay|fine|average|normal|moderate)$/i
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
    return /\b(not|never|hardly|rarely|barely|don't|doesn't|didn't|can't|cannot|won't|shouldn't|couldn't|less|poor|improve|issue|problem|slow|fast|rude|absent|late|lack|difficult|insufficient)\b/i.test(text);
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
    // ========================================================

    if (
      hasNegative
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
            ? 'positive-praise-with-actionable-feedback'
            : 'actionable-negative-feedback'

      });


      continue;

    }


    // ========================================================
    // RULE #2
    //
    // GENERIC NEGATION
    //
    // Examples:
    //
    // "Teacher is not available."
    // "Faculty does not explain clearly."
    // "Notes are not provided."
    // ========================================================

    if (
      hasGenericNegative(text)
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
          'negative-language'

      });


      continue;

    }


    // ========================================================
    // RULE #3
    //
    // POSITIVE
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
          'positive-feedback'

      });


      continue;

    }


    // ========================================================
    // RULE #4
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
    // RULE #5
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
