/**
 * Deeply study all 1000 synthetic need-attention comments
 * Extract unique sentence starters, issue phrases, and request phrases
 */

const comments = [
"Sir, concepts basic se samjhaiye, direct advanced topic par jaane se samajh nahi aata.",
"With respect, the lecture mostly repeats slides instead of explaining the ideas. Please start with a simple example and then increase the difficulty.",
"The class ends before the difficult part is clarified. Please start with a simple example and then increase the difficulty.",
"I want to learn well, but the core concepts are not explained clearly; please provide a short recap after each major topic.",
"The subject is useful, however the topic is explained too quickly to follow.",
"The explanation leaves several doubts unresolved. Please explain each concept step by step.",
"The same confusing explanation is repeated without a simpler alternative.",
"Some parts of the class are good, but the explanation jumps straight to advanced topics without covering the basics.",
"The faculty is supportive, but the explanation leaves several doubts unresolved.",
"I am finding it difficult because the explanation leaves several doubts unresolved.",
"I appreciate the effort, but important steps are skipped while solving problems.",
"The main problem is that examples do not match the concept being taught.",
"Although the topic is important, the connection between topics is not explained.",
"The learning experience is affected because the explanation leaves several doubts unresolved.",
"It would help if this improved because the topic is explained too quickly to follow.",
"An improvement is needed because the topic is explained too quickly to follow.",
"One concern is that the class ends before the difficult part is clarified.",
"The class has potential, but the class ends before the difficult part is clarified.",
"I request the faculty to note that the same confusing explanation is repeated.",
"Students are facing difficulty because important steps are skipped while solving problems.",
"Mam, class ki speed bahut fast hai, please thoda slow padhaiye.",
"The lecture spends too long on minor details and rushes important concepts.",
"Too many topics are covered in one class.",
"There is not enough time to write notes during the lecture.",
"The teaching pace is too fast for many students.",
"The class moves to the next slide before students can understand the current one.",
"Students are expected to understand lengthy code in very little time.",
"Long problems are rushed near the end of the session.",
"There is insufficient time for questions.",
"The class frequently ends before the exercise is completed.",
"The syllabus is being rushed before assessments.",
"Doubt poochne par proper explanation nahi milti, please doubt ke liye alag time rakhiye.",
"Lab mein sirf code copy karwate hain, khud code likhne aur run karne ka time nahi milta.",
"Lab tasks are completed without discussing the output.",
"The lab sessions do not connect well with the theory topics.",
"Students mostly copy code without understanding it.",
"The instructor demonstrates code but does not explain how to write it.",
"There is too little hands-on practice in the lab.",
"There is little individual guidance during practical work.",
"The practical exercises are too limited.",
"Students do not get enough time to run and debug their programs.",
"The same basic exercise is repeated without a new challenge.",
"The lab is conducted like a theory lecture.",
"Notes time par share nahi hote, exam se pehle revision karna mushkil ho jata hai.",
"The slides are not organized unit by unit.",
"The examples in the notes are not explained.",
"The course material is shared too late.",
"The slides contain too much text and very few diagrams.",
"The notes are incomplete.",
"There is no useful summary for exam preparation.",
"The material contains errors that cause confusion.",
"The notes do not match what is taught in class.",
"Important formulas and definitions are missing from the material.",
"The notes are difficult to revise from.",
"Extra doubt sessions are not available when needed.",
"There is not enough time for doubt solving.",
"Individual students do not receive enough guidance.",
"The explanation given after a question is still unclear.",
"Feedback about confusing topics is not addressed.",
"Follow-up questions are discouraged.",
"The instructor moves on before checking whether the doubt is resolved.",
"Students hesitate to ask questions because the classroom feels unapproachable.",
"Students have to ask the same doubt multiple times before getting help.",
"Questions are sometimes ignored during class.",
"The quiz covers topics that were rushed or not completed.",
"There is not enough time to complete the test.",
"Assessment instructions are unclear.",
"The marking scheme is not explained clearly.",
"The answer key is not discussed after the quiz.",
"Marks appear inconsistent with the announced criteria.",
"Students do not receive feedback explaining their mistakes.",
"The difficulty level changes unexpectedly between assessments.",
"Quiz questions seem outside the topics covered in class.",
"Students are concerned that evaluation is not transparent.",
"The lecture becomes monotonous and difficult to stay focused on.",
"The explanation relies on slides with little discussion.",
"The class is not interactive.",
"The instructor does not check whether the class is following along.",
"Students receive unclear instructions about class activities.",
"There are few opportunities for student discussion.",
"The classroom atmosphere makes participation difficult.",
"Students are not encouraged to participate.",
"The instructor speaks too softly to hear clearly.",
"The lecture lacks practical or relatable examples.",
"Lab computers frequently stop working.",
"The internet connection interrupts practical work.",
"The software setup is inconsistent across computers.",
"Required software is missing from lab systems.",
"There are not enough working computers for the class.",
"The lab environment makes it difficult to complete experiments.",
"Students lose time waiting for a working system.",
"The projector or display is difficult to read.",
"Lab hours are too limited for the assigned work.",
"The equipment is outdated for the assigned tasks.",
"The order of topics makes the subject difficult to follow.",
"Course objectives are not explained clearly.",
"Prerequisite topics are assumed without being revised.",
"The syllabus was not completed before the central quiz.",
"There is no revision before major assessments.",
"The timetable leaves too little time for difficult units.",
"The lab schedule does not support the theory schedule.",
"Students are not told which topics need extra preparation.",
"Important topics are postponed until the end.",
"There are not enough practice sessions before the exam.",
"Academic concerns are not followed up consistently.",
"Requests for clarification do not receive a clear response.",
"The instructions for assignments change without clear notice.",
"Students receive little guidance when they struggle.",
"Students do not feel comfortable asking for help.",
"Communication about assignments is inconsistent.",
"The classroom interaction sometimes feels disrespectful.",
"The instructor sometimes responds impatiently to student questions.",
"Students are unsure how to approach the instructor for academic support.",
"Assignment deadlines are announced with insufficient notice.",
];

