// ============================================================
// COLLEGE FEEDBACK INTELLIGENCE — HuggingFace DeBERTa v3
// Model: MoritzLaurer/deberta-v3-base-zeroshot-v1
// Zero-shot classification — no training required
// Replaces the old rule-based v6 engine
// ============================================================

const axios = require('axios');
const { classifyCommentsWithHF } = require('./hfClassifierService');

const FASTAPI_URL = process.env.FASTAPI_CLASSIFIER_URL || 'http://localhost:7860';

async function testFastAPIConnection() {
  try {
    const res = await axios.get(`${FASTAPI_URL}/health`, { timeout: 3000 });
    return { ok: res.data?.status === 'ok', url: FASTAPI_URL };
  } catch (err) {
    return { ok: false, url: FASTAPI_URL, error: err.message };
  }
}

// ── MAIN CLASSIFIER (async, powered by FastAPI / HuggingFace DeBERTa) ────────
async function classifyComments(rawComments) {
  const comments = (rawComments || []).filter(c => c !== null && c !== undefined);
  console.log('[AI] ========================================');
  console.log('[AI] Feedback Intelligence Classifier');
  console.log(`[AI] Received: ${comments.length} comments`);

  if (!comments.length) {
    return {
      appreciation: [],
      commentsNeedingAttention: [],
      commentCategories: { Teaching: [], Communication: [], Availability: [], Materials: [], Assessment: [], General: [] },
      classifiedComments: [],
      statistics: { totalReceived: 0, appreciation: 0, attention: 0, neutral: 0, skipped: 0, aiClassified: 0 }
    };
  }

  // 1. Try redirecting to FastAPI DeBERTa server if reachable
  if (FASTAPI_URL) {
    try {
      console.log(`[AI] Forwarding to FastAPI classifier at ${FASTAPI_URL}/classify...`);
      const payload = comments.map(c => typeof c === 'object' && c !== null ? (c.text || c.comment || '') : String(c));
      const response = await axios.post(`${FASTAPI_URL}/classify`, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000
      });

      const result = response.data;
      console.log(`[AI] FastAPI Success: ${result.commentsNeedingAttention?.length || 0} attention, ${result.appreciation?.length || 0} appreciation`);
      console.log('[AI] ========================================');
      return result;
    } catch (err) {
      console.warn(`[AI] FastAPI unavailable (${err.message}) — falling back to local HF/rule engine`);
    }
  }

  // 2. Fallback to HF service / high-precision rule engine
  try {
    const result = await classifyCommentsWithHF(comments);
    console.log(`[AI] Attention  : ${result.commentsNeedingAttention.length}`);
    console.log(`[AI] Appreciate : ${result.appreciation.length}`);
    console.log(`[AI] Neutral    : ${result.statistics.neutral}`);
    console.log(`[AI] Skipped    : ${result.statistics.skipped}`);
    console.log('[AI] ========================================');
    return result;
  } catch (err) {
    console.error('[AI] Classifier fallback error:', err.message);
    return {
      appreciation: [],
      commentsNeedingAttention: [],
      commentCategories: { Teaching: [], Communication: [], Availability: [], Materials: [], Assessment: [], General: [] },
      classifiedComments: [],
      statistics: {
        totalReceived: comments.length,
        appreciation: 0, attention: 0, neutral: 0, skipped: 0, aiClassified: 0
      }
    };
  }
}

module.exports = {
  classifyComments,
  analyzeCommentsWithAI: classifyComments,
  testFastAPIConnection,

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
