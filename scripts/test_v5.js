/**
 * Full test for v5 classifier
 * Tests samples from all 3 datasets: v1 (1000), mixed (100), v2 (1000)
 */
const { classifyComments } = require('../services/aiAnalyzer');

// NEEDS_ATTENTION samples covering all new v2 openers + mixed patterns
const needsAttentionSamples = [
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

  // v2 new issue phrases
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
  "Central quiz se pehle syllabus complete nahi hua tha.",

  // 100 MIXED dataset patterns
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
  "The faculty is cooperative, but assignment instructions are often unclear.",
  "The teacher gives useful examples, but they sometimes do not match the topic.",
  "The lectures are informative, but the class moves to the next topic before everyone understands.",
  "The instructor is dedicated, but there is no regular doubt-clearing session.",
  "The course material is useful, but several important topics are missing from the notes.",
  "The teacher is polite, but questions raised during class are sometimes left unanswered.",
  "The lab assignments are relevant, but students are expected to copy code instead of writing it themselves.",
  "The faculty has good subject knowledge, but the marking scheme is not explained clearly.",
  "The teacher is patient, but the teaching pace is too fast for beginners.",
  "The class is well organized, but revision is skipped before major assessments.",
  "The instructor is approachable, but feedback on assignments is not provided.",
  "The subject is valuable, but there are too few lab sessions to practise the concepts.",
  "The teacher explains definitions well, but does not show enough step-by-step solutions.",
  "The faculty is supportive, but the projector display is difficult to read from the back rows.",

  // v2 PACING
  "Problem reported: The teaching pace is too fast to follow.",
  "This issue is affecting learning: Slides change before students can finish taking notes.",
  "Complaint: Too many topics are rushed into one lecture.",
  "Repeated concern: The syllabus is rushed just before assessments.",
  "Learning is being affected. Lengthy code must be written in too little lab time.",
  "Correction required: Important concepts are rushed while minor details take too long.",
  "The teacher moves ahead without checking understanding. Review the teaching plan and make the necessary changes.",
  "Revision is skipped because the lecture runs out of time.",

  // v2 PRACTICAL LAB
  "The lab is conducted like a theory lecture with almost no practical work.",
  "Students copy code without learning how to write it.",
  "Code output is shown without explaining debugging.",
  "There is not enough time to complete lab assignments.",
  "Lab exercises do not match the theory topics.",
  "Students receive little individual guidance during lab work.",
  "The same basic exercise is repeated without increasing difficulty.",
  "Students are told to paste code instead of developing solutions.",

  // v2 NOTES
  "The notes are incomplete and omit syllabus topics.",
  "Study material is shared too late for preparation.",
  "Slides contain too much text and lack diagrams.",
  "The notes are difficult to revise before examinations.",
  "Examples in the material have no explanations.",
  "Shared files are disorganized and difficult to locate.",
  "No practice questions are provided for taught topics.",
  "The slides contain errors that cause confusion.",

  // v2 DOUBT
  "Questions raised during class are ignored.",
  "There is no dedicated time for clearing doubts.",
  "The answer to a question repeats the same unclear explanation.",
  "Students hesitate to ask questions because the class feels intimidating.",
  "The teacher moves on before checking if a doubt is resolved.",
  "Follow-up questions are discouraged during lectures.",
  "Confusing topics are never revisited.",
  "Requests for academic help receive no timely response.",

  // v2 ASSESSMENT
  "Quiz questions include topics that were not covered in class.",
  "The marking scheme is not explained before assessments.",
  "Marks are returned without explaining mistakes.",
  "Assessment instructions are confusing.",
  "The allotted test time is insufficient.",
  "The answer key is not discussed after the quiz.",
  "Evaluation criteria appear inconsistent.",
  "Reported errors in quiz questions are not addressed.",

  // v2 FACILITIES
  "Lab computers frequently stop working. Review the teaching plan and make the necessary changes.",
  "The internet connection interrupts practical work.",
  "Required software is missing from lab computers.",
  "Lab equipment is outdated for assigned tasks.",
  "There are not enough working computers for students.",
  "The projector display is unclear.",
  "Students lose lab time waiting for functioning systems.",
  "Software works differently across lab computers.",

  // v2 COURSE PLANNING
  "The syllabus is not completed before the scheduled assessment.",
  "Advanced topics begin before prerequisites are revised.",
  "There is no revision before major examinations.",
  "Theory and lab schedules are not coordinated.",
  "Important units are left until the end of the semester.",
  "Course objectives are not explained.",
  "There are too few practice sessions before examinations.",
  "Course schedule changes are communicated too late.",
  "The teaching plan leaves too little time for difficult topics.",

  // v2 STUDENT SUPPORT
  "The instructor responds impatiently to student questions.",
  "Students receive unclear guidance when struggling academically.",
  "Assignment requirements change without clear announcement.",
  "Assignment deadlines are announced with little notice.",
  "Classroom interactions sometimes feel disrespectful.",
  "Academic concerns are raised but never followed up.",
  "Students do not know how to contact the instructor for help.",
  "Student feedback is repeatedly ignored.",
  "Submission instructions are incomplete.",
  "Students receive no useful feedback on how to improve.",
];

