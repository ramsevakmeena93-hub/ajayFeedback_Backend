require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/faculty_feedback';

async function run() {
  await mongoose.connect(MONGO_URI);
  // Search by partial email OR by name containing ajay OR admin role
  const users = await User.find({
    $or: [
      { email: /25tc1aj7/i },
      { email: /ajay/i },
      { email: /mitsgwl/i },
      { role: 'admin' },
      { roles: 'admin' },
    ]
  }).select('name email role roles department activeWorkspace').lean();

  console.log(`Found ${users.length} matching users:\n`);
  users.forEach(u => {
    console.log(`email: ${u.email}`);
    console.log(`name : ${u.name}`);
    console.log(`role : ${u.role} | roles: ${JSON.stringify(u.roles)} | dept: ${u.department}`);
    console.log('---');
  });
  await mongoose.disconnect();
}
run().catch(e => { console.error(e.message); process.exit(1); });
