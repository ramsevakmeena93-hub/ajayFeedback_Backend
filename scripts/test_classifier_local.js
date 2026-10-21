// Token loaded from .env — do NOT hardcode here
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { classifyCommentsWithHF } = require('../services/hfClassifierService');

const comments = [
  // Should be NEEDS_ATTENTION
  'need more explanation in class',
  'class notes can be better',
  'speed of teaching sometimes feel fast',
  'can be more interactive',
  'not much interactive',
  'More Real-world examples should be included',
  'notes must be provided early',
  'he should be more loud and clear',
  'He created fear in classroom to ask for doubt',
  'quiz was out of syllabus and marks not justified',
  'please change teaching style',
  'should teach basics first',
  'pacing is a bit fast',
  'better notes should be provided',
  'Teaching less examples',

  // Should be APPRECIATION
  'Best teacher all concepts are crystal clear',
  'very helpful and supportive teacher',
  'The faculty explains concepts clearly',
  'excellent teaching style',
  'Sir is dedicated and patient',
  'Very good overall',
];

classifyCommentsWithHF(comments).then(r => {
  console.log('\n=== APPRECIATION (' + r.appreciation.length + ') ===');
  r.appreciation.forEach(c => console.log('  + ' + c));
  console.log('\n=== NEEDS ATTENTION (' + r.commentsNeedingAttention.length + ') ===');
  r.commentsNeedingAttention.forEach(c => console.log('  ! ' + c));
  console.log('\nStats:', JSON.stringify(r.statistics));
  console.log('API used:', r.statistics.aiClassified > 0 ? 'YES' : 'NO - fallback used');
}).catch(e => console.error('FAIL:', e.message));
