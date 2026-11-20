// ============================================================
// IMPROVED FEEDBACK CLASSIFIER WITH STRICT SEPARATION
// Fixes mixed classification issues using:
// 1. Stricter negation detection
// 2. Higher confidence thresholds
// 3. Contextual analysis
// 4. Double-check validation
// ============================================================

const https = require('https');

// ── CRITICAL ATTENTION KEYWORDS (Always needs attention) ────────────────────
const CRITICAL_ATTENTION_KEYWORDS = [
  /\b(problem|issue|complaint|concern|difficulty|struggle|trouble|challenge|obstacle)\b/i,
  /\b(not\s+(good|clear|helpful|understandable|explained|teaching|interactive))\b/i,
  /\b(too\s+(fast|slow|difficult|hard|complex|rushed))\b/i,
  /\b(should\s+(improve|change|fix|address|resolve))\b/i,
  /\b(need\s+(more|better|improvement|attention))\b/i,
  /\b(lacking|missing|absent|insufficient|inadequate|poor|weak)\b/i,
  /\b(confused|confusing|unclear|ambiguous|vague)\b/i,
  /\b(never|rarely|hardly|barely|seldom)\s+(help|explain|respond|answer|available)\b/i,
  /\b(does\s+not|doesn't|don't|cannot|can't)\s+(explain|help|answer|respond|clarify)\b/i,
  /\b(late|delayed|missed|skipped|rushed|hurried)\b/i,
];

// ── CRITICAL APPRECIATION KEYWORDS (Always appreciation) ────────────────────
const CRITICAL_APPRECIATION_KEYWORDS = [
  /\b(excellent|outstanding|amazing|fantastic|wonderful|superb|brilliant|exceptional)\b/i,
  /\b(best|perfect|great|awesome|incredible|remarkable)\b/i,
  /\b(love|loved|enjoy|enjoyed|appreciate|grateful|thankful)\b/i,
  /\b(very\s+(good|helpful|clear|patient|knowledgeable|dedicated))\b/i,
  /\b(well\s+(explained|taught|organized|structured))\b/i,
  /\b(crystal\s+clear|easy\s+to\s+understand)\b/i,
];

// ── NEGATION PATTERNS (Context-aware) ────────────────────────────────────────
const NEGATION_BEFORE = /\b(no|not|never|hardly|rarely|barely|doesn't|don't|isn't|aren't|cannot|can't|won't|wouldn't)\s+/i;
const POSITIVE_NEGATION = /\b(not\s+(boring|difficult|hard|confusing)|no\s+(problem|issue|complaint))\b/i;

function hasNegation(text) {
  // Check if text has negation BUT NOT positive negation
  if (POSITIVE_NEGATION.test(text)) return false;
  return NEGATION_BEFORE.test(text);
}

// ── SENTIMENT SCORER WITH CONFIDENCE ─────────────────────────────────────────
function scoreWithConfidence(text) {
  const lower = text.toLowerCase();
  
  // Count critical markers
  let attentionScore = 0;
  let appreciationScore = 0;
  
  CRITICAL_ATTENTION_KEYWORDS.forEach(pattern => {
    const matches = lower.match(pattern);
    if (matches) attentionScore += 3; // Increased weight
  });
  
  CRITICAL_APPRECIATION_KEYWORDS.forEach(pattern => {
    const matches = lower.match(pattern);
    if (matches) appreciationScore += 3; // Increased weight
  });
  
  // Count general positive/negative words
  const posWords = (lower.match(/\b(good|nice|clear|helpful|supportive|effective|organized|explains?\s+well|teaches?\s+well)\b/g) || []).length;
  const negWords = (lower.match(/\b(bad|poor|weak|lacking|inadequate|confusing|late|low|unanswered)\b/g) || []).length;
  
  appreciationScore += posWords * 1.5; // Increased from 1
  attentionScore += negWords * 1.5;
  
  // Check for negation affecting positive words
  if (hasNegation(text) && posWords > 0) {
    // Negated positive = attention (strong signal)
    attentionScore += posWords * 3; // Increased from 2
    appreciationScore = Math.max(0, appreciationScore - posWords * 2);
  }
  
  // Boost appreciation if has explicit praise verbs
  if (/\b(explains?|teaches?|clears?|resolves?|answers?)\s+(well|clearly|patiently|effectively|properly|nicely)\b/i.test(lower)) {
    appreciationScore += 2;
  }
  
  // Boost attention if has explicit problem words
  if (/\b(too\s+(fast|slow|low)|not\s+(clear|helpful|organized|provided)|left\s+unanswered)\b/i.test(lower)) {
    attentionScore += 2;
  }
  
  const confidence = Math.abs(appreciationScore - attentionScore);
  
  if (appreciationScore > attentionScore && confidence >= 1.5) {
    return { classification: 'appreciation', confidence: Math.round(confidence) };
  } else if (attentionScore > appreciationScore && confidence >= 1.5) {
    return { classification: 'attention', confidence: Math.round(confidence) };
  } else {
    return { classification: 'neutral', confidence: 0 };
  }
}

// ── GOOGLE GEMINI AI CLASSIFIER (Higher accuracy) ────────────────────────────
async function classifyWithGemini(text) {
  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) throw new Error('NO_GEMINI_KEY');
  
  const axios = require('axios');
  
  const prompt = `You are a feedback classifier for college student comments about faculty teaching.

Classify this comment as EXACTLY ONE of: APPRECIATION, ATTENTION, or NEUTRAL

Rules:
1. APPRECIATION: Positive feedback, praise, gratitude, satisfaction
2. ATTENTION: Problems, complaints, suggestions for improvement, negative feedback
3. NEUTRAL: Generic comments like "ok", "fine", "average" with no specific feedback
4. If a comment has "not" or "never" before positive words, it's ATTENTION
5. If a comment mentions problems or issues, it's ATTENTION regardless of positive words

Comment: "${text}"

Respond with ONLY ONE WORD: APPRECIATION, ATTENTION, or NEUTRAL`;

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`,
      {
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.1,  // Very low temperature for consistency
          maxOutputTokens: 10,
          topP: 0.8,
          topK: 10
        }
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      }
    );

    const result = response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase();
    
    if (result === 'APPRECIATION') return 'appreciation';
    if (result === 'ATTENTION') return 'attention';
    return 'neutral';
  } catch (err) {
    throw new Error(`Gemini API error: ${err.message}`);
  }
}

// ── HUGGINGFACE DEBERTA CLASSIFIER (Fallback) ────────────────────────────────
async function classifyWithHF(text) {
  const TOKEN = process.env.HF_API_TOKEN;
  if (!TOKEN) throw new Error('NO_HF_TOKEN');
  
  const candidateLabels = [
    'student appreciates and praises the teacher',
    'student complains and reports problems',
    'neutral comment with no specific feedback'
  ];
  
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      inputs: text,
      parameters: {
        candidate_labels: candidateLabels,
        multi_label: false,
        hypothesis_template: 'This comment expresses that the {}',
      }
    });
    
    const req = https.request({
      hostname: 'api-inference.huggingface.co',
      path: `/models/MoritzLaurer/deberta-v3-large-zeroshot-v2.0`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${TOKEN}`
      }
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error));
          
          const topLabel = parsed.labels[0];
          const topScore = parsed.scores[0];
          
          // Require high confidence (>0.6)
          if (topScore < 0.6) return resolve('neutral');
          
          if (topLabel.includes('appreciates')) return resolve('appreciation');
          if (topLabel.includes('complains')) return resolve('attention');
          return resolve('neutral');
        } catch (e) { reject(e); }
      });
    });
    
    req.on('error', e => reject(e));
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.write(body);
    req.end();
  });
}

// ── MAIN IMPROVED CLASSIFIER ─────────────────────────────────────────────────
async function classifyComment(text) {
  if (!text || text.trim().length < 3) {
    return { classification: 'neutral', confidence: 'skipped', method: 'length' };
  }
  
  const cleaned = text.trim();
  
  // Step 1: Rule-based high-confidence classification
  const ruleResult = scoreWithConfidence(cleaned);
  if (ruleResult.confidence >= 3) {
    return {
      classification: ruleResult.classification,
      confidence: 'high',
      method: 'rules',
      score: ruleResult.confidence
    };
  }
  
  // Step 2: Try Gemini AI (if available)
  try {
    const geminiResult = await classifyWithGemini(cleaned);
    if (geminiResult !== 'neutral') {
      // Double-check with rules
      if (ruleResult.classification === geminiResult || ruleResult.classification === 'neutral') {
        return {
          classification: geminiResult,
          confidence: 'high',
          method: 'gemini',
          ruleCheck: ruleResult.classification
        };
      }
      // Conflict: Gemini says appreciation but rules say attention -> trust rules
      if (ruleResult.classification === 'attention' && geminiResult === 'appreciation') {
        return {
          classification: 'attention',
          confidence: 'medium',
          method: 'rules-override',
          geminiSaid: geminiResult
        };
      }
    }
  } catch (err) {
    console.log('[Classifier] Gemini unavailable, trying HF...');
  }
  
  // Step 3: Try HuggingFace (fallback)
  try {
    const hfResult = await classifyWithHF(cleaned);
    if (hfResult !== 'neutral') {
      // Double-check with rules
      if (ruleResult.classification === hfResult || ruleResult.classification === 'neutral') {
        return {
          classification: hfResult,
          confidence: 'medium',
          method: 'huggingface',
          ruleCheck: ruleResult.classification
        };
      }
    }
  } catch (err) {
    console.log('[Classifier] HuggingFace unavailable, using rules...');
  }
  
  // Step 4: Fall back to rules even with low confidence
  if (ruleResult.classification !== 'neutral') {
    return {
      classification: ruleResult.classification,
      confidence: 'low',
      method: 'rules-fallback',
      score: ruleResult.confidence
    };
  }
  
  // Step 5: Default to neutral
  return {
    classification: 'neutral',
    confidence: 'low',
    method: 'default'
  };
}