// Pure appreciation — should NEVER go to attention
const appreciationSamples = [
  "Best Teacher",
  "BEST TEACHER FOR CST DEPARTMENT",
  "Sir has excellent command over his subject. He always comes prepared and clears all doubts with real-life examples.",
  "The teacher explains the concepts clearly and makes the subject easy to understand.",
  "Interactive Teaching with Good conceptual Clarity",
  "she teaches very nice.",
  "HE IS SMART AND CHILL",
  "Clears every doubt of student and is interactive.",
  "Sir teaches very well everything is explained properly in the class itself",
  "The course is well covered and the concepts are explained clearly. The faculty is supportive and communication is good.",
  "Makes the Difficult one course into a understandable and Interactive course",
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

async function run() {
  const allComments = [...needsAttentionSamples, ...appreciationSamples];
  const result = await classifyComments(allComments);

  console.log('\n📊 RESULTS:');
  console.log(`   Attention   : ${result.commentsNeedingAttention.length} (expected ~${needsAttentionSamples.length})`);
  console.log(`   Appreciation: ${result.appreciation.length} (expected ~${appreciationSamples.length})`);
  console.log(`   Neutral     : ${result.statistics.neutral}`);
  console.log(`   Skipped     : ${result.statistics.skipped}`);

  let attentionMissed = 0, appreciationWrong = 0;

  console.log('\n🔍 MISSED ATTENTION SAMPLES:');
  needsAttentionSamples.forEach(c => {
    const item = result.classifiedComments.find(x => x.text === c);
    const inAtt = result.commentsNeedingAttention.some(r => r === c || (item?.split && r === item.split.attention));
    if (!inAtt) { console.log(`❌ MISSED: "${c.substring(0,90)}"`); attentionMissed++; }
  });

  console.log('\n🔍 APPRECIATION IN WRONG BUCKET:');
  appreciationSamples.forEach(c => {
    const inAtt = result.commentsNeedingAttention.some(r => r === c);
    if (inAtt) { console.log(`❌ WRONG — appreciation in attention: "${c.substring(0,80)}"`); appreciationWrong++; }
  });

  const total = needsAttentionSamples.length + appreciationSamples.length;
  const correct = total - attentionMissed - appreciationWrong;
  const accuracy = ((correct / total) * 100).toFixed(1);

  console.log('\n═══════════════════════════════════════');
  if (attentionMissed === 0 && appreciationWrong === 0) {
    console.log('🎉 PERFECT — Zero misclassifications!');
  } else {
    console.log(`⚠️  ${attentionMissed} attention errors, ${appreciationWrong} appreciation errors`);
  }
  console.log(`📈 Accuracy: ${accuracy}% (${correct}/${total})`);
  console.log('═══════════════════════════════════════');
}

run().catch(e => { console.error(e); process.exit(1); });
