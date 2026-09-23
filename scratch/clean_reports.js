require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

async function cleanAllReportsAndSubmissions() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  const FacultyReport = require('../models/FacultyReport');
  const Submission = require('../models/Submission');
  const ActivityLog = require('../models/ActivityLog');

  const resReports = await FacultyReport.deleteMany({});
  console.log('Deleted FacultyReports:', resReports.deletedCount);

  const resSubs = await Submission.deleteMany({});
  console.log('Deleted Submissions:', resSubs.deletedCount);

  const resLogs = await ActivityLog.deleteMany({});
  console.log('Deleted ActivityLogs:', resLogs.deletedCount);

  await mongoose.disconnect();
  console.log('Cleanup complete!');
}

cleanAllReportsAndSubmissions().catch(console.error);
