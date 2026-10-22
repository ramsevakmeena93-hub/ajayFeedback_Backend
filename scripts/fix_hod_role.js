/**
 * Fix 24cb10ab6@mitsgwl.ac.in — force HOD role, remove faculty role
 * Run: node scripts/fix_hod_role.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User     = require('../models/User');
const UserRole = require('../models/UserRole');

const TARGET_EMAIL = '24cb10ab6@mitsgwl.ac.in';
const DEPARTMENT   = 'Autonomous Production';
const MONGO_URI    = process.env.MONGO_URI;

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to production MongoDB');

  const user = await User.findOne({ email: TARGET_EMAIL.toLowerCase() });
  if (!user) { console.error('❌ User not found'); process.exit(1); }

  console.log(`Found: ${user.name} | role=${user.role} | workspace=${user.activeWorkspace}`);

  // Force all role fields to HOD
  await User.findByIdAndUpdate(user._id, {
    role            : 'hod',
    department      : DEPARTMENT,
    roles           : ['hod'],
    activeWorkspace : 'hod'
  });

  // Remove ALL existing UserRoles for this user
  await UserRole.deleteMany({ userId: user._id });

  // Create only HOD role
  await UserRole.create({
    userId          : user._id,
    role            : 'hod',
    departmentScope : DEPARTMENT
  });

  // Confirm
  const updated = await User.findById(user._id);
  const roles   = await UserRole.find({ userId: user._id });

  console.log('\n=== FINAL STATE ===');
  console.log(`Name            : ${updated.name}`);
  console.log(`Email           : ${updated.email}`);
  console.log(`role            : ${updated.role}`);
  console.log(`roles[]         : ${updated.roles}`);
  console.log(`activeWorkspace : ${updated.activeWorkspace}`);
  console.log(`department      : ${updated.department}`);
  console.log(`UserRoles       :`, roles.map(r => `${r.role} @ ${r.departmentScope}`));
  console.log('\n✅ User is now HOD only. Faculty role removed.');

  await mongoose.disconnect();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
