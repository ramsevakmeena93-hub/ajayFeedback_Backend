require('dotenv').config();
const mongoose = require('mongoose');

async function clearData() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to DB.");

  const FacultyReport = require('./models/FacultyReport');
  const Submission = require('./models/Submission');
  const Notification = require('./models/Notification');
  const AuditLog = require('./models/AuditLog');
  const ActivityLog = require('./models/ActivityLog');

  console.log("Clearing all reports and report-related data...");
  
  const reportRes = await FacultyReport.deleteMany({});
  console.log(`Deleted ${reportRes.deletedCount} FacultyReports.`);

  const subRes = await Submission.deleteMany({});
  console.log(`Deleted ${subRes.deletedCount} Submissions.`);

  const notifRes = await Notification.deleteMany({});
  console.log(`Deleted ${notifRes.deletedCount} Notifications.`);

  const auditRes = await AuditLog.deleteMany({});
  console.log(`Deleted ${auditRes.deletedCount} AuditLogs.`);

  const actRes = await ActivityLog.deleteMany({});
  console.log(`Deleted ${actRes.deletedCount} ActivityLogs.`);

  const User = require('./models/User');
  const vcUsers = await User.find({ email: 'nec@mitsgwalior.in' });
  if (vcUsers.length > 0) {
    const vcUser = vcUsers[0];
    const UserRole = require('./models/UserRole');
    await User.deleteMany({ _id: vcUser._id });
    await UserRole.deleteMany({ userId: vcUser._id });
    console.log(`Deleted user nec@mitsgwalior.in`);
  } else {
    console.log("nec@mitsgwalior.in not found (already deleted)");
  }

  console.log("Data cleanup complete.");
  process.exit(0);
}

clearData().catch(console.error);
