const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '..', 'services', 'aiAnalyzer.js');
let code = fs.readFileSync(targetPath, 'utf8');

// 1. Update POSITIVE_OVERRIDE_PATTERNS to handle procedure
code = code.replace(
  /\/\*?\s*not just theory.*?\n\s*\/\s*\\bnot\\s\+just[^\n]+;\s*/i,
  `// "not just theory, actually practice"
  /\\bnot\\s+just\\s+(the\\s+)?(theory|procedure|reading|watching|listening)[,\\s].*(actually|also|but)\\s+(practic|apply|code|hands[\\s-]on|do)\\b/i,
  /\\bexplains?\\s+(the\\s+)?purpose\\s+behind.*?not\\s+just\\s+the\\s+procedure\\b/i,\n];`
);

// Fallback check if needed:
if (!code.includes('not just the procedure')) {
  code = code.replace(
    /\/\\bnot\\s\+just\\s\+\(theory\|reading\|watching\|listening\)\[,\\s\]\.\*\(actually\|also\|but\)\\s\+\(practic\|apply\|code\|hands\[\\s-\]on\|do\)\\b\/i,/g,
    `/\bnot\s+just\s+(the\s+)?(theory|procedure|reading|watching|listening)[,\s].*(actually|also|but)\s+(practic|apply|code|hands[\s-]on|do)\b/i,\n  /\bexplains?\s+(the\s+)?purpose\s+behind.*?not\s+just\s+the\s+procedure\b/i,`
  );
}

// 2. Add NEGATED_PRAISE_PATTERNS to ATTENTION_ISSUE_PHRASES
const negatedPraisePatterns = `
  // ══ NEGATED PRAISE / DEFICIENCY INDICATORS (v6 Negation Safeguard) ═══════
  /\\b(not|never|hardly|rarely|barely|doesn'?t|does\\s+not|don'?t|do\\s+not|isn'?t|is\\s+not|aren'?t|are\\s+not|won'?t|cannot|can'?t|nahi|nahin|nhi)\\s+(very\\s+|really\\s+|that\\s+|much\\s+)?(supportive|helpful|clear|patient|knowledgeable|approachable|dedicated|effective|interactive|engaging|understanding|cooperative|informative|organized|encouraging|friendly|good|nice|fair|polite|respectful|well|properly|clear\\s+doubts?|clearing\\s+doubts?|solve\\s+doubts?|solving\\s+doubts?|explaining|teaching|helping|answering|accha|badhiya|understandable|audible)\\b/i,
  /\\b(not|never|hardly|doesn'?t|does\\s+not|nahi)\\s+(a\\s+)?(good|great|nice|effective|helpful)\\s+(teacher|faculty|professor|sir|ma'?am|teaching|class|lecture|session|explanation)\\b/i,
  /\\b(does\\s+not|doesn'?t|not|never|nahi)\\s+(explain|teach|demonstrate|show|guide|clarify)\\s+.*?\\b(well|properly|clearly|step\\s+by\\s+step|in\\s+detail|concepts?)\\b/i,
  /\\b(does\\s+not|doesn'?t|not|never|nahi)\\s+(clearing|clears?|clear|solve|solving)\\s+(any\\s+|our\\s+)?(doubts?|queries|questions)\\b/i,
  /\\b(does\\s+not|doesn'?t|not|never|rarely|hardly|nahi)\\s+(answers?|answering|respond|responding)\\s+(to\\s+)?(questions?|doubts?|queries)?\\b/i,
  /\\b(does\\s+not|doesn'?t|not|never|nahi)\\s+(help|support|guide|motivate|encourage)\\s+(students?|us|anyone)\\b/i,
  /\\b(does\\s+not|doesn'?t|not|never|nahi)\\s+(give|provide|share)\\s+(any\\s+|enough\\s+|relevant\\s+)?(examples?|notes?|material|time)\\b/i,
  /\\b(not|never|nahi)\\s+(understandable|clear|easy\\s+to\\s+understand|comprehensible|audible|helpful)\\b/i,
`;

code = code.replace(
  'const ATTENTION_ISSUE_PHRASES = [',
  'const ATTENTION_ISSUE_PHRASES = [' + negatedPraisePatterns
);

// 3. Add strict negation check in classifyComments
code = code.replace(
  'const hasPositiveOverride = POSITIVE_OVERRIDE_PATTERNS.some(p => p.test(lower));',
  `const hasPositiveOverride = POSITIVE_OVERRIDE_PATTERNS.some(p => p.test(lower));
    const hasNegation = /\\b(not|never|hardly|rarely|barely|doesn'?t|does\\s+not|don'?t|do\\s+not|isn'?t|is\\s+not|aren'?t|are\\s+not|won'?t|cannot|can'?t|nahi|nahin|nhi)\\b/i.test(lower);`
);

code = code.replace(
  'if (hasOpener || hasIssue || (hasGeneric && !hasPositiveOverride)) {',
  'if (hasOpener || hasIssue || (hasGeneric && !hasPositiveOverride) || (hasNegation && !hasPositiveOverride)) {'
);

code = code.replace(
  ': hasOpener  ? \'attention-opener\'',
  `: hasOpener  ? 'attention-opener'
               : hasGeneric ? 'generic-improvement-request'
               : 'negated-praise-or-complaint'`
);

code = code.replace(
  'if (hasApprec) {',
  'if (hasApprec && !(hasNegation && !hasPositiveOverride)) {'
);

fs.writeFileSync(targetPath, code, 'utf8');
console.log('Successfully patched aiAnalyzer.js with Negation Safeguards!');