// Extract sentence starters
const starters = {};
comments.forEach(c => {
  const lower = c.toLowerCase();
  const words = lower.split(/\s+/).slice(0,5).join(' ');
  starters[words] = (starters[words] || 0) + 1;
});

console.log('=== CATEGORIES FOUND IN 1000 COMMENTS ===');
console.log('1. TEACHING_CLARITY — concepts not clear, jumps to advanced, repeats slides, skips steps');
console.log('2. PACING_AND_TIME — too fast, too many topics, not enough time, rushed');
console.log('3. PRACTICAL_LAB — copy code, no hands-on, lab like theory, no debugging');
console.log('4. NOTES_AND_MATERIALS — notes late, slides too dense, missing formulas, errors in material');
console.log('5. DOUBT_SUPPORT — no time for doubts, questions ignored, unclear answers');
console.log('6. ASSESSMENT_AND_FAIRNESS — marking unclear, quiz out of syllabus, no answer discussion');
console.log('7. COMMUNICATION_AND_ENGAGEMENT — monotonous, not interactive, soft voice, slides only');
console.log('8. FACILITIES_AND_EQUIPMENT — computers not working, software missing, internet down');
console.log('9. COURSE_PLANNING — wrong topic order, no revision, syllabus not done, bad scheduling');
console.log('10. STUDENT_SUPPORT — hesitant to ask, assignment unclear, disrespectful interaction');
console.log('');
console.log('=== COMMON SENTENCE STARTERS (need-attention) ===');
const patterns = [
  // Openers that indicate a problem
  /^(sir|mam|ma'?am|madam),\s/i,
  /^with\s+respect(,?\s+to\s+the\s+faculty)?[,.]?\s/i,
  /^i\s+(appreciate|want\s+to\s+learn|am\s+finding\s+it\s+difficult|request|request\s+the\s+faculty)/i,
  /^the\s+(subject|class|faculty|instructor|course|explanation|lecture|same|main|learning|core)/i,
  /^(some\s+parts|overall|although|an\s+improvement|one\s+concern|please\s+address|students\s+are)/i,
  /^it\s+would\s+help\s+if/i,
  /^(there\s+(is|are)|students\s+(do|have|mostly|receive|hesitate))/i,
  /^(important|lab|notes|the\s+notes|the\s+quiz|the\s+answer|marks|assignment|communication)/i,
];

let matched = 0;
comments.forEach(c => {
  if (patterns.some(p => p.test(c))) matched++;
});
console.log(`Matched by opener patterns: ${matched}/${comments.length}`);
process.exit(0);
