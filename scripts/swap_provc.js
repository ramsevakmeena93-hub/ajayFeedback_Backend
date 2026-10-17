/**
 * Script: swap_provc.js
 * 1. Remove current Pro-VC (role=vc) — demote to faculty
 * 2. Make 25tc1aj7@mitsgwl.ac.in → Pro-VC (role=vc)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User     = require('../models/User');
const UserRole = require('../models/UserRole');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/faculty_feedback';
const NEW_VC_EMAIL = '25tc1aj7@mitsgwl.ac.in';

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected\n');

  // ── Step 1: Find current Pro-VC(s) ──────────────────────────────────────
  const currentVCs = await User.find({
    $or: [{ role: 'vc' }, { roles: 'vc' }],
    email: { $ne: NEW_VC_EMAIL }
  }).select('name email role roles department activeWorkspace');

  console.log(`Found ${currentVCs.length} current Pro-VC(s) to demote:`);
  currentVCs.forEach(u => console.log(`  - ${u.email} (${u.name})`));

  for (const u of currentVCs) {
    await User.findByIdAndUpdate(u._id, {
      role:            'faculty',
      roles:           ['faculty'],
      activeWorkspace: 'faculty',
    });
    await UserRole.updateMany({ userId: u._id }, { active: false });
    await UserRole.create({
      userId:          u._id,
      role:            'faculty',
      departmentScope: u.department || '',
      active:          true,
    });
    console.log(`✅ Demoted ${u.email} → faculty`);
  }

  // ── Step 2: Make 25tc1aj7 → Pro-VC ──────────────────────────────────────
  const newVC = await User.findOne({ email: NEW_VC_EMAIL });
  if (!newVC) { console.error('❌ User not found:', NEW_VC_EMAIL); process.exit(1); }

  console.log('\nBEFORE:');
  console.log(`  ${newVC.email} | role: ${newVC.role} | roles: ${JSON.stringify(newVC.roles)}`);

  await User.findByIdAndUpdate(newVC._id, {
    role:            'vc',
    roles:           ['vc'],
    activeWorkspace: 'vc',
    department:      '',
  });

  await UserRole.updateMany({ userId: newVC._id }, { active: false });
  await UserRole.create({
    userId:          newVC._id,
    role:            'vc',
    departmentScope: '',
    active:          true,
  });

  const updated = await User.findOne({ email: NEW_VC_EMAIL });
  console.log('\nAFTER:');
  console.log(`  ${updated.email} | role: ${updated.role} | roles: ${JSON.stringify(updated.roles)}`);
  console.log('\n✅ Done — 25tc1aj7@mitsgwl.ac.in is now Pro-VC');

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });
