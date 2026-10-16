/**
 * Script: fix_ajay_role.js
 * Purpose: Change 25tc1aj7@mitsgwl.ac.in
 *   - Remove admin role
 *   - Set primary role = hod
 *   - Set department = Industrial Production
 *   - Set roles array = ['hod']
 *   - Set activeWorkspace = hod
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User     = require('../models/User');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/faculty_feedback';
const TARGET_EMAIL = '25tc1aj7@mitsgwl.ac.in';

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ MongoDB connected');

  const user = await User.findOne({ email: TARGET_EMAIL });
  if (!user) {
    console.error('❌ User not found:', TARGET_EMAIL);
    process.exit(1);
  }

  console.log('📋 BEFORE:');
  console.log('   name           :', user.name);
  console.log('   email          :', user.email);
  console.log('   role           :', user.role);
  console.log('   roles          :', user.roles);
  console.log('   department     :', user.department);
  console.log('   activeWorkspace:', user.activeWorkspace);

  // Apply changes
  user.role            = 'hod';
  user.roles           = ['hod'];
  user.activeWorkspace = 'hod';
  user.department      = 'Industrial Production';

  await user.save();

  // Also update UserRole collection if it exists
  try {
    const UserRole = require('../models/UserRole');
    // Deactivate all existing roles for this user
    await UserRole.updateMany({ userId: user._id }, { active: false });
    // Create/activate hod role
    const existing = await UserRole.findOne({ userId: user._id, role: 'hod' });
    if (existing) {
      existing.active = true;
      existing.departmentScope = 'Industrial Production';
      await existing.save();
    } else {
      await UserRole.create({
        userId:          user._id,
        role:            'hod',
        departmentScope: 'Industrial Production',
        active:          true,
        grantedAt:       new Date(),
      });
    }
    console.log('✅ UserRole collection updated');
  } catch (e) {
    console.warn('⚠️  UserRole update skipped:', e.message);
  }

  const updated = await User.findOne({ email: TARGET_EMAIL });
  console.log('\n📋 AFTER:');
  console.log('   name           :', updated.name);
  console.log('   email          :', updated.email);
  console.log('   role           :', updated.role);
  console.log('   roles          :', updated.roles);
  console.log('   department     :', updated.department);
  console.log('   activeWorkspace:', updated.activeWorkspace);
  console.log('\n✅ Done — user is now HOD of Industrial Production');

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
