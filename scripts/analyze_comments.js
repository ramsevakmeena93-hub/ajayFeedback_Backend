/**
 * Pull real student comments from production DB
 * so we can see what's being misclassified
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const FacultyReport = require('../models/FacultyReport');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/faculty_feedback';

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected\n');

  const reports = await FacultyReport.find({
    $or: [
      { appreciation: { $exists: true, $not: { $size: 0 } } },
      { commentsNeedingAttention: { $exists: true, $not: { $size: 0 } } },
      { rawStudentComments: { $exists: true, $not: { $size: 0 } } },
    ]
  }).select('facultyName appreciation commentsNeedingAttention rawStudentComments').lean();

  console.log(`Found ${reports.length} reports with comments\n`);

  let allRaw = [], allAppreciation = [], allAttention = [];

  reports.forEach(r => {
    if (r.rawStudentComments?.length) allRaw.push(...r.rawStudentComments);
    if (r.appreciation?.length) allAppreciation.push(...r.appreciation);
    if (r.commentsNeedingAttention?.length) allAttention.push(...r.commentsNeedingAttention);
  });

  console.log('=== RAW STUDENT COMMENTS (sample 50) ===');
  allRaw.slice(0, 50).forEach((c, i) => console.log(`${i+1}. "${c}"`));

  console.log('\n=== CURRENTLY IN APPRECIATION (sample 30) ===');
  allAppreciation.slice(0, 30).forEach((c, i) => console.log(`${i+1}. "${c}"`));

  console.log('\n=== CURRENTLY IN NEED ATTENTION (sample 30) ===');
  allAttention.slice(0, 30).forEach((c, i) => console.log(`${i+1}. "${c}"`));

  await mongoose.disconnect();
}

run().catch(e => { console.error(e.message); process.exit(1); });
