/**
 * Test current v5 classifier against the 1000 new appreciation comments
 * to find misclassifications
 */
const { classifyComments } = require('../services/aiAnalyzer');
const fs = require('fs');
const path = require('path');

async function run() {
  const raw = fs.readFileSync(
    path.join(__dirname, '..', 'training_data', 'appreciation_1000.txt'), 'utf8'
  );
  const comments = raw.split('\n').map(l => l.trim()).filter(Boolean);
  
  console.log(`\nLoaded ${comments.length} appreciation comments`);
  
  const result = await classifyComments(comments);
  
  console.log('\n📊 CLASSIFICATION RESULTS:');
  console.log(`   Total          : ${comments.length}`);
  console.log(`   Appreciation ✅: ${result.appreciation.length}`);
  console.log(`   Attention ❌   : ${result.commentsNeedingAttention.length}`);
  console.log(`   Neutral        : ${result.statistics.neutral}`);
  console.log(`   Skipped        : ${result.statistics.skipped}`);
  
  const accuracy = ((result.appreciation.length / comments.length) * 100).toFixed(1);
  console.log(`\n📈 Appreciation Accuracy: ${accuracy}%`);
  
  if (result.commentsNeedingAttention.length > 0) {
    console.log('\n❌ MISCLASSIFIED AS ATTENTION (these should be appreciation):');
    result.commentsNeedingAttention.forEach((c, i) => {
      // Find why it was classified as attention
      const classified = result.classifiedComments.find(cc => cc.text === c);
      console.log(`  ${i+1}. "${c.substring(0,100)}..."`);
      if (classified) console.log(`     Reason: ${classified.reason}`);
    });
  }
  
  if (result.statistics.neutral > 0) {
    console.log('\n⚠️  CLASSIFIED AS NEUTRAL (not appreciation):');
    result.classifiedComments
      .filter(c => c.classification === 'neutral')
      .forEach((c, i) => {
        console.log(`  ${i+1}. "${c.text.substring(0,100)}..."`);
      });
  }
  
  if (result.statistics.skipped > 0) {
    console.log('\n🗑️  SKIPPED:');
    result.classifiedComments
      .filter(c => c.classification === 'skipped' || c.classification === 'neutral' && c.reason === 'neutral-filler')
      .forEach((c, i) => {
        console.log(`  ${i+1}. "${c.text.substring(0,80)}"`);
      });
  }
}

run().catch(e => { console.error(e); process.exit(1); });
