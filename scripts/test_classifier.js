/**
 * Test the new v3 classifier against real student comments from production DB
 */
const { classifyComments } = require('../services/aiAnalyzer');

const testComments = [
  // Should be ATTENTION
  "More Real-world examples should be included to make the concepts easier to understand.",
  "The Software Engineering notes contain quite a lot of content. Could you please keep the notes concise and easy to understand It would also be helpful if the PPT included relevant diagrams, flowcharts, and other visuals wherever possible.",
  "Since Software Engineering is a theoretical subject, it would be really helpful if the topics were explained in a more unique and engaging way.",
  "More time for hands-on practice and additional real-world problem statements would help us understand the algorithms better.",
  "should explain students how to write code (such as merge sort etc., which has very long code) in the lab, students just copy paste and learn nothing new.",
  "The practical sessions are useful, but some experiments could be explained more clearly. More hands-on SQL practice, real-world database examples, and better guidance during lab work would make the sessions more effective.",
  "A little more time for hands-on practice would make the sessions even better.",
  "Teaches good but the notes and study material can be improved",
  "everything is great from your side prr hame hi samajh nhi aata kuch bhi",
  "sahi hai teacher,but numerical part aur acche se krayo",
  "sir teaches at a quick pace so things goes out of head easily. I think this subject must be taught slowly and clearly",
  "good but needs to be improve",
  "needs improvement",
  "if possible, please change the faculty of computer networks",
  "very partial with marks , pls dont assign her again.. ( respectfully)",
  "lab are not interactive ,no discussion on problem solutions",
  "New concepts should be explained from the basics with simple example for better understanding.",
  "Good but Concept delivery can be improved",
  "Some topics could be explained with more practical examples and problem-solving exercises.",
  "sir please give enough time to prepare a lab assignment in every lab because many times upload a assignment to face network issue",

  // Should be APPRECIATION
  "Overall everything is perfect",
  "Best Teacher",
  "Sir has excellent command over his subject. He always comes prepared and clears all doubts with real-life examples. His classes are very informative.",
  "faculty teaching way is good ,they focus on understanding of each concept .",
  "Clears every doubt of student and is interactive.",
  "Sir teaches very well everything is explained properly in the class itself",
  "The course is well covered and the concepts are explained clearly with suitable examples. The faculty is supportive and communication is good. Overall, the course is useful and satisfactory.",
  "Interactive Teaching with Good conceptual Clarity",
  "BEST TEACHER FOR CST DEPARTMENT",
  "The teacher explains the concepts clearly and makes the subject easy to understand. The teacher is supportive, helpful, and clears doubts patiently.",
  "explanation of concepts are amazing",
  "HE IS SMART AND CHILL",
  "she teaches very nice.",

  // Should be SKIPPED
  "jbjkkjb",
  "hvhjv",
  "no remark needed",
  "Everything is fine",
  "overall good",
  "ok",
  "na",
];

async function run() {
  const result = await classifyComments(testComments);

  console.log('\n✅ ATTENTION (should have 20 items):');
  result.commentsNeedingAttention.forEach((c, i) => console.log(`  ${i+1}. "${c}"`));

  console.log('\n✅ APPRECIATION (should have 13 items):');
  result.appreciation.forEach((c, i) => console.log(`  ${i+1}. "${c}"`));

  console.log('\n📊 STATS:', result.statistics);

  // Check for wrong classifications
  console.log('\n🔍 CHECKING FOR MISCLASSIFICATIONS...');
  const shouldBeAttention = [
    "More Real-world examples should be included",
    "Could you please keep the notes concise",
    "it would be really helpful if the topics were explained",
    "students just copy paste and learn nothing new",
    "sahi hai teacher,but numerical part",
    "hame hi samajh nhi aata",
    "please change the faculty",
  ];

  let errors = 0;
  shouldBeAttention.forEach(fragment => {
    const inAppreciation = result.appreciation.some(c => c.toLowerCase().includes(fragment.toLowerCase()));
    if (inAppreciation) {
      console.log(`❌ WRONG — in appreciation but should be attention: "${fragment}"`);
      errors++;
    } else {
      const inAttention = result.commentsNeedingAttention.some(c => c.toLowerCase().includes(fragment.toLowerCase()));
      if (inAttention) console.log(`✅ CORRECT — in attention: "${fragment.substring(0,50)}..."`);
      else console.log(`⚠️  NOT FOUND anywhere: "${fragment.substring(0,50)}"`);
    }
  });

  if (errors === 0) console.log('\n🎉 All key comments correctly classified!');
  else console.log(`\n❌ ${errors} misclassification(s) found`);
}

run().catch(e => { console.error(e); process.exit(1); });
