require('dotenv').config({ path: './.env' });
const { classifyComments } = require('./services/improvedClassifier');

// Test comments with known classifications
const testComments = [
  // Should be APPRECIATION
  "Excellent teacher, explains concepts very clearly",
  "Best faculty in the department, very helpful",
  "Teaching style is amazing and easy to understand",
  "Sir explains well and clears all doubts patiently",
  "Very good teaching, all concepts are crystal clear",
  
  // Should be ATTENTION (with "not" negation)
  "Teacher is not clear in explanations",
  "Does not explain concepts properly",
  "Not helpful at all, never answers doubts",
  "Teaching is not good, pace is too fast",
  "Sir is not interactive, class is boring",
  
  // Should be ATTENTION (direct problems)
  "Too fast pace, difficult to follow",
  "Notes are shared very late",
  "Voice is too low, cannot hear properly",
  "Lab sessions are not organized",
  "Doubts are left unanswered",
  
  // Mixed (should split or classify correctly)
  "Teaching is good but pace is too fast",
  "Explains well but notes are not provided on time",
  
  // Neutral
  "ok",
  "fine",
  "average",
  "Everything is good",
];

async function runTest() {
  console.log('========================================');
  console.log('TESTING IMPROVED CLASSIFIER');
  console.log('========================================\n');
  
  console.log(`Testing ${testComments.length} comments...\n`);
  
  const result = await classifyComments(testComments);
  
  console.log('\n========================================');
  console.log('FINAL RESULTS');
  console.log('========================================\n');
  
  console.log('✅ APPRECIATION (' + result.appreciation.length + ' comments):');
  result.appreciation.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c}`);
  });
  
  console.log('\n⚠️  NEEDS ATTENTION (' + result.commentsNeedingAttention.length + ' comments):');
  result.commentsNeedingAttention.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c}`);
  });
  
  console.log('\n📊 STATISTICS:');
  console.log(`  Total: ${result.statistics.total}`);
  console.log(`  Appreciation: ${result.statistics.appreciation}`);
  console.log(`  Attention: ${result.statistics.attention}`);
  console.log(`  Neutral: ${result.statistics.neutral}`);
  console.log(`  High Confidence: ${result.statistics.highConfidence}`);
  console.log(`  Medium Confidence: ${result.statistics.mediumConfidence}`);
  console.log(`  Low Confidence: ${result.statistics.lowConfidence}`);
  
  console.log('\n========================================');
  console.log('Test completed!');
  console.log('========================================');
}

runTest().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
