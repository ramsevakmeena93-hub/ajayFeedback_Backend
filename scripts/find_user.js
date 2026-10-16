require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/faculty_feedback';

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to:', MONGO_URI.substring(0, 40) + '...');

  // List ALL users with email + role
  const users = await User.find({}).select('name email role roles department activeWorkspace').lean();
  console.log(`\n📋 Total users in DB: ${users.length}\n`);
  users.forEach((u, i) => {
    console.log(`${i+1}. ${u.email}`);
    console.log(`   name: ${u.name}`);
    console.log(`   role: ${u.role} | roles: ${JSON.stringify(u.roles)} | dept: ${u.department}`);
  });

  await mongoose.disconnect();
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });
