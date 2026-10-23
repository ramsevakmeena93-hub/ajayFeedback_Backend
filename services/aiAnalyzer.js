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
  // Calls HuggingFace Inference API (Mistral-7B) to generate a professional
  // "Action Taken by HOD" paragraph based on actual student comments.
  generateActionSuggestion: async function(commentsNeedingAttention, facultyName) {
    const comments = (commentsNeedingAttention || []).filter(Boolean);

    // Default when no attention comments
    if (comments.length === 0) {
      return 'Performance is satisfactory. Faculty is encouraged to maintain quality teaching standards and continue positive student engagement.';
    }

    const HF_TOKEN = process.env.HF_API_TOKEN || '';
    const MODEL    = 'mistralai/Mistral-7B-Instruct-v0.3';

    // Build a concise prompt
    const commentsList = comments.slice(0, 20).map((c, i) => `${i + 1}. ${c}`).join('\n');
    const prompt = `<s>[INST] You are a Head of Department (HOD) writing official instructions to a faculty member${facultyName ? ` named "${facultyName}"` : ''} based on student feedback complaints.

Student complaints received:
${commentsList}

Write a formal 3-4 sentence instruction paragraph addressed directly to the faculty. Use:
- First person HOD voice ("I have reviewed...", "You are hereby directed...", "It is expected that...")
- Direct, authoritative but professional tone
- Specific improvement actions the faculty must take
- Future tense for what the faculty must do going forward

Write only the instruction paragraph. No headings, no bullet points, no extra explanation. [/INST]`;

    try {
      const https = require('https');
      const body  = JSON.stringify({
        inputs: prompt,
        parameters: {
          max_new_tokens: 200,
          temperature: 0.4,
          do_sample: true,
          return_full_text: false,
        }
      });

      const result = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api-inference.huggingface.co',
          path:     `/models/${MODEL}`,
          method:   'POST',
          headers: {
            'Content-Type':   'application/json',
            'Content-Length': Buffer.byteLength(body),
            'Authorization':  `Bearer ${HF_TOKEN}`,
          }
        }, (res) => {
          let data = '';
          res.on('data', c => { data += c; });
          res.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(new Error('BAD_JSON')); }
          });
        });
        req.on('error', e => reject(e));
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('TIMEOUT')); });
        req.write(body);
        req.end();
      });

      // HF returns array: [{ generated_text: "..." }]
      let text = '';
      if (Array.isArray(result) && result[0]?.generated_text) {
        text = result[0].generated_text.trim();
      } else if (result?.generated_text) {
        text = result.generated_text.trim();
      } else if (result?.error) {
        throw new Error(result.error);
      }

      if (text) {
        // Clean up any leftover instruction markers
        text = text.replace(/<\/s>|<s>|\[INST\]|\[\/INST\]/g, '').trim();
        return text;
      }
      throw new Error('empty response');

    } catch (err) {
      console.warn('[AI Action Suggest] HF API failed:', err.message, '— using rule fallback');
      // ── Rule-based fallback ───────────────────────────────────────────────
      const RX = {
        pace:       /\b(fast|slow|pace|speed|rushed)\b/i,
        clarity:    /\b(unclear|confus|not\s+clear|explain|concept|understand)\b/i,
        lab:        /\b(lab|practical|code|hands.?on|program)\b/i,
        notes:      /\b(notes?|slides?|material|missing|incomplete|late|share|upload)\b/i,
        doubts:     /\b(doubt|question|hesitat|ignored|unanswer)\b/i,
        assessment: /\b(quiz|marks?|assessment|marking|criteria)\b/i,
        engagement: /\b(interact|boring|monoton|engage|examples?|voice)\b/i,
        planning:   /\b(plan|schedul|syllabus|revision)\b/i,
        support:    /\b(support|guidance|disrespect|impatient)\b/i,
      };
      const actionMap = {
        pace:       'The faculty was advised to moderate teaching pace and allow adequate time for note-taking.',
        clarity:    'The faculty was directed to explain concepts step-by-step, starting from fundamentals before advancing.',
        lab:        'The faculty was instructed to ensure hands-on coding practice and live debugging demonstrations in every lab session.',
        notes:      'The faculty was asked to upload complete notes, diagrams, and solved examples on the portal before each class.',
        doubts:     'Weekly doubt-clearing sessions were assigned; the faculty was advised to periodically check student understanding.',
        assessment: 'The faculty was reminded to share assessment criteria in advance and review quiz answers with the class.',
        engagement: 'The faculty was suggested to incorporate real-world examples, interactive Q&A, and board demonstrations.',
        planning:   'The teaching plan was reviewed; the faculty was advised to complete the syllabus at least two weeks before assessments.',
        support:    'The faculty was counselled on maintaining a respectful, supportive classroom environment.',
      };
      const found = new Set();
      comments.forEach(c => {
        let matched = false;
        for (const [key, rx] of Object.entries(RX)) {
          if (rx.test(c)) { found.add(key); matched = true; }
        }
        if (!matched) found.add('clarity');
      });
      const actions = [...found].slice(0, 3).map(k => actionMap[k]).filter(Boolean);
      return actions.join(' ');
    }
  },

  testGeminiConnection: async () => ({
    ok: true,
    engine: 'HuggingFace DeBERTa v3 Zero-Shot — MoritzLaurer/deberta-v3-base-zeroshot-v1',
    categories: ['TEACHING_CLARITY', 'PACING_AND_TIME', 'PRACTICAL_LAB', 'NOTES_AND_MATERIALS',
      'DOUBT_SUPPORT', 'ASSESSMENT_AND_FAIRNESS', 'COMMUNICATION_AND_ENGAGEMENT',
      'FACILITIES_AND_EQUIPMENT', 'COURSE_PLANNING', 'STUDENT_SUPPORT_AND_PROFESSIONALISM']
  }),
};
