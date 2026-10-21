// Edge cases & resilience test
const { classifyCommentsWithHF } = require('../services/hfClassifierService');

async function testEdgeCases() {
  console.log('Testing Edge Cases & Zero Comment Drop Guarantee...\n');

  const testInputs = [
    'Sir explains every concept clearly and makes difficult topics easy to understand.', // Appreciation
    'Sir concepts basic se explain nahi karte, direct advanced topic shuru kar dete hain.', // Attention
    'The teacher explains concepts well, but the lecture pace is too fast to follow.',      // Mixed
    'ok',                                                                                  // Neutral filler
    'fine',                                                                                // Neutral filler
    '',                                                                                    // Empty (skipped)
    'ab',                                                                                  // Too short (skipped)
    null,                                                                                  // Invalid (skipped)
    'Sir is a very great teacher and very helpful in solving all doubts.',                  // Appreciation
    'NA2-0015: This needs attention: Explanations are unclear and leave students confused.', // Attention
    'Sir is a very great teacher and very helpful in solving all doubts.'                   // Duplicate appreciation
  ];

  console.log(`Input comments count: ${testInputs.length}`);
  const result = await classifyCommentsWithHF(testInputs, { forceFallback: true });

  const expectedTotalEntries = testInputs.length + result.statistics.mixedCommentsSplit;
  console.log(`Output classifiedComments count: ${result.classifiedComments.length} (Expected: ${expectedTotalEntries} = ${testInputs.length} inputs + ${result.statistics.mixedCommentsSplit} split parts)`);
  console.log(`Match: ${expectedTotalEntries === result.classifiedComments.length ? '✅ PASSED' : '❌ FAILED'}`);

  console.log('\nStatistics:', JSON.stringify(result.statistics, null, 2));

  console.log('\nPer-comment breakdown:');
  result.classifiedComments.forEach((c, idx) => {
    console.log(`[${idx + 1}] text: "${c.text}" | class: ${c.classification} | method: ${c.method} | status: ${c.status} | category: ${c.category}`);
  });

  if (result.classifiedComments.length !== expectedTotalEntries) {
    throw new Error('Comment count mismatch! Some comments were dropped.');
  }

  // Also verify that 'ab' was marked skipped as too-short
  const abEntry = result.classifiedComments.find(c => c.sourceText === 'ab');
  if (!abEntry || abEntry.classification !== 'skipped') {
    throw new Error('Expected "ab" to be skipped as too short!');
  }

  console.log('\n✅ All edge cases verified successfully.');
}

testEdgeCases().catch(e => {
  console.error('Edge case test failed:', e);
  process.exit(1);
});
