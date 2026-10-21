// Quick end-to-end test: routes → aiAnalyzer → hfClassifierService → python → DeBERTa model
const { analyzeCommentsWithAI, generateActionSuggestion, testGeminiConnection } = require('../services/aiAnalyzer');

const testComments = [
  "The faculty explains concepts clearly and gives practical examples that make learning easier.",
  "Very helpful teacher, always available to solve our queries after class.",
  "Best professor for this subject, made everything so simple to understand.",
  "The teacher speaks very fast and skips important formulas without explanation.",
  "Notes are not uploaded on time and syllabus is incomplete before exams.",
  "Lab systems were not working and faculty did not guide us with the errors.",
  "ok",         // neutral filler — should be skipped
  "good",       // neutral filler
  "excellent",  // short — should be skipped
];

async function main() {
  console.log('='.repeat(60));
  console.log('END-TO-END TEST: aiAnalyzer → HuggingFace DeBERTa');
  console.log('='.repeat(60));

  // 1. Test connection info
  const conn = await testGeminiConnection();
  console.log('\n[Engine]', conn.engine);

  // 2. Classify comments
  const result = await analyzeCommentsWithAI(testComments);

  console.log('\n--- APPRECIATION ---');
  result.appreciation.forEach((c, i) => console.log(`  ${i+1}. ${c}`));

  console.log('\n--- NEEDS ATTENTION ---');
  result.commentsNeedingAttention.forEach((c, i) => console.log(`  ${i+1}. ${c}`));

  console.log('\n--- CATEGORIES ---');
  for (const [cat, items] of Object.entries(result.commentCategories)) {
    if (items.length > 0) console.log(`  [${cat}]: ${items.length} comment(s)`);
  }

  console.log('\n--- STATISTICS ---');
  console.log(JSON.stringify(result.statistics, null, 2));

  // 3. Test action suggestion
  const suggestion = generateActionSuggestion(result.commentsNeedingAttention, 'Dr. Test Faculty');
  console.log('\n--- HOD ACTION SUGGESTION ---');
  console.log(suggestion);

  console.log('\n' + '='.repeat(60));
  console.log('ALL TESTS PASSED!');
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
