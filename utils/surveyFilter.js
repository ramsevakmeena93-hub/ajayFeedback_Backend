// Helper to identify and reject MITS survey questions and table headers
// These 14 survey questions must NEVER appear in Appreciation or Needs Attention sections

const SURVEY_QUESTION_PATTERNS = [
  // 1. Weekly quiz and fortnightly assignments motivate you to revise and learn better
  /weekly\s+quiz\s+and\s+fortnightly\s+assignments/i,
  /assignments?\s+motivate\s+you\s+to\s+revise/i,
  
  // 2. Demonstrates a consistently positive, supportive, and helpful attitude, while maintaining ethical behaviour and showing no signs of gender bias
  /demonstrates?\s+a\s+consistently\s+positive/i,
  /supportive,?\s+and\s+helpful\s+attitude/i,
  /maintaining\s+ethical\s+behaviou?r/i,
  /gender\s+bias/i,
  
  // 3. The classes are engaged with good preparation
  /classes\s+are\s+engaged\s+with\s+good\s+preparation/i,
  /engaged\s+with\s+good\s+preparation/i,
  
  // 4. Performance in Assignments/Quiz/Minor exams is discussed in class
  /performance\s+in\s+assignments?\/quiz\/minor/i,
  /performance\s+in\s+(?:assignments|quiz|minor)/i,
  /discussed\s+in\s+class/i,
  
  // 5. Overall rating of the course covered so far
  /overall\s+rating\s+of\s+the\s+course/i,
  /course\s+covered\s+so\s+far/i,
  
  // 6. Evaluation/assessment (Minor, Quiz etc.) by the faculty is fair and justified
  /evaluation\/assessment\s*\(minor/i,
  /evaluation\/assessment/i,
  /fair\s+and\s+justified/i,
  
  // 7. Rate the communication skills of the faculty
  /rate\s+the\s+communication\s+skills/i,
  /communication\s+skills\s+of\s+the\s+faculty/i,
  
  // 8. Expected Course Outcomes (CO), Program Outcomes (PO), Programme Specific Outcomes (PSOs) & course competencies are discussed
  /expected\s+course\s+outcomes/i,
  /programme?\s+specific\s+outcomes/i,
  /competencies\s+are\s+discussed/i,
  /\bco\b.*\bpo\b.*\bpso/i,
  
  // 9. Whether MMTLP modes were used by the faculty during teaching-learning sessions
  /whether\s+mmtlp\s+modes\s+were\s+used/i,
  /mmtlp\s+modes/i,
  
  // 10. Additional classes are conducted for remedial purpose
  /additional\s+classes\s+are\s+conducted/i,
  /remedial\s+purpose/i,
  
  // 11. The concepts are cleared by giving examples and applications
  /concepts\s+are\s+cleared\s+by\s+giving\s+examples/i,
  /cleared\s+by\s+giving\s+examples/i,
  
  // 12. The PPTs/Notes are shared in a timely manner
  /ppts?\/notes\s+are\s+shared/i,
  /shared\s+in\s+a\s+timely\s+manner/i,
  
  // 13. Coverage of syllabus/course content is good
  /coverage\s+of\s+syllabus\/course\s+content/i,
  /coverage\s+of\s+syllabus/i,
  
  // 14. Classes are useful and help in identifying strengths and correcting weaknesses
  /classes\s+are\s+useful\s+and\s+help\s+in\s+identifying\s+strengths/i,
  /identifying\s+strengths\s+and\s+(?:correcting|connecting)\s+weaknesses/i,
  
  // Table row headers & summary artifacts
  /^(?:\d{1,2}[\.\s\-]+)?total(?:\s*[:\-]?\s*[\d.]*)?$/i,
  /ffi\s*&\s*suggestions?\s*(?:are\s*noted.*)?/i,
  /noted\s+for\s+further\s+improvement/i,
  /label\s+question/i,
  /\b(?:1\s*-?\s*)?below\s+average\b.*\b(?:average|good|excellent)\b/i,
  /\bqv\b/i
];

function isSurveyQuestionOrHeader(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim();
  if (clean.length < 3) return false;
  return SURVEY_QUESTION_PATTERNS.some(rx => rx.test(clean));
}

module.exports = {
  SURVEY_QUESTION_PATTERNS,
  isSurveyQuestionOrHeader
};