// ── BATCH CLASSIFIER ─────────────────────────────────────────────────────────
async function classifyComments(comments) {
  const results = {
    appreciation: [],
    commentsNeedingAttention: [],
    statistics: {
      total: comments.length,
      appreciation: 0,
      attention: 0,
      neutral: 0,
      highConfidence: 0,
      mediumConfidence: 0,
      lowConfidence: 0
    }
  };
  
  console.log(`[Improved Classifier] Processing ${comments.length} comments...`);
  
  for (let i = 0; i < comments.length; i++) {
    const comment = typeof comments[i] === 'string' ? comments[i] : (comments[i]?.text || comments[i]?.comment || '');
    
    if (!comment || comment.trim().length < 3) {
      results.statistics.neutral++;
      continue;
    }
    
    const result = await classifyComment(comment);
    
    console.log(`[${i + 1}/${comments.length}] "${comment.substring(0, 50)}..." -> ${result.classification} (${result.confidence})`);
    
    if (result.classification === 'appreciation') {
      results.appreciation.push(comment);
      results.statistics.appreciation++;
    } else if (result.classification === 'attention') {
      results.commentsNeedingAttention.push(comment);
      results.statistics.attention++;
    } else {
      results.statistics.neutral++;
    }
    
    if (result.confidence === 'high') results.statistics.highConfidence++;
    else if (result.confidence === 'medium') results.statistics.mediumConfidence++;
    else if (result.confidence === 'low') results.statistics.lowConfidence++;
    
    // Rate limiting: wait 100ms between calls
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log('[Improved Classifier] Results:');
  console.log(`  Appreciation: ${results.statistics.appreciation}`);
  console.log(`  Attention: ${results.statistics.attention}`);
  console.log(`  Neutral: ${results.statistics.neutral}`);
  console.log(`  High Confidence: ${results.statistics.highConfidence}`);
  console.log(`  Medium Confidence: ${results.statistics.mediumConfidence}`);
  console.log(`  Low Confidence: ${results.statistics.lowConfidence}`);
  
  return results;
}

module.exports = {
  classifyComment,
  classifyComments,
  scoreWithConfidence
};
