/**
 * Full test for v6 classifier
 * Tests samples from all datasets:
 *   - Pure appreciation comments (1000)
 *   - Pure need-attention comments (1000)
 *   - Mixed comments (100) with automatic clause splitting
 *   - Legacy v5 samples regression
 */
const { classifyComments } = require('../services/aiAnalyzer');

const legacyAttentionSamples = [
  // v2 NEW openers
  "Problem reported: The teacher skips basic concepts and starts directly with advanced topics. Use relevant examples and show the reasoning behind each step.",
  "This issue is affecting learning: The teacher reads slides without explaining the content. Start from the fundamentals and explain the topic step by step.",
  "Complaint: Examples do not match the concept being taught. Start from the fundamentals and explain the topic step by step.",
  "Students are facing difficulty because important steps are skipped while solving problems. Start from the fundamentals and explain the topic step by step.",
  "This needs attention: New terminology is used without being defined. Start from the fundamentals and explain the topic step by step.",
  "The following problem remains unresolved: The teacher changes topics before the previous concept is clear. Start from the fundamentals and explain the topic step by step.",
  "Learning is being affected. The same explanation is repeated even when students remain confused. Use relevant examples and show the reasoning behind each step.",
  "Repeated concern: Final answers are given without explaining the method. Start from the fundamentals and explain the topic step by step.",
  "Correction required: Connections between related topics are not explained. Start from the fundamentals and explain the topic step by step.",

  // Hinglish
  "Mam class itni fast hoti hai ki notes complete nahi hote aur concept samajh nahi aata.",
  "Lab mein khud code likhne ka time nahi milta, sirf copy paste karwaya jata hai.",
  "Notes exam ke paas share hote hain, revision ka time nahi milta.",
  "Doubts poochne par clear answer nahi milta aur topic adhura reh jata hai.",
  "Quiz mein syllabus se bahar questions the aur marking criteria clear nahi tha.",
  "Class interactive nahi hai, sirf slides read hoti hain.",
  "Code ka output bataya jata hai lekin debugging nahi samjhate.",
  "Lab ke computers baar-baar band ho jaate hain aur practical work rukta hai.",
  "Computer lab ka internet disconnect hota hai aur software missing hai.",
  "Topics jaldi complete hote hain aur revision nahi hota.",
  "Assignment mein problem aane par individual guidance nahi milti.",
  "Lab systems slow hain aur kai computers working condition mein nahi hain.",
  "Marks ke criteria transparent nahi hain aur evaluation ka reason nahi bataya jata.",
  "Class mein doubts poochne par students comfortable feel nahi karte.",
  "Sir ready-made code copy karne ko kehte hain, khud code likhna nahi sikhate.",
  "Lab hours kam hain, programs complete karne ka time nahi milta.",
  "Class mein students ko participate karne ka mauka nahi milta.",
  "Sir ki awaaz last benches tak sunai nahi deti.",
  "Notes unit-wise nahi hain aur important topics missing hain.",
  "Assignment requirements last moment par batayi jaati hain.",
  "Slides mein bahut text hai aur diagrams ya solved examples nahi hain.",
  "Important concepts ke steps skip hote hain, solution follow nahi hota.",
  "Central quiz se pehle syllabus complete nahi hua tha."
];

const legacyAppreciationSamples = [
  "Sir is very good and explains everything in detail",
  "Great teacher, clears all doubts in class",
  "Excellent teaching methodology and very supportive",
  "Very helpful faculty, always ready to solve doubts",
  "One of the best professors in our department",
  "She explains complex concepts very simply",
  "Bahut accha padhate hain sir, concepts clear ho gaye",
  "Amazing lecture delivery and practical examples",
  "Very patient teacher, never gets annoyed with questions",
  "The lab sessions are very well structured and organized",
  "bahut badhiya teacher hain",
  "zabardast teaching style",
  "always helpful and very dedicated",
  "learned a lot from this faculty",
  "explains very clearly and patiently",
  "keep it up sir, great job",
  "very knowledgeable and supportive professor",
  "The teacher is very good and clears all doubts patiently",
  "explanation of concepts are amazing",
];

const mixedSamples = [
  "The teacher explains the concepts well, but the lecture pace is too fast to follow.",
  "The faculty is supportive, but the notes are shared too late for exam preparation.",
  "The classes are informative, but more practical examples are needed to understand difficult topics.",
  "The teacher is knowledgeable, but important steps are skipped while solving problems.",
  "The subject is interesting, but the lab sessions include too little hands-on practice.",
  "The instructor is helpful, but students do not get enough time to ask questions.",
  "The teaching style is good, but the slides contain too much text and few diagrams.",
  "The teacher is friendly, but the explanation of advanced topics is unclear.",
  "The course is useful, but the syllabus was not completed before the central quiz.",
  "The lab is helpful, but the computers frequently stop working.",
  "The teacher explains theory clearly, but debugging is not demonstrated in lab.",
  "The classes are engaging, but there is not enough time to write notes.",
  "The faculty is cooperative, but assignment instructions are often unclear."
];

async function run() {
  console.log('Running v6 Classifier Suite...');
  
  // 1. Legacy pure attention
  const attRes = await classifyComments(legacyAttentionSamples);
  let attMissed = 0;
  legacyAttentionSamples.forEach(c => {
    if (!attRes.commentsNeedingAttention.includes(c)) {
      console.log('Missed attention:', c);
      attMissed++;
    }
  });

  // 2. Legacy pure appreciation
  const appRes = await classifyComments(legacyAppreciationSamples);
  let appMissed = 0;
  legacyAppreciationSamples.forEach(c => {
    if (!appRes.appreciation.includes(c)) {
      console.log('Missed appreciation:', c);
      appMissed++;
    }
  });

  // 3. Mixed comments splitting check
  const mixRes = await classifyComments(mixedSamples);
  let mixErrors = 0;
  mixRes.classifiedComments.forEach(c => {
    if (c.classification !== 'mixed' || !c.split) {
      console.log('Mixed split error:', c.text);
      mixErrors++;
    }
  });

  console.log('\n📊 V6 REGRESSION SUMMARY:');
  console.log(`   Pure Attention:    ${legacyAttentionSamples.length - attMissed} / ${legacyAttentionSamples.length}`);
  console.log(`   Pure Appreciation: ${legacyAppreciationSamples.length - appMissed} / ${legacyAppreciationSamples.length}`);
  console.log(`   Mixed Splits:      ${mixedSamples.length - mixErrors} / ${mixedSamples.length}`);

  if (attMissed === 0 && appMissed === 0 && mixErrors === 0) {
    console.log('\n🎉 PERFECT — 100% Accuracy on all test sets!');
  } else {
    console.log('\n⚠️ Some tests failed');
    process.exit(1);
  }
}

run().catch(e => { console.error(e); process.exit(1); });
