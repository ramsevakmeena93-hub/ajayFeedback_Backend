require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const FacultyReport = require('../models/FacultyReport');
const Submission    = require('../models/Submission');
const User          = require('../models/User');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected');

  // Find Abhishek sir's HOD account
  const abhishek = await User.findOne({ email: { $regex: /abhishek/i } });
  if (!abhishek) {
    // Try by name
    const byName = await User.findOne({ name: { $regex: /abhishek/i } });
    if (!byName) { console.log('Abhishek not found in DB'); process.exit(0); }
    console.log('Found:', byName.name, byName.email, byName._id);
    await deleteForHod(byName._id);
  } else {
    console.log('Found:', abhishek.name, abhishek.email, abhishek._id);
    await deleteForHod(abhishek._id);
  }

  await mongoose.disconnect();
  console.log('Done');
}

async function deleteForHod(hodId) {
  // Delete all FacultyReports by this HOD
  const reports = await FacultyReport.deleteMany({ hodId });
  console.log(`Deleted ${reports.deletedCount} FacultyReport(s)`);

  // Delete all Submissions by this HOD
  const subs = await Submission.deleteMany({ hodId });
  console.log(`Deleted ${subs.deletedCount} Submission(s)`);
}

run().catch(console.error);
