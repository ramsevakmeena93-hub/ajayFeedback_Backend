/**
 * Test v4 classifier against samples from all 10 categories
 * from the 1000 labeled dataset
 */
const { classifyComments } = require('../services/aiAnalyzer');

// 50 NEEDS_ATTENTION samples from the 1000 (from all 10 categories)
const needsAttentionSamples = [
  // TEACHING_CLARITY
  "Sir, concepts basic se samjhaiye, direct advanced topic par jaane se samajh nahi aata.",
  "With respect, the lecture mostly repeats slides instead of explaining the ideas. Please start with a simple example.",
  "The same confusing explanation is repeated without a simpler alternative.",
  "I appreciate the effort, but important steps are skipped while solving problems.",
  "The main problem is that examples do not match the concept being taught.",
  "Although the topic is important, the connection between topics is not explained.",
  "I am finding it difficult because the explanation leaves several doubts unresolved.",
  "Theory samajh nahi aati kyunki sir examples ke bina slides read karte hain.",
  "Madam examples deti hain lekin steps explain nahi hote, please reasoning bhi samjhaiye.",
  // PACING_AND_TIME
  "Mam, class ki speed bahut fast hai, please thoda slow padhaiye.",
  "The teaching pace is too fast for many students. Please leave time for note-taking.",
  "Too many topics are covered in one class. Please divide difficult topics across more sessions.",
  "The class moves to the next slide before students can understand the current one.",
  "Students are expected to understand lengthy code in very little time.",
  "Ma'am please board par step by step solve kijiye, sirf PPT se samajhna difficult hai.",
  "Topics jaldi-jaldi complete karte hain, important concepts revise nahi hote.",
  "Lab hours bahut kam hain, practice ke liye extra session chahiye.",
  // PRACTICAL_LAB
  "Lab mein sirf code copy karwate hain, khud code likhne aur run karne ka time nahi milta.",
  "Students mostly copy code without understanding it. Please guide students when they get stuck.",
  "The lab is conducted like a theory lecture. Please demonstrate debugging step by step.",
  "The instructor demonstrates code but does not explain how to write it.",
  "Lab mein practical work kam hota hai, zyada hands-on coding karwaiye.",
  "Class mein participation encourage nahi hota, interactive activities add kijiye.",
  // NOTES_AND_MATERIALS
  "Notes time par share nahi hote, exam se pehle revision karna mushkil ho jata hai.",
  "The slides contain too much text and very few diagrams. Please provide concise notes.",
  "Important formulas and definitions are missing from the material.",
  "The notes do not match what is taught in class.",
  "Assignment ki instructions clear nahi hoti, deadline se pehle proper details share kijiye.",
  "Slides mein bahut text hai aur diagrams nahi hain, notes ko concise banaiye.",
  "Assignment ki deadline aur requirements last moment par batayi jaati hain.",
  // DOUBT_SUPPORT
  "Doubt poochne par proper explanation nahi milti, please doubt ke liye alag time rakhiye.",
  "The instructor moves on before checking whether the doubt is resolved.",
  "Students hesitate to ask questions because the classroom feels unapproachable.",
  "Follow-up questions are discouraged. Please offer a regular doubt-clearing session.",
  "Class mein doubts clear karne ke liye time nahi milta.",
  "Notes unit-wise aur easy language mein provide kijiye.",
  "Class ke dauran doubts poochne mein hesitation hota hai, environment comfortable banaiye.",
  // ASSESSMENT_AND_FAIRNESS
  "Quiz mein syllabus se bahar ke questions the, marking scheme bhi clear nahi thi.",
  "The marking scheme is not explained clearly. Please provide clear instructions and examples.",
  "Students are concerned that evaluation is not transparent.",
  "Quiz ke baad answers discuss nahi hote, mistakes samajh nahi aati.",
  "Sir ki awaaz last benches tak clear nahi aati, microphone use kijiye.",
  "Evaluation transparent nahi lagti, please marks ke criteria clearly explain kijiye.",
  // FACILITIES_AND_EQUIPMENT
  "Lab ke computers baar-baar kaam nahi karte, practical complete nahi ho pata.",
  "Computer lab ka internet slow hai aur required software bhi available nahi hai.",
  "Lab systems slow hain aur kai computers working nahi hain, please repair karwaiye.",
  "Evaluation transparent nahi lagti, please marks ke criteria clearly explain kijiye.",
  // COURSE_PLANNING
  "Syllabus quiz se pehle complete nahi hua, please course planning improve kijiye.",
  "Students are not told which topics need extra preparation.",
  // STUDENT_SUPPORT
  "Assignment ki instructions clear nahi hoti, deadline se pehle proper details share kijiye.",
  "Students ko individual guidance kam milti hai, please support improve kijiye.",
  "The classroom interaction sometimes feels disrespectful.",
  "The instructor sometimes responds impatiently to student questions.",
];

// 20 APPRECIATION samples that should NOT go to attention
const appreciationSamples = [
  "Best Teacher",
  "BEST TEACHER FOR CST DEPARTMENT",
  "Sir has excellent command over his subject. He always comes prepared and clears all doubts with real-life examples.",
  "The teacher explains the concepts clearly and makes the subject easy to understand.",
  "Interactive Teaching with Good conceptual Clarity",
  "explanation of concepts are amazing",
  "she teaches very nice.",
  "HE IS SMART AND CHILL",
  "Clears every doubt of student and is interactive.",
  "Sir teaches very well everything is explained properly in the class itself",
  "The course is well covered and the concepts are explained clearly with suitable examples. The faculty is supportive and communication is good.",
  "Makes the Difficult one course into a understandable and Interactive course",
  "bahut badhiya teacher hain",
  "zabardast teaching style",
  "always helpful and very dedicated",
  "learned a lot from this faculty",
  "explains very clearly and patiently",
  "keep it up sir, great job",
  "very knowledgeable and supportive professor",
  "The teacher is very good and clears all doubts patiently",
];

// 10 SKIP samples
const skipSamples = [
  "jbjkkjb", "hvhjv", "na", "ok", "n/a",
  "no comment", "nothing", "no remark needed",
  "overall good", "fine",
];

async function run() {
  const allComments = [...needsAttentionSamples, ...appreciationSamples, ...skipSamples];
  const result = await classifyComments(allComments);

  console.log('\n📊 RESULTS SUMMARY:');
  console.log(`   Attention   : ${result.commentsNeedingAttention.length} (expected ~52)`);
  console.log(`   Appreciation: ${result.appreciation.length} (expected ~20)`);
  console.log(`   Skipped     : ${result.statistics.skipped} (expected ~10)`);
  console.log(`   Neutral     : ${result.statistics.neutral}`);

  // Check: all need-attention samples correctly classified
  let attentionErrors = 0;
  console.log('\n🔍 CHECKING ATTENTION SAMPLES:');
  needsAttentionSamples.forEach(c => {
    const inAttention = result.commentsNeedingAttention.some(r => r === c);
    const inAppreciation = result.appreciation.some(r => r === c);
    if (!inAttention) {
      console.log(`❌ MISSED — should be attention: "${c.substring(0,80)}"`);
      attentionErrors++;
    }
    if (inAppreciation) {
      console.log(`❌ WRONG BUCKET — in appreciation: "${c.substring(0,80)}"`);
      attentionErrors++;
    }
  });

  // Check: appreciation samples NOT in attention
  let appreciationErrors = 0;
  console.log('\n🔍 CHECKING APPRECIATION SAMPLES:');
  appreciationSamples.forEach(c => {
    const inAttention = result.commentsNeedingAttention.some(r => r === c);
    if (inAttention) {
      console.log(`❌ WRONG — appreciation in attention: "${c.substring(0,80)}"`);
      appreciationErrors++;
    }
  });

  console.log('\n═══════════════════════════════════════');
  if (attentionErrors === 0 && appreciationErrors === 0) {
    console.log('🎉 PERFECT — Zero misclassifications!');
  } else {
    console.log(`❌ ${attentionErrors} attention errors, ${appreciationErrors} appreciation errors`);
  }

  const accuracy = ((needsAttentionSamples.length + appreciationSamples.length - attentionErrors - appreciationErrors) /
    (needsAttentionSamples.length + appreciationSamples.length) * 100).toFixed(1);
  console.log(`📈 Accuracy: ${accuracy}%`);
  console.log('═══════════════════════════════════════');
}

run().catch(e => { console.error(e); process.exit(1); });
