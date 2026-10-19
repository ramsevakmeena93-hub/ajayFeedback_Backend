const fs = require('fs');
const path = require('path');
const { classifyComments } = require('../services/aiAnalyzer');

// Suppress excessive console output
const origLog = console.log;

async function runEvaluation() {
  origLog('════════════════════════════════════════════════════════════════════');
  origLog('           CLASSIFIER v6 COMPREHENSIVE BENCHMARK TEST               ');
  origLog('════════════════════════════════════════════════════════════════════');

  // 1. APPRECIATION 1000
  const apprec1000 = fs.readFileSync(
    path.join(__dirname, '..', 'training_data', 'appreciation_1000.txt'), 'utf8'
  ).split('\n').map(l => l.trim()).filter(Boolean);

  console.log = () => {};
  const apprecResult = await classifyComments(apprec1000);
  console.log = origLog;

  origLog(`\n1. APPRECIATION DATASET (1000 comments):`);
  origLog(`   Received:     ${apprec1000.length}`);
  origLog(`   Appreciation: ${apprecResult.appreciation.length}`);
  origLog(`   Attention:    ${apprecResult.commentsNeedingAttention.length} (Expected 0)`);
  origLog(`   Neutral:      ${apprecResult.statistics.neutral}`);
  const apprecAccuracy = (apprecResult.appreciation.length / apprec1000.length) * 100;
  origLog(`   Accuracy:     ${apprecAccuracy.toFixed(2)}%`);

  // 2. NEED ATTENTION 1000
  const na1000 = fs.readFileSync(
    path.join(__dirname, '..', 'training_data', 'need_attention_1000.txt'), 'utf8'
  ).split('\n').map(l => l.replace(/^NA2-\d+:\s*/i, '').trim()).filter(Boolean);

  console.log = () => {};
  const naResult = await classifyComments(na1000);
  console.log = origLog;

  origLog(`\n2. NEED ATTENTION DATASET (1000 comments):`);
  origLog(`   Received:     ${na1000.length}`);
  origLog(`   Attention:    ${naResult.commentsNeedingAttention.length}`);
  origLog(`   Appreciation: ${naResult.appreciation.length}`);
  origLog(`   Neutral:      ${naResult.statistics.neutral}`);
  const naAccuracy = (naResult.commentsNeedingAttention.length / na1000.length) * 100;
  origLog(`   Accuracy:     ${naAccuracy.toFixed(2)}%`);

  // 3. MIXED COMMENTS 100 (Splitting feature)
  const mixed100 = fs.readFileSync(
    path.join(__dirname, '..', 'training_data', 'mixed_100.txt'), 'utf8'
  ).split('\n').map(l => l.replace(/^MIX-\d+:\s*/i, '').trim()).filter(Boolean);

  console.log = () => {};
  const mixedResult = await classifyComments(mixed100);
  console.log = origLog;

  origLog(`\n3. MIXED COMMENTS SPLITTING (100 comments):`);
  origLog(`   Received:     ${mixed100.length}`);
  origLog(`   Appreciation: ${mixedResult.appreciation.length} (Expected 100 split clauses)`);
  origLog(`   Attention:    ${mixedResult.commentsNeedingAttention.length} (Expected 100 split clauses)`);
  const mixedSplits = mixedResult.classifiedComments.filter(c => c.classification === 'mixed').length;
  origLog(`   Mixed splits: ${mixedSplits} / ${mixed100.length}`);

  // Sample split output
  origLog(`\n   Sample Split Outputs:`);
  mixedResult.classifiedComments.slice(0, 3).forEach((c, i) => {
    origLog(`   [Sample ${i+1}]`);
    origLog(`     Original:     "${c.text}"`);
    if (c.split) {
      origLog(`     Appreciation: "${c.split.appreciation}"`);
      origLog(`     Attention:    "${c.split.attention}"`);
    }
  });

  // 4. TEST_V5 DATASET (Regression check)
  const v5ScriptPath = path.join(__dirname, 'test_v5.js');
  if (fs.existsSync(v5ScriptPath)) {
    origLog(`\n4. REGRESSION CHECK (v5 test suite):`);
    // require test_v5 logic
    const { execSync } = require('child_process');
    try {
      const v5Out = execSync('node backend/scripts/test_v5.js', { encoding: 'utf8' });
      origLog(v5Out.split('\n').slice(-7).join('\n'));
    } catch (e) {
      origLog('v5 run error:', e.message);
    }
  }

  origLog('\n════════════════════════════════════════════════════════════════════');
  const allPassed = apprecResult.appreciation.length === apprec1000.length &&
                    naResult.commentsNeedingAttention.length === na1000.length &&
                    mixedSplits === mixed100.length;
  if (allPassed) {
    origLog('🎉 ALL BENCHMARKS PASSED PERFECTLY WITH 100% ACCURACY! 🎉');
  } else {
    origLog('⚠️ SOME BENCHMARKS NEED ADJUSTMENTS.');
  }
  origLog('════════════════════════════════════════════════════════════════════\n');
}

runEvaluation().catch(err => console.error(err));
