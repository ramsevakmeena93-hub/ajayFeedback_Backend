/**
 * Seed 10 demo faculty reports + 1 submission for Pro-VC panel
 * Uses real HODs from the production DB
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose     = require('mongoose');
const User         = require('../models/User');
const FacultyReport = require('../models/FacultyReport');
const Submission   = require('../models/Submission');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/faculty_feedback';

const DEMO_REPORTS = [
  {
    facultyName: 'Dr. Anita Verma',
    subjectCode: 'CS301',
    programme: 'Data Structures & Algorithms',
    branch: 'CST', section: 'A', semester: '3',
    ffiScore: 4.12,
    responseCount: 58,
    appreciation: [
      'Sir explains concepts with real-world examples very clearly.',
      'Very interactive class, all doubts cleared patiently.',
      'Best teacher for DSA in the department.',
    ],
    commentsNeedingAttention: [
      'More practice problems should be given before exams.',
      'Teaching pace is sometimes too fast for complex topics.',
    ],
    actionTaken: '1. Advised to provide additional practice sheets before assessments.\n2. Directed to slow down pace during complex algorithm topics.',
    hodRemarks: 'Faculty performing well. Minor improvements needed.',
    commentPercentages: { Excellent: 40, 'Very Good': 35, Good: 25 },
  },
  {
    facultyName: 'Prof. Rakesh Gupta',
    subjectCode: 'IT401',
    programme: 'Artificial Intelligence',
    branch: 'IT', section: 'B', semester: '4',
    ffiScore: 3.85,
    responseCount: 45,
    appreciation: [
      'Good subject knowledge and very supportive.',
      'Explains AI concepts with practical demos.',
    ],
    commentsNeedingAttention: [
      'Notes are not uploaded on time before class.',
      'Lab sessions need more hands-on coding practice.',
      'Doubt clearing sessions should be more frequent.',
    ],
    actionTaken: '1. Instructed to upload notes at least 2 days before class.\n2. Directed to restructure lab so students write code independently.',
    hodRemarks: 'Improvement needed in material sharing.',
    commentPercentages: { Excellent: 30, 'Very Good': 40, Good: 30 },
  },
  {
    facultyName: 'Dr. Priya Sharma',
    subjectCode: 'CS205',
    programme: 'Object Oriented Programming',
    branch: 'CST', section: 'C', semester: '2',
    ffiScore: 4.45,
    responseCount: 62,
    appreciation: [
      'Excellent teaching style, concepts explained from basics.',
      'Very well organized lectures with good examples.',
      'Best OOP faculty, patient and knowledgeable.',
      'Always available for doubts.',
    ],
    commentsNeedingAttention: [
      'Slides have too much text, need more diagrams.',
    ],
    actionTaken: '1. Advised to include more visual diagrams in slide presentations.',
    hodRemarks: 'Outstanding performance. Minor UI improvement in slides.',
    commentPercentages: { Excellent: 55, 'Very Good': 30, Good: 15 },
  },
  {
    facultyName: 'Mr. Anish P. Jacob',
    subjectCode: 'CH301',
    programme: 'Chemical Process Engineering',
    branch: 'Chemical', section: 'A', semester: '3',
    ffiScore: 3.60,
    responseCount: 38,
    appreciation: [
      'Good knowledge of subject.',
      'Explains chemical processes with industrial examples.',
    ],
    commentsNeedingAttention: [
      'Teaching pace is too fast, difficult to take notes.',
      'Quiz questions were outside the taught syllabus.',
      'Answer key not discussed after quiz.',
    ],
    actionTaken: '1. Counselled to moderate teaching pace.\n2. Reminded to align quiz questions strictly with taught content.\n3. Asked to discuss answer keys after every assessment.',
    hodRemarks: 'Needs improvement in assessment practices.',
    commentPercentages: { Excellent: 20, 'Very Good': 45, Good: 35 },
  },
  {
    facultyName: 'Dr. Laxmi Shrivastava',
    subjectCode: 'EC401',
    programme: 'Digital Signal Processing',
    branch: 'ECE', section: 'A', semester: '4',
    ffiScore: 4.20,
    responseCount: 50,
    appreciation: [
      'Very clear explanation of DSP concepts.',
      'Highly knowledgeable and dedicated faculty.',
      'Interactive teaching with good examples.',
    ],
    commentsNeedingAttention: [
      'More solved examples needed in study material.',
    ],
    actionTaken: '1. Instructed to include more solved examples in distributed notes.',
    hodRemarks: 'Excellent faculty. Minor material improvement suggested.',
    commentPercentages: { Excellent: 48, 'Very Good': 32, Good: 20 },
  },
  {
    facultyName: 'Dr. Pratesh Jayaswal',
    subjectCode: 'ME301',
    programme: 'Thermodynamics',
    branch: 'Mechanical', section: 'A', semester: '3',
    ffiScore: 4.05,
    responseCount: 55,
    appreciation: [
      'Explains thermodynamics concepts with real-world examples.',
      'Very patient and supportive during doubts.',
      'Well structured lectures.',
    ],
    commentsNeedingAttention: [
      'Lab sessions need more hands-on experiments.',
      'Revision before exam would be helpful.',
    ],
    actionTaken: '1. Directed to increase hands-on experiments in lab.\n2. Advised to schedule revision sessions before assessments.',
    hodRemarks: 'Good performance. Lab improvement needed.',
    commentPercentages: { Excellent: 42, 'Very Good': 38, Good: 20 },
  },
  {
    facultyName: 'Dr. Sanjay Tiwari',
    subjectCode: 'CE201',
    programme: 'Structural Analysis',
    branch: 'Civil', section: 'B', semester: '2',
    ffiScore: 3.75,
    responseCount: 42,
    appreciation: [
      'Good conceptual clarity.',
      'Supportive and approachable.',
    ],
    commentsNeedingAttention: [
      'Class is not interactive enough.',
      'Real world examples rarely used.',
      'Students hesitate to ask questions during class.',
    ],
    actionTaken: '1. Recommended to use real construction case studies in lectures.\n2. Advised to create a comfortable environment for student questions.',
    hodRemarks: 'Engagement improvement needed.',
    commentPercentages: { Excellent: 25, 'Very Good': 42, Good: 33 },
  },
  {
    facultyName: 'Praveen Bansal',
    subjectCode: 'IOT501',
    programme: 'Internet of Things Applications',
    branch: 'IoT', section: 'A', semester: '5',
    ffiScore: 4.30,
    responseCount: 35,
    appreciation: [
      'Practical IoT demonstrations are very helpful.',
      'Very knowledgeable and up-to-date with technology.',
      'Hands-on lab sessions are excellent.',
      'Best IoT faculty.',
    ],
    commentsNeedingAttention: [],
    actionTaken: 'Performance is satisfactory. Encouraged to maintain quality teaching and continue student engagement.',
    hodRemarks: 'Excellent performance across all parameters.',
    commentPercentages: { Excellent: 60, 'Very Good': 25, Good: 15 },
  },
  {
    facultyName: 'Punit Kumar Johari',
    subjectCode: 'IT301',
    programme: 'Database Management Systems',
    branch: 'IT', section: 'A', semester: '3',
    ffiScore: 3.95,
    responseCount: 48,
    appreciation: [
      'Good explanation of SQL and normalization.',
      'Clears doubts patiently.',
    ],
    commentsNeedingAttention: [
      'Some complex topics could use more practical SQL examples.',
      'More problem-solving exercises would help.',
    ],
    actionTaken: '1. Advised to include more live SQL practice in every class.\n2. Directed to assign regular problem-solving exercises.',
    hodRemarks: 'Solid performance. Practical improvement suggested.',
    commentPercentages: { Excellent: 35, 'Very Good': 40, Good: 25 },
  },
  {
    facultyName: 'R R Singh',
    subjectCode: 'AI601',
    programme: 'Machine Learning',
    branch: 'AI', section: 'A', semester: '6',
    ffiScore: 4.55,
    responseCount: 40,
    appreciation: [
      'Excellent depth in ML concepts.',
      'Very inspiring and motivating faculty.',
      'Practical ML projects make learning very effective.',
      'Best ML teacher, explains maths behind algorithms clearly.',
      'Always available for academic guidance.',
    ],
    commentsNeedingAttention: [],
    actionTaken: 'Performance is satisfactory. Encouraged to maintain quality teaching and continue student engagement.',
    hodRemarks: 'Outstanding faculty. No issues reported.',
    commentPercentages: { Excellent: 65, 'Very Good': 25, Good: 10 },
  },
];

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to production DB\n');

  // Find a HOD to attach reports to
  const hod = await User.findOne({ role: 'hod' }).lean();
  if (!hod) { console.error('❌ No HOD found'); process.exit(1); }
  console.log(`Using HOD: ${hod.name} (${hod.email}) — ${hod.department}`);

  // Delete any existing demo reports for this HOD to avoid duplicates
  const deleted = await FacultyReport.deleteMany({
    hodId: hod._id,
    status: 'faculty_approved',
    programme: { $in: DEMO_REPORTS.map(r => r.programme) }
  });
  console.log(`Cleaned up ${deleted.deletedCount} existing demo reports\n`);

  // Create 10 reports
  const reportDocs = [];
  for (const r of DEMO_REPORTS) {
    const doc = await FacultyReport.create({
      hodId:                    hod._id,
      facultyName:              r.facultyName,
      subjectCode:              r.subjectCode,
      programme:                r.programme,
      branch:                   r.branch,
      section:                  r.section,
      semester:                 r.semester,
      ffiScore:                 r.ffiScore,
      responseCount:            r.responseCount,
      appreciation:             r.appreciation,
      commentsNeedingAttention: r.commentsNeedingAttention,
      appreciationCount:        r.appreciation.length,
      attentionCount:           r.commentsNeedingAttention.length,
      actionTaken:              r.actionTaken,
      hodRemarks:               r.hodRemarks,
      commentPercentages:       r.commentPercentages,
      status:                   'faculty_approved',
      facultyAcknowledged:      true,
      facultyAcknowledgedAt:    new Date(),
      academicYear:             '2025-2026',
      driveLink:                '',
    });
    reportDocs.push(doc);
    console.log(`✅ Created: ${r.facultyName} — ${r.subjectCode} (FFI: ${r.ffiScore})`);
  }

  // Create 1 submission with all 10 reports → status 'submitted' so Pro-VC can see it
  const existing = await Submission.findOne({ hodId: hod._id, status: 'submitted', academicYear: '2025-2026' });
  if (existing) {
    await Submission.findByIdAndDelete(existing._id);
    console.log('\nRemoved existing demo submission');
  }

  const submission = await Submission.create({
    hodId:          hod._id,
    reports:        reportDocs.map(r => r._id),
    academicYear:   '2025-2026',
    department:     hod.department,
    semester:       '3',
    session:        'jul-dec',
    feedbackFormNo: 'I',
    submissionDate: new Date(),
    status:         'submitted',
  });

  console.log(`\n✅ Submission created: ${submission._id}`);
  console.log(`   HOD: ${hod.name}`);
  console.log(`   Reports: ${reportDocs.length}`);
  console.log(`   Status: submitted (visible to Pro-VC)`);
  console.log(`\n🎉 Pro-VC panel now has 10 demo reports from ${hod.department}`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });
