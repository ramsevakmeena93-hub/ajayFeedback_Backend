const { analyzeCommentsWithAI } = require('../services/aiAnalyzer');

async function testSpeed() {
  const sampleComments = [
    "Very good teaching and nice explanation",
    "Please improve teaching speed and give notes",
    "Excellent professor",
    "Doubt solving is not good",
    "Class is interactive and punctual",
    "Bahut accha padhate hai",
    "Syllabus is too vast",
    "Good teaching sir",
    "Overall satisfied",
    "Voice is very low"
  ];

  const start = Date.now();
  const res = await analyzeCommentsWithAI(sampleComments);
  const duration = Date.now() - start;

  console.log(`[Benchmark] Analyzed ${sampleComments.length} comments in ${duration}ms!`);
  console.log('Appreciation:', res.appreciation.length);
  console.log('Attention:', res.commentsNeedingAttention.length);
}

testSpeed();
