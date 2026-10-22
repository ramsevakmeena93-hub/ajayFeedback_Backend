/**
 * Make 24cb10ab6@mitsgwl.ac.in the HOD of Autonomous Production department
 * Run: node scripts/make_hod_autonomous.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User     = require('../models/User');
const UserRole = require('../models/UserRole');

const TARGET_EMAIL  = '24cb10ab6@mitsgwl.ac.in';
const DEPARTMENT    = 'Autonomous Production';
const MONGO_URI     = process.env.MONGO_URI || 'mongodb://localhost:27017/faculty_feedback';

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB');

  // 1. Find the user
  let user = await User.findOne({ email: TARGET_EMAIL.toLowerCase() });

  if (!user) {
    console.log(`⚠️  User not found — creating new account...`);
    const bcrypt = require('bcryptjs');
    const hashed = await bcrypt.hash('Mits@1234', 10);
    user = await User.create({
      name       : 'HOD Autonomous Production',
      email      : TARGET_EMAIL.toLowerCase(),
      password   : hashed,
      role       : 'hod',
      department : DEPARTMENT,
      roles      : ['hod']
    });
    console.log(`✅ New user created with default password: Mits@1234`);
  }

  console.log(`✅ Found user: ${user.name} (${user.email})`);
  console.log(`   Current role: ${user.role}, department: ${user.department}`);

  // 2. Update User document
  user.role       = 'hod';
  user.department = DEPARTMENT;
  await user.save();
  console.log(`✅ User role updated to HOD`);

  // 3. Remove any existing HOD UserRole for this user
  await UserRole.deleteMany({ userId: user._id, role: 'hod' });

  // 4. Create new UserRole entry
  await UserRole.create({
    userId          : user._id,
    role            : 'hod',
    departmentScope : DEPARTMENT
  });
  console.log(`✅ UserRole created: HOD of "${DEPARTMENT}"`);

  // 5. Confirm
  const updated = await User.findById(user._id);
  const roles   = await UserRole.find({ userId: user._id });

  console.log('\n=== FINAL STATE ===');
  console.log(`Name       : ${updated.name}`);
  console.log(`Email      : ${updated.email}`);
  console.log(`Role       : ${updated.role}`);
  console.log(`Department : ${updated.department}`);
  console.log(`UserRoles  :`, roles.map(r => `${r.role} @ ${r.departmentScope}`));
  console.log('\n✅ Done! User is now HOD of Autonomous Production.');

  await mongoose.disconnect();
}

main().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
