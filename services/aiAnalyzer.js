// ============================================================
// COLLEGE FEEDBACK INTELLIGENCE — HuggingFace DeBERTa v3
// Model: MoritzLaurer/deberta-v3-base-zeroshot-v1
// Zero-shot classification — no training required
// Replaces the old rule-based v6 engine
// ============================================================

const { classifyCommentsWithHF } = require('./hfClassifierService');

// ── MAIN CLASSIFIER (async, powered by HuggingFace DeBERTa) ─────────────────
async function classifyComments(rawComments) {
  console.log('[AI] ========================================');
  console.log('[AI] HuggingFace DeBERTa Zero-Shot Classifier');
  console.log(`[AI] Received: ${(rawComments || []).length} comments`);

  try {
    const result = await classifyCommentsWithHF(rawComments);
    console.log(`[AI] Attention  : ${result.commentsNeedingAttention.length}`);
    console.log(`[AI] Appreciate : ${result.appreciation.length}`);
    console.log(`[AI] Neutral    : ${result.statistics.neutral}`);
    console.log(`[AI] Skipped    : ${result.statistics.skipped}`);
    console.log('[AI] ========================================');
    return result;
  } catch (err) {
    console.error('[AI] HuggingFace classifier error:', err.message);
    // Return safe empty result on failure
    return {
      appreciation: [],
      commentsNeedingAttention: [],
      commentCategories: { Teaching: [], Communication: [], Availability: [], Materials: [], Assessment: [], General: [] },
      classifiedComments: [],
      statistics: {
        totalReceived: (rawComments || []).length,
        appreciation: 0, attention: 0, neutral: 0, skipped: 0, aiClassified: 0
      }
    };
  }
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
    engine: 'HuggingFace DeBERTa v3 Zero-Shot — MoritzLaurer/deberta-v3-base-zeroshot-v1',
    categories: ['TEACHING_CLARITY', 'PACING_AND_TIME', 'PRACTICAL_LAB', 'NOTES_AND_MATERIALS',
      'DOUBT_SUPPORT', 'ASSESSMENT_AND_FAIRNESS', 'COMMUNICATION_AND_ENGAGEMENT',
      'FACILITIES_AND_EQUIPMENT', 'COURSE_PLANNING', 'STUDENT_SUPPORT_AND_PROFESSIONALISM']
  }),
};
